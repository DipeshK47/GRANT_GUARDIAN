import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  draftAnswers,
  funders,
  opportunities,
  organizations,
  requirements,
  reviews,
  tasks,
} from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { OpportunityDraftingService } from "./drafting.js";
import {
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "./opportunity-identity.js";
import { selectRetainedRequirementIds } from "./requirement-normalization.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type ReviewStatus = "Requested" | "In Review" | "Changes Requested" | "Approved";
type ReviewType = "Draft Review" | "Compliance Review" | "Submission Approval";
type TaskPriority = "Low" | "Medium" | "High";
type TaskStatus = "To Do" | "In Progress" | "Blocked" | "Done";
type DraftStatus = "Not Started" | "Drafting" | "Needs Review" | "Approved";
type ReadyStatus = "Preparing" | "Ready";
type ReadinessStage =
  | "Awaiting Human Review"
  | "Revision Required"
  | "Ready for Submission";

type LoadedReviewContext = {
  opportunity: typeof opportunities.$inferSelect;
  funder: typeof funders.$inferSelect;
  organization: typeof organizations.$inferSelect;
  requirements: Array<typeof requirements.$inferSelect>;
  drafts: Array<typeof draftAnswers.$inferSelect>;
  reviews: Array<typeof reviews.$inferSelect>;
  tasks: Array<typeof tasks.$inferSelect>;
};

type ReviewQueueRecord = {
  reviewId: string;
  draftAnswerId: string;
  questionText: string;
  status: ReviewStatus;
  approvalStatus: ReviewStatus;
  reviewer: string;
  reviewType: ReviewType;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  unsupportedClaims: string[];
  draftStatus: DraftStatus;
  blockingReason?: string | null;
};

export type OpportunityReviewWorkflowInput = {
  opportunityId: string;
  reviewer?: string;
  dueDate?: string;
  syncToNotion?: boolean;
  force?: boolean;
};

export type OpportunityReviewResponseInput = {
  reviewId: string;
  status: ReviewStatus;
  reviewerNotes?: string;
  assignee?: string;
  dueDate?: string;
  syncToNotion?: boolean;
};

export type OpportunitySubmissionReadiness = {
  readyForSubmission: boolean;
  readyStatus: ReadyStatus;
  stage: ReadinessStage;
  blockerCount: number;
  blockers: string[];
  reviewCoveragePercent: number;
  approvals: {
    requested: number;
    inReview: number;
    changesRequested: number;
    approved: number;
  };
  draftCoverage: {
    totalRequirements: number;
    draftsPresent: number;
    approvedDrafts: number;
    pendingUnsupportedClaims: number;
  };
  taskSummary: {
    open: number;
    blocked: number;
    done: number;
  };
};

export type OpportunityReviewWorkflowResult = {
  opportunityId: string;
  opportunityTitle: string;
  funderId: string;
  funderName: string;
  reviewer: string;
  requestedReviewCount: number;
  preservedReviewCount: number;
  blockingTaskCount: number;
  reviewQueue: ReviewQueueRecord[];
  readiness: OpportunitySubmissionReadiness;
  notionSync?: {
    reviewPageIds: string[];
    taskPageIds: string[];
    submissionPageId: string;
  };
};

export type OpportunityReviewResponseResult = {
  reviewId: string;
  opportunityId: string;
  opportunityTitle: string;
  draftAnswerId?: string | null;
  questionText?: string | null;
  status: ReviewStatus;
  reviewer: string;
  reviewerNotes?: string | null;
  readiness: OpportunitySubmissionReadiness;
  notionSync?: {
    reviewPageIds: string[];
    taskPageIds: string[];
    submissionPageId: string;
  };
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const toDraftStatus = (value?: string | null): DraftStatus => {
  if (value === "Approved") {
    return "Approved";
  }
  if (value === "Drafting") {
    return "Drafting";
  }
  if (value === "Needs Review") {
    return "Needs Review";
  }
  return "Not Started";
};

const toReviewStatus = (value?: string | null): ReviewStatus => {
  if (value === "Approved") {
    return "Approved";
  }
  if (value === "Changes Requested") {
    return "Changes Requested";
  }
  if (value === "In Review") {
    return "In Review";
  }
  return "Requested";
};

const toTaskStatus = (value?: string | null): TaskStatus => {
  if (value === "Done") {
    return "Done";
  }
  if (value === "Blocked") {
    return "Blocked";
  }
  if (value === "In Progress") {
    return "In Progress";
  }
  return "To Do";
};

const toPriority = (value?: string | null): TaskPriority => {
  if (value === "High") {
    return "High";
  }
  if (value === "Low") {
    return "Low";
  }
  return "Medium";
};

const shortRequirementLabel = (questionText?: string | null, fallback = "Requirement") => {
  const normalized = normalizeText(questionText);
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
};

const parseJsonArray = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeText(String(item))).filter(Boolean)
      : [];
  } catch {
    return normalized
      .split(",")
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }
};

function isDraftBlockedForReview(
  status: DraftStatus,
  draftText?: string | null,
  unsupportedClaims: string[] = [],
) {
  const normalizedDraft = normalizeText(draftText).toLowerCase();
  return (
    status === "Not Started" ||
    normalizedDraft.startsWith("blocked:") ||
    (status === "Drafting" && unsupportedClaims.length > 0 && !normalizedDraft)
  );
}

const buildLatestRecordMap = <T extends { updatedAt: string }>(
  records: T[],
  getKey: (record: T) => string,
) => {
  const map = new Map<string, T>();

  for (const record of records) {
    const key = getKey(record);
    const existing = map.get(key);
    if (!existing || record.updatedAt > existing.updatedAt) {
      map.set(key, record);
    }
  }

  return map;
};

const buildLatestReviewByRequirementId = (
  reviewRows: Array<typeof reviews.$inferSelect>,
  draftRows: Array<typeof draftAnswers.$inferSelect>,
) => {
  const draftById = new Map(draftRows.map((draft) => [draft.id, draft]));

  return buildLatestRecordMap(
    reviewRows.filter((review) => {
      const draftAnswerId = normalizeText(review.draftAnswerId);
      const draft = draftById.get(draftAnswerId);
      if (!draft) {
        return false;
      }

      return !isDraftBlockedForReview(
        toDraftStatus(draft.status),
        draft.draftText,
        parseJsonArray(draft.unsupportedClaims),
      );
    }),
    (review) => draftById.get(normalizeText(review.draftAnswerId))?.requirementId ?? review.id,
  );
};

const toIsoDate = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  return normalized.includes("T") ? normalized.slice(0, 10) : normalized;
};

const suggestedDueDate = (deadline?: string | null) => {
  const now = new Date();
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 3);

  const normalizedDeadline = normalizeText(deadline);
  if (!normalizedDeadline) {
    return fallback.toISOString().slice(0, 10);
  }

  const parsedDeadline = new Date(normalizedDeadline);
  if (Number.isNaN(parsedDeadline.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }

  const suggested = new Date(parsedDeadline);
  suggested.setDate(suggested.getDate() - 7);
  if (suggested < now) {
    return parsedDeadline.toISOString().slice(0, 10);
  }

  return suggested.toISOString().slice(0, 10);
};

export class OpportunityReviewWorkflowService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly draftingService: OpportunityDraftingService,
    private readonly notionClient?: NotionMcpClient,
    logger?: Partial<LoggerLike>,
  ) {
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : () => undefined,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : () => undefined,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : () => undefined,
    };
  }

  async run(input: OpportunityReviewWorkflowInput): Promise<OpportunityReviewWorkflowResult> {
    await this.ensureDraftsExist(input.opportunityId);

    let context = await this.loadContext(input.opportunityId);
    const reviewer =
      normalizeText(input.reviewer) ||
      normalizeText(context.opportunity.reviewer) ||
      normalizeText(context.organization.grantsContact) ||
      "Human Reviewer";

    if (normalizeText(context.opportunity.reviewer) !== reviewer) {
      const now = new Date().toISOString();
      await db
        .update(opportunities)
        .set({
          updatedAt: now,
          reviewer,
        })
        .where(eq(opportunities.id, context.opportunity.id));
      context = await this.loadContext(input.opportunityId);
    }

    const draftByRequirementId = new Map(
      context.drafts.map((draft) => [draft.requirementId, draft]),
    );
    const latestReviewByRequirementId = buildLatestReviewByRequirementId(
      context.reviews,
      context.drafts,
    );
    const latestTaskByRequirementId = buildLatestRecordMap(
      context.tasks.filter((task) => normalizeText(task.requirementId)),
      (task) => normalizeText(task.requirementId),
    );

    let requestedReviewCount = 0;
    let preservedReviewCount = 0;
    const queue: ReviewQueueRecord[] = [];

    for (const requirement of context.requirements) {
      const draft = draftByRequirementId.get(requirement.id);
      if (!draft) {
        throw new Error(
          `Requirement '${shortRequirementLabel(requirement.questionText)}' has no draft answer yet. Run draft generation first.`,
        );
      }

      const unsupportedClaims = parseJsonArray(draft.unsupportedClaims);
      const currentDraftStatus = toDraftStatus(draft.status);
      const blockedDraft = isDraftBlockedForReview(
        currentDraftStatus,
        draft.draftText,
        unsupportedClaims,
      );
      const existingReview = latestReviewByRequirementId.get(requirement.id);
      const preservedStatus = input.force
        ? ("Requested" as const)
        : requirement.approvalStatus
          ? toReviewStatus(requirement.approvalStatus)
          : currentDraftStatus === "Approved"
            ? ("Approved" as const)
            : existingReview
              ? toReviewStatus(existingReview.status)
              : ("Requested" as const);
      const guidance =
        existingReview && !input.force
          ? normalizeText(existingReview.reviewerNotes) ||
            this.buildReviewGuidance(requirement.questionText, unsupportedClaims)
          : this.buildReviewGuidance(requirement.questionText, unsupportedClaims);
      const now = new Date().toISOString();

      const taskTemplate = this.buildReviewTask({
        questionText: requirement.questionText,
        requirementType: requirement.requirementType,
        reviewStatus: preservedStatus,
        draftStatus: currentDraftStatus,
        unsupportedClaims,
        blockedDraft,
        dueDate:
          toIsoDate(input.dueDate) ||
          toIsoDate(latestTaskByRequirementId.get(requirement.id)?.dueDate) ||
          suggestedDueDate(context.opportunity.deadline),
        assignee: reviewer,
      });
      const existingTask = latestTaskByRequirementId.get(requirement.id);
      const taskRow = existingTask
        ? await this.updateTask(existingTask.id, {
            updatedAt: now,
            description: taskTemplate.title,
            priority: taskTemplate.priority,
            assignee: taskTemplate.assignee,
            dueDate: taskTemplate.dueDate,
            status: taskTemplate.status,
            blockingDependency: taskTemplate.blockingDependency,
          })
        : await this.insertTask({
            id: randomUUID(),
            opportunityId: context.opportunity.id,
            requirementId: requirement.id,
            description: taskTemplate.title,
            priority: taskTemplate.priority,
            assignee: taskTemplate.assignee,
            dueDate: taskTemplate.dueDate,
            status: taskTemplate.status,
            blockingDependency: taskTemplate.blockingDependency,
          });

      if (blockedDraft) {
        continue;
      }

      const reviewRow = existingReview
        ? await this.updateReview(existingReview.id, {
            updatedAt: now,
            status: preservedStatus,
            reviewer,
            reviewerNotes: guidance,
            approvedAt:
              preservedStatus === "Approved"
                ? existingReview.approvedAt ?? now
                : null,
          })
        : await this.insertReview({
            id: randomUUID(),
            opportunityId: context.opportunity.id,
            draftAnswerId: draft.id,
            reviewType: "Draft Review",
            reviewer,
            status: preservedStatus,
            reviewerNotes: guidance,
            approvedAt: preservedStatus === "Approved" ? now : null,
          });

      if (existingReview && !input.force) {
        preservedReviewCount += 1;
      } else {
        requestedReviewCount += 1;
      }

      const draftStatus = this.deriveDraftStatus(
        preservedStatus,
        currentDraftStatus,
        unsupportedClaims,
      );
      if (toDraftStatus(draft.status) !== draftStatus) {
        await db
          .update(draftAnswers)
          .set({
            updatedAt: now,
            status: draftStatus,
          })
          .where(eq(draftAnswers.id, draft.id));
      }

      await db
        .update(requirements)
        .set({
          updatedAt: now,
          approvalStatus: preservedStatus,
        })
        .where(eq(requirements.id, requirement.id));

      queue.push({
        reviewId: reviewRow.id,
        draftAnswerId: draft.id,
        questionText: requirement.questionText,
        status: preservedStatus,
        approvalStatus: preservedStatus,
        reviewer,
        reviewType: "Draft Review",
        taskId: taskRow.id,
        taskTitle: taskRow.description,
        taskStatus: toTaskStatus(taskRow.status),
        priority: toPriority(taskRow.priority),
        dueDate: taskRow.dueDate,
        unsupportedClaims,
        draftStatus,
        blockingReason: taskRow.blockingDependency,
      });
    }

    const refreshed = await this.loadContext(context.opportunity.id);
    const readiness = this.buildReadiness(refreshed);

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Review Agent",
      actionDescription: "Prepared draft review queue and submission-readiness gate",
      confidenceLevel: round(readiness.reviewCoveragePercent / 100, 2),
      outputSummary: `Prepared ${queue.length} review item(s) for '${refreshed.opportunity.title}'. ${readiness.blockerCount} blocker(s) remain before submission.`,
      followUpRequired: !readiness.readyForSubmission,
    });

    let notionSync: OpportunityReviewWorkflowResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.syncToNotion(refreshed, readiness);
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for opportunity review workflow");
      }
    }

    return {
      opportunityId: refreshed.opportunity.id,
      opportunityTitle: refreshed.opportunity.title,
      funderId: refreshed.funder.id,
      funderName: refreshed.funder.name,
      reviewer,
      requestedReviewCount,
      preservedReviewCount,
      blockingTaskCount: refreshed.tasks.filter((task) => toTaskStatus(task.status) !== "Done").length,
      reviewQueue: queue,
      readiness,
      notionSync,
    };
  }

  async respond(input: OpportunityReviewResponseInput): Promise<OpportunityReviewResponseResult> {
    const [review] = await db.select().from(reviews).where(eq(reviews.id, input.reviewId)).limit(1);
    if (!review) {
      throw new Error("No review exists for the provided reviewId.");
    }

    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, review.opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new Error("The review references a missing opportunity record.");
    }

    const [draft] =
      review.draftAnswerId
        ? await db
            .select()
            .from(draftAnswers)
            .where(eq(draftAnswers.id, review.draftAnswerId))
            .limit(1)
        : [];
    const [requirement] =
      draft
        ? await db
            .select()
            .from(requirements)
            .where(eq(requirements.id, draft.requirementId))
            .limit(1)
        : [];

    const normalizedStatus = toReviewStatus(input.status);
    const now = new Date().toISOString();
    const updatedReview = await this.updateReview(review.id, {
      updatedAt: now,
      status: normalizedStatus,
      reviewer: normalizeText(review.reviewer) || "Human Reviewer",
      reviewerNotes: normalizeText(input.reviewerNotes) || review.reviewerNotes,
      approvedAt: normalizedStatus === "Approved" ? now : null,
    });

    if (draft) {
      await db
        .update(draftAnswers)
        .set({
          updatedAt: now,
          status: this.deriveDraftStatus(
            normalizedStatus,
            toDraftStatus(draft.status),
            parseJsonArray(draft.unsupportedClaims),
          ),
          reviewerComments: normalizeText(input.reviewerNotes) || draft.reviewerComments,
          revisionNotes:
            normalizedStatus === "Changes Requested"
              ? normalizeText(input.reviewerNotes) || draft.revisionNotes
              : draft.revisionNotes,
        })
        .where(eq(draftAnswers.id, draft.id));
    }

    if (requirement) {
      await db
        .update(requirements)
        .set({
          updatedAt: now,
          approvalStatus: normalizedStatus,
          reviewerNotes: normalizeText(input.reviewerNotes) || requirement.reviewerNotes,
        })
        .where(eq(requirements.id, requirement.id));

      const [existingTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.requirementId, requirement.id))
        .limit(1);

      const unsupportedClaims = parseJsonArray(draft?.unsupportedClaims);
      const taskTemplate = this.buildReviewTask({
        questionText: requirement.questionText,
        requirementType: requirement.requirementType,
        reviewStatus: normalizedStatus,
        draftStatus: this.deriveDraftStatus(
          normalizedStatus,
          toDraftStatus(draft?.status),
          unsupportedClaims,
        ),
        unsupportedClaims,
        dueDate:
          toIsoDate(input.dueDate) ||
          toIsoDate(existingTask?.dueDate) ||
          suggestedDueDate(opportunity.deadline),
        assignee:
          normalizeText(input.assignee) ||
          normalizeText(existingTask?.assignee) ||
          normalizeText(updatedReview.reviewer) ||
          "Human Reviewer",
      });

      if (existingTask) {
        await this.updateTask(existingTask.id, {
          updatedAt: now,
          description: taskTemplate.title,
          priority: taskTemplate.priority,
          assignee: taskTemplate.assignee,
          dueDate: taskTemplate.dueDate,
          status: taskTemplate.status,
          blockingDependency: taskTemplate.blockingDependency,
        });
      } else {
        await this.insertTask({
          id: randomUUID(),
          opportunityId: opportunity.id,
          requirementId: requirement.id,
          description: taskTemplate.title,
          priority: taskTemplate.priority,
          assignee: taskTemplate.assignee,
          dueDate: taskTemplate.dueDate,
          status: taskTemplate.status,
          blockingDependency: taskTemplate.blockingDependency,
        });
      }
    }

    const refreshed = await this.loadContext(opportunity.id);
    const readiness = this.buildReadiness(refreshed);

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Review Agent",
      actionDescription: "Recorded human review response and refreshed submission readiness",
      confidenceLevel: round(readiness.reviewCoveragePercent / 100, 2),
      outputSummary: `Review '${updatedReview.id}' moved to '${normalizedStatus}' for '${refreshed.opportunity.title}'. ${readiness.blockerCount} blocker(s) remain.`,
      followUpRequired: !readiness.readyForSubmission,
    });

    let notionSync: OpportunityReviewResponseResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.syncToNotion(refreshed, readiness);
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for review response");
      }
    }

    return {
      reviewId: updatedReview.id,
      opportunityId: refreshed.opportunity.id,
      opportunityTitle: refreshed.opportunity.title,
      draftAnswerId: updatedReview.draftAnswerId,
      questionText: requirement?.questionText,
      status: normalizedStatus,
      reviewer: updatedReview.reviewer,
      reviewerNotes: updatedReview.reviewerNotes,
      readiness,
      notionSync,
    };
  }

  async getReadiness(opportunityId: string) {
    const context = await this.loadContext(opportunityId);
    return this.buildReadiness(context);
  }

  private async ensureDraftsExist(opportunityId: string) {
    const [requirementRows, draftRows] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunityId)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunityId)),
    ]);

    if (requirementRows.length === 0) {
      return;
    }

    const draftedRequirementIds = new Set(draftRows.map((draft) => draft.requirementId));
    const missingDrafts = requirementRows.some(
      (requirement) =>
        !draftedRequirementIds.has(requirement.id) ||
        !normalizeText(requirement.draftAnswerId),
    );

    if (!missingDrafts) {
      return;
    }

    await this.draftingService.run({
      opportunityId,
      syncToNotion: false,
      force: false,
    });
  }

  private async loadContext(opportunityId: string): Promise<LoadedReviewContext> {
    const [requestedOpportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!requestedOpportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const relatedOpportunityRows = normalizeText(requestedOpportunity.organizationId)
      ? collectRelatedOpportunityRows(
          await db
            .select()
            .from(opportunities)
            .where(eq(opportunities.organizationId, requestedOpportunity.organizationId!)),
          requestedOpportunity,
        )
      : [requestedOpportunity];
    const opportunity =
      selectCanonicalOpportunity(relatedOpportunityRows) ?? requestedOpportunity;

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);
    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }

    const normalizedOrganizationId = normalizeText(opportunity.organizationId);
    const [organization] = normalizedOrganizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, normalizedOrganizationId))
          .limit(1)
      : await db.select().from(organizations).limit(1);
    if (!organization) {
      throw new Error("No organization profile exists yet. Seed demo data or create one first.");
    }

    const [rawRequirementRows, draftRows, reviewRows, taskRows] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunity.id)),
      db.select().from(reviews).where(eq(reviews.opportunityId, opportunity.id)),
      db.select().from(tasks).where(eq(tasks.opportunityId, opportunity.id)),
    ]);

    if (rawRequirementRows.length === 0) {
      throw new Error("This opportunity has no requirement records to review.");
    }

    const activeRequirementIds = new Set(
      selectRetainedRequirementIds(
        rawRequirementRows.map((row) => ({
          id: row.id,
          questionText: row.questionText,
          requirementType: row.requirementType,
          wordLimit: row.wordLimit,
        })),
      ),
    );
    const requirementRows = rawRequirementRows.filter((row) => activeRequirementIds.has(row.id));

    return {
      opportunity,
      funder,
      organization,
      requirements: requirementRows,
      drafts: draftRows,
      reviews: reviewRows,
      tasks: taskRows,
    };
  }

  private deriveDraftStatus(
    reviewStatus: ReviewStatus,
    currentStatus: DraftStatus,
    unsupportedClaims: string[],
  ): DraftStatus {
    if (reviewStatus === "Approved") {
      return "Approved";
    }

    if (reviewStatus === "Changes Requested") {
      return "Drafting";
    }

    if (currentStatus === "Drafting" || unsupportedClaims.length > 0) {
      return "Drafting";
    }

    return "Needs Review";
  }

  private buildReviewGuidance(questionText: string, unsupportedClaims: string[]) {
    const unsupportedNote =
      unsupportedClaims.length > 0
        ? ` Verify these unsupported claims before approval: ${unsupportedClaims.join("; ")}.`
        : "";

    return `Human review requested for "${shortRequirementLabel(
      questionText,
    )}". Check factual grounding, grant fit, and tone before approval.${unsupportedNote}`;
  }

  private buildReviewTask(input: {
    questionText: string;
    requirementType?: string | null;
    reviewStatus: ReviewStatus;
    draftStatus: DraftStatus;
    unsupportedClaims: string[];
    blockedDraft?: boolean;
    dueDate: string;
    assignee: string;
  }) {
    const normalizedType = normalizeText(input.requirementType).toLowerCase();
    const blocking =
      input.reviewStatus !== "Approved" || input.draftStatus === "Drafting" || input.blockedDraft;
    let priority: TaskPriority = "Medium";

    if (
      input.blockedDraft ||
      input.unsupportedClaims.length > 0 ||
      input.reviewStatus === "Changes Requested"
    ) {
      priority = "High";
    } else if (
      normalizedType.includes("document") ||
      normalizedType.includes("budget")
    ) {
      priority = "Low";
    }

    let status: TaskStatus = "To Do";
    if (input.reviewStatus === "Approved") {
      status = "Done";
    } else if (input.reviewStatus === "In Review") {
      status = "In Progress";
    } else if (
      input.blockedDraft ||
      input.reviewStatus === "Changes Requested" ||
      input.draftStatus === "Drafting" ||
      input.unsupportedClaims.length > 0
    ) {
      status = "Blocked";
    }

    const blockingDependency =
      status === "Done"
        ? null
        : input.blockedDraft
          ? "Submission gate blocked until the missing evidence or document is added and a grounded draft can be generated."
          : input.reviewStatus === "Changes Requested"
          ? "Submission gate blocked until draft revisions are completed."
          : input.unsupportedClaims.length > 0
            ? "Submission gate blocked until unsupported claims are resolved or approved."
            : "Submission gate blocked until human review is complete.";

    return {
      title: input.blockedDraft
        ? `Unblock draft: ${shortRequirementLabel(input.questionText)}`
        : `Review draft: ${shortRequirementLabel(input.questionText)}`,
      priority,
      status,
      assignee: input.assignee,
      dueDate: input.dueDate,
      blockingDependency,
      blocking,
    };
  }

  private buildReadiness(context: LoadedReviewContext): OpportunitySubmissionReadiness {
    const draftByRequirementId = new Map(
      context.drafts.map((draft) => [draft.requirementId, draft]),
    );
    const latestReviewByRequirementId = buildLatestReviewByRequirementId(
      context.reviews,
      context.drafts,
    );
    const latestTaskByRequirementId = buildLatestRecordMap(
      context.tasks.filter((task) => normalizeText(task.requirementId)),
      (task) => normalizeText(task.requirementId),
    );

    let draftsPresent = 0;
    let approvedDrafts = 0;
    let pendingUnsupportedClaims = 0;
    let requested = 0;
    let inReview = 0;
    let changesRequested = 0;
    let approved = 0;
    let openTasks = 0;
    let blockedTasks = 0;
    let doneTasks = 0;
    let redCoverageCount = 0;
    const blockers: string[] = [];

    for (const requirement of context.requirements) {
      if (requirement.coverageStatus === "Red") {
        redCoverageCount += 1;
      }

      const draft = draftByRequirementId.get(requirement.id);
      if (draft) {
        draftsPresent += 1;
      }

      const review = latestReviewByRequirementId.get(requirement.id);
      const unsupportedClaims = parseJsonArray(draft?.unsupportedClaims);
      const blockedDraft = isDraftBlockedForReview(
        toDraftStatus(draft?.status),
        draft?.draftText,
        unsupportedClaims,
      );
      const reviewStatus = blockedDraft
        ? undefined
        : requirement.approvalStatus
          ? toReviewStatus(requirement.approvalStatus)
          : toReviewStatus(review?.status);
      const task = latestTaskByRequirementId.get(requirement.id);
      const taskStatus = toTaskStatus(task?.status);

      switch (reviewStatus) {
        case "Requested":
          requested += 1;
          break;
        case "In Review":
          inReview += 1;
          break;
        case "Changes Requested":
          changesRequested += 1;
          break;
        case "Approved":
          approved += 1;
          break;
      }

      if (draft && toDraftStatus(draft.status) === "Approved") {
        approvedDrafts += 1;
      }

      if (unsupportedClaims.length > 0 && reviewStatus !== "Approved") {
        pendingUnsupportedClaims += 1;
      }

      if (task) {
        if (taskStatus === "Done") {
          doneTasks += 1;
        } else {
          openTasks += 1;
        }

        if (taskStatus === "Blocked") {
          blockedTasks += 1;
        }
      }
    }

    const missingDraftCount = context.requirements.length - draftsPresent;
    if (missingDraftCount > 0) {
      blockers.push(`${missingDraftCount} requirement(s) still lack draft answers.`);
    }

    if (redCoverageCount > 0) {
      blockers.push(`${redCoverageCount} requirement(s) still have red evidence coverage.`);
    }

    if (pendingUnsupportedClaims > 0) {
      blockers.push(
        `${pendingUnsupportedClaims} draft(s) still contain unsupported claims awaiting human resolution.`,
      );
    }

    if (changesRequested > 0) {
      blockers.push(`${changesRequested} review(s) have requested changes.`);
    }

    const pendingHumanReviews = requested + inReview;
    if (pendingHumanReviews > 0) {
      blockers.push(`${pendingHumanReviews} review(s) still await human approval.`);
    }

    const readyForSubmission =
      missingDraftCount === 0 &&
      redCoverageCount === 0 &&
      pendingUnsupportedClaims === 0 &&
      changesRequested === 0 &&
      pendingHumanReviews === 0 &&
      approved >= context.requirements.length;

    let stage: ReadinessStage = "Awaiting Human Review";
    if (readyForSubmission) {
      stage = "Ready for Submission";
    } else if (
      missingDraftCount > 0 ||
      redCoverageCount > 0 ||
      pendingUnsupportedClaims > 0 ||
      changesRequested > 0
    ) {
      stage = "Revision Required";
    }

    return {
      readyForSubmission,
      readyStatus: readyForSubmission ? "Ready" : "Preparing",
      stage,
      blockerCount: blockers.length,
      blockers,
      reviewCoveragePercent:
        context.requirements.length === 0
          ? 0
          : round((approved / context.requirements.length) * 100),
      approvals: {
        requested,
        inReview,
        changesRequested,
        approved,
      },
      draftCoverage: {
        totalRequirements: context.requirements.length,
        draftsPresent,
        approvedDrafts,
        pendingUnsupportedClaims,
      },
      taskSummary: {
        open: openTasks,
        blocked: blockedTasks,
        done: doneTasks,
      },
    };
  }

  private async syncToNotion(
    context: LoadedReviewContext,
    readiness: OpportunitySubmissionReadiness,
  ) {
    if (!this.notionClient) {
      return undefined;
    }

    const draftByRequirementId = new Map(
      context.drafts.map((draft) => [draft.requirementId, draft]),
    );
    const latestReviewByRequirementId = buildLatestReviewByRequirementId(
      context.reviews,
      context.drafts,
    );
    const latestTaskByRequirementId = buildLatestRecordMap(
      context.tasks.filter((task) => normalizeText(task.requirementId)),
      (task) => normalizeText(task.requirementId),
    );

    return this.notionClient.syncReviewWorkflow({
      opportunityId: context.opportunity.id,
      opportunityTitle: context.opportunity.title,
      submissionMethod: context.opportunity.submissionMethod,
      portalUrl: context.opportunity.portalUrl,
      readyStatus: readiness.readyStatus,
      reviews: context.requirements
        .map((requirement) => {
          const draft = draftByRequirementId.get(requirement.id);
          if (!draft) {
            return null;
          }

          const review = latestReviewByRequirementId.get(requirement.id);
          if (!review) {
            return null;
          }

          return {
            title: `${context.opportunity.title}: ${shortRequirementLabel(requirement.questionText)}`,
            reviewType: "Draft Review" as const,
            status: toReviewStatus(review.status),
            reviewer: normalizeText(review.reviewer) || "Human Reviewer",
            requestedOn: toIsoDate(review.createdAt),
            approvedOn: toIsoDate(review.approvedAt),
          };
        })
        .filter((review): review is NonNullable<typeof review> => Boolean(review)),
      tasks: context.requirements
        .map((requirement) => {
          const task = latestTaskByRequirementId.get(requirement.id);
          if (!task) {
            return null;
          }

          return {
            title: task.description,
            priority: toPriority(task.priority),
            status: toTaskStatus(task.status),
            dueDate: toIsoDate(task.dueDate),
            assignee: task.assignee,
            blocking: Boolean(normalizeText(task.blockingDependency)),
          };
        })
        .filter((task): task is NonNullable<typeof task> => Boolean(task)),
    });
  }

  private async updateReview(
    reviewId: string,
    values: {
      updatedAt: string;
      status: ReviewStatus;
      reviewer: string;
      reviewerNotes?: string | null;
      approvedAt?: string | null;
    },
  ) {
    await db.update(reviews).set(values).where(eq(reviews.id, reviewId));
    const [updated] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!updated) {
      throw new Error("Expected to find updated review row.");
    }

    return updated;
  }

  private async insertReview(values: {
    id: string;
    opportunityId: string;
    draftAnswerId: string;
    reviewType: ReviewType;
    reviewer: string;
    status: ReviewStatus;
    reviewerNotes?: string | null;
    approvedAt?: string | null;
  }) {
    await db.insert(reviews).values(values);
    const [created] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, values.id))
      .limit(1);

    if (!created) {
      throw new Error("Expected to find inserted review row.");
    }

    return created;
  }

  private async updateTask(
    taskId: string,
    values: {
      updatedAt: string;
      description: string;
      priority: TaskPriority;
      assignee?: string | null;
      dueDate?: string | null;
      status: TaskStatus;
      blockingDependency?: string | null;
    },
  ) {
    await db.update(tasks).set(values).where(eq(tasks.id, taskId));
    const [updated] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);

    if (!updated) {
      throw new Error("Expected to find updated task row.");
    }

    return updated;
  }

  private async insertTask(values: {
    id: string;
    opportunityId: string;
    requirementId: string;
    description: string;
    priority: TaskPriority;
    assignee?: string | null;
    dueDate?: string | null;
    status: TaskStatus;
    blockingDependency?: string | null;
  }) {
    await db.insert(tasks).values(values);
    const [created] = await db.select().from(tasks).where(eq(tasks.id, values.id)).limit(1);

    if (!created) {
      throw new Error("Expected to find inserted task row.");
    }

    return created;
  }
}
