import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  budgets,
  documents,
  draftAnswers,
  evidenceLibrary,
  funderFilings,
  funders,
  lessons,
  opportunities,
  organizations,
  programs,
  reportingCalendar,
  requirements,
  tasks,
} from "../../db/schema.js";
import type {
  NotionLessonsMemorySyncInput,
  NotionMcpClient,
  NotionWorkspaceSyncStatus,
} from "./client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type StoredFunderInsights = {
  issueAreaConcentration?: string[];
  topGeographies?: string[];
  repeatGranteeBiasPercent?: number | null;
  grantDna?: {
    topTerms?: Array<{ term?: string | null }>;
    framingStyles?: string[];
    toneSummary?: string;
  };
  smallOrgFriendly?: {
    label?: string;
  };
  statedVsActual?: {
    stated?: string;
    actual?: string;
  };
  sourceLine?: string;
};

export type WorkspaceManualSyncResult = {
  organizationId: string;
  organizationName: string;
  syncedAt: string;
  status: NotionWorkspaceSyncStatus;
  counts: {
    organization: number;
    programs: number;
    evidence: number;
    budgets: number;
    documents: number;
    funders: number;
    opportunities: number;
    requirements: number;
    drafts: number;
    lessons: number;
    reportingEntries: number;
    tasks: number;
    agentLogs: number;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const parseList = (value?: string | null) =>
  normalizeText(value)
    .split(/[,;|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseJsonArray = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => normalizeText(typeof entry === "string" ? entry : String(entry ?? "")))
        .filter(Boolean);
    }
  } catch {
    return parseList(normalized);
  }

  return [];
};

const riskLevelFromCoverage = (coverageStatus?: string | null): "Low" | "Medium" | "High" => {
  const normalized = normalizeText(coverageStatus).toLowerCase();
  if (normalized === "green") {
    return "Low";
  }
  if (normalized === "amber") {
    return "Medium";
  }
  return "High";
};

const toNotionSmallOrgFriendly = (label?: string | null) => {
  const normalized = normalizeText(label).toLowerCase();
  if (normalized === "high") {
    return "High" as const;
  }
  if (normalized === "medium") {
    return "Medium" as const;
  }
  return "Needs Review" as const;
};

const buildLessonTitle = (input: {
  funderName: string;
  opportunityTitle?: string | null;
  createdAt: string;
}) => {
  const prefix = input.opportunityTitle
    ? `${input.funderName} - ${input.opportunityTitle}`
    : `${input.funderName} Lesson`;
  return `${prefix} (${input.createdAt.slice(0, 10)})`;
};

const buildNotionGivingSummary = (input: {
  givingSummary?: string | null;
  insights?: StoredFunderInsights | null;
}) => {
  const lines = [
    normalizeText(input.givingSummary) || null,
    normalizeText(input.insights?.statedVsActual?.stated)
      ? `Website says: ${normalizeText(input.insights?.statedVsActual?.stated)}`
      : null,
    normalizeText(input.insights?.statedVsActual?.actual)
      ? `Filings show: ${normalizeText(input.insights?.statedVsActual?.actual)}`
      : null,
    input.insights?.issueAreaConcentration?.length
      ? `Issue area concentration: ${input.insights.issueAreaConcentration.join(", ")}`
      : null,
    typeof input.insights?.repeatGranteeBiasPercent === "number"
      ? `Repeat grantee bias: ${input.insights.repeatGranteeBiasPercent}%`
      : null,
    input.insights?.grantDna?.framingStyles?.length
      ? `Framing style: ${input.insights.grantDna.framingStyles.join(" · ")}`
      : null,
    normalizeText(input.insights?.grantDna?.toneSummary) || null,
    normalizeText(input.insights?.sourceLine) || null,
  ].filter(Boolean);

  return lines.join(" ");
};

export class NotionWorkspaceSyncService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly notionClient: NotionMcpClient,
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

  async getStatus() {
    return this.notionClient.getSyncStatus();
  }

  async syncWorkspace(input: {
    organizationId: string;
    clerkUserId?: string | null;
  }): Promise<WorkspaceManualSyncResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const programRows = await db
      .select()
      .from(programs)
      .where(eq(programs.organizationId, organization.id))
      .orderBy(asc(programs.createdAt));
    const programIds = programRows.map((row) => row.id);
    const [evidenceRows, budgetRows, documentRows, opportunityRows, lessonRows, logRows] =
      await Promise.all([
        programIds.length > 0
          ? db
              .select()
              .from(evidenceLibrary)
              .where(inArray(evidenceLibrary.programId, programIds))
              .orderBy(asc(evidenceLibrary.createdAt))
          : Promise.resolve([]),
        programIds.length > 0
          ? db
              .select()
              .from(budgets)
              .where(inArray(budgets.programId, programIds))
              .orderBy(asc(budgets.createdAt))
          : Promise.resolve([]),
        db
          .select()
          .from(documents)
          .where(eq(documents.organizationId, organization.id))
          .orderBy(asc(documents.createdAt)),
        db
          .select()
          .from(opportunities)
          .where(eq(opportunities.organizationId, organization.id))
          .orderBy(desc(opportunities.updatedAt)),
        db
          .select()
          .from(lessons)
          .where(eq(lessons.organizationId, organization.id))
          .orderBy(asc(lessons.createdAt)),
        db.select().from(agentLogs).orderBy(desc(agentLogs.createdAt)).limit(100),
      ]);

    const opportunityIds = opportunityRows.map((row) => row.id);
    const funderIds = [...new Set(opportunityRows.map((row) => row.funderId).filter(Boolean))];
    const [requirementRows, draftRows, taskRows, reportingRows, funderRows, filingRows] =
      await Promise.all([
        opportunityIds.length > 0
          ? db
              .select()
              .from(requirements)
              .where(inArray(requirements.opportunityId, opportunityIds))
              .orderBy(asc(requirements.createdAt))
          : Promise.resolve([]),
        opportunityIds.length > 0
          ? db
              .select()
              .from(draftAnswers)
              .where(inArray(draftAnswers.opportunityId, opportunityIds))
              .orderBy(asc(draftAnswers.createdAt))
          : Promise.resolve([]),
        opportunityIds.length > 0
          ? db
              .select()
              .from(tasks)
              .where(inArray(tasks.opportunityId, opportunityIds))
              .orderBy(asc(tasks.createdAt))
          : Promise.resolve([]),
        opportunityIds.length > 0
          ? db
              .select()
              .from(reportingCalendar)
              .where(inArray(reportingCalendar.opportunityId, opportunityIds))
              .orderBy(asc(reportingCalendar.dueDate))
          : Promise.resolve([]),
        funderIds.length > 0
          ? db.select().from(funders).where(inArray(funders.id, funderIds))
          : Promise.resolve([]),
        funderIds.length > 0
          ? db
              .select()
              .from(funderFilings)
              .where(inArray(funderFilings.funderId, funderIds))
              .orderBy(desc(funderFilings.taxYear), asc(funderFilings.createdAt))
          : Promise.resolve([]),
      ]);

    const programNameById = new Map(programRows.map((row) => [row.id, row.name]));
    const funderById = new Map(funderRows.map((row) => [row.id, row]));
    const requirementsByOpportunityId = this.groupBy(requirementRows, (row) => row.opportunityId);
    const draftsByOpportunityId = this.groupBy(draftRows, (row) => row.opportunityId);
    const tasksByOpportunityId = this.groupBy(
      taskRows.filter((row) => normalizeText(row.opportunityId)),
      (row) => row.opportunityId ?? "",
    );
    const reportsByOpportunityId = this.groupBy(reportingRows, (row) => row.opportunityId);
    const filingsByFunderId = this.groupBy(filingRows, (row) => row.funderId);
    const lessonsByFunderId = this.groupBy(lessonRows, (row) => row.funderId);
    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));

    await this.notionClient.syncOrganizationProfile({
      legalName: organization.legalName,
      ein: organization.ein,
      mission: organization.mission,
      annualBudget: organization.annualBudget,
      staffSize: organization.staffCount,
      foundingYear: organization.foundedYear,
      executiveDirector: organization.executiveDirector,
      grantsContact: organization.grantsContact,
      address: organization.address,
      serviceArea: organization.serviceArea,
      programAreas: organization.programSummary,
      website: organization.website,
    });

    for (const row of programRows) {
      await this.notionClient.syncProgramRecord({
        organizationName: organization.legalName,
        programName: row.name,
        targetPopulation: row.targetPopulation,
        geography: row.geography,
        goals: row.description ?? row.theoryOfChange,
        outcomes: row.keyOutcomes ?? row.description,
        metrics: row.theoryOfChange,
        programBudget: row.programBudget,
        programLead: row.programLead,
        strategicPriority: row.status,
      });
    }

    for (const row of evidenceRows) {
      await this.notionClient.syncEvidenceLibraryEntry({
        programName: programNameById.get(row.programId ?? "") ?? organization.legalName,
        evidenceTitle: row.title,
        evidenceType: row.evidenceType,
        summary: row.content,
        metrics: row.content,
        geography: row.programId ? programRows.find((program) => program.id === row.programId)?.geography : null,
        sourceDocument: row.sourceDocument,
        qualityScore: row.reliabilityRating,
        reusabilityScore:
          typeof row.reliabilityRating === "number" && row.reliabilityRating >= 0.8
            ? "High"
            : typeof row.reliabilityRating === "number" && row.reliabilityRating >= 0.5
              ? "Medium"
              : null,
        collectedAt: row.collectedAt,
        tags: row.tags,
      });
    }

    for (const row of budgetRows) {
      await this.notionClient.syncBudgetEntry({
        programName: programNameById.get(row.programId ?? "") ?? organization.legalName,
        budgetName: row.name,
        fiscalYear: row.fiscalYear,
        budgetType: row.budgetType,
        totalRevenue: row.totalRevenue,
        totalExpense: row.totalExpense,
        notes: row.lineItems ?? row.restrictedVsUnrestricted,
      });
    }

    for (const row of documentRows) {
      await this.notionClient.syncDocumentVaultEntry({
        organizationName: organization.legalName,
        documentName: row.name,
        category: row.documentType,
        uploadStatus: row.uploadStatus,
        owner: row.owner,
        expirationDate: row.expirationDate,
        fileUrl: row.fileUrl,
      });
    }

    for (const funder of funderRows) {
      const parsedInsights = this.parseFunderInsights(funder.relationshipHistory);
      await this.notionClient.syncFunderIntelligence({
        funderName: funder.name,
        ein: funder.ein,
        website: funder.website,
        issueAreas:
          parsedInsights?.issueAreaConcentration?.length
            ? parsedInsights.issueAreaConcentration
            : parseList(funder.prioritySignals),
        givingSummary: buildNotionGivingSummary({
          givingSummary: funder.givingSummary,
          insights: parsedInsights,
        }),
        averageGrant: funder.averageGrant,
        medianGrant: funder.medianGrant,
        geographicFocus:
          parsedInsights?.topGeographies?.length
            ? parsedInsights.topGeographies
            : parseList(funder.geographicFocus),
        grantDnaTopTerms:
          funder.grantDnaTopTerms ||
          parsedInsights?.grantDna?.topTerms
            ?.map((entry) => normalizeText(entry.term))
            .filter(Boolean)
            .join(", ") ||
          null,
        framingStyle: funder.narrativeStyle,
        toneSummary: funder.toneNotes,
        notes: funder.relationshipHistory,
        smallOrgFriendly: toNotionSmallOrgFriendly(parsedInsights?.smallOrgFriendly?.label),
        filings: (filingsByFunderId.get(funder.id) ?? []).map((filing) => ({
          taxYear: filing.taxYear,
          filingType:
            filing.filingType === "990-PF" || filing.filingType === "990"
              ? filing.filingType
              : "Other",
          parsedStatus: this.toSupportedParsedStatus(filing.parsedStatus),
          grantCount: filing.grantsCount,
          totalGrants: filing.grantsTotalAmount,
          sourceUrl: filing.sourceUrl,
        })),
      });
    }

    for (const opportunity of opportunityRows) {
      const funder = funderById.get(opportunity.funderId);
      const scopedRequirements = requirementsByOpportunityId.get(opportunity.id) ?? [];

      await this.notionClient.syncOpportunityIntake({
        opportunityId: opportunity.id,
        funderName: funder?.name ?? "Unknown funder",
        funderWebsite: funder?.website ?? undefined,
        sourceUrl: opportunity.sourceUrl ?? undefined,
        opportunityTitle: opportunity.title,
        deadline: opportunity.deadline,
        submissionMethod: opportunity.submissionMethod,
        portalUrl: opportunity.portalUrl,
        requirements: scopedRequirements.map((requirement) => ({
          questionText: requirement.questionText,
          requirementType: requirement.requirementType,
          wordLimit: requirement.wordLimit,
        })),
      });

      await this.notionClient.syncOpportunityStatus({
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        status: opportunity.status,
      });

      if (opportunity.sourceUrl || opportunity.portalUrl || opportunity.submissionMethod) {
        await this.notionClient.syncOpportunityPortalDiscovery({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          sourceUrl: opportunity.sourceUrl,
          portalUrl: opportunity.portalUrl,
          submissionMethod: opportunity.submissionMethod,
        });
      }

      if (
        typeof opportunity.fitScore === "number" ||
        typeof opportunity.evidenceCoveragePercent === "number" ||
        typeof opportunity.effortEstimateHours === "number"
      ) {
        await this.notionClient.syncOpportunityAnalysis({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          funderName: funder?.name ?? null,
          status: opportunity.status,
          deadline: opportunity.deadline,
          submissionPlatform: opportunity.submissionMethod,
          sourceUrl: opportunity.sourceUrl,
          portalUrl: opportunity.portalUrl,
          fitScorePercent: opportunity.fitScore ?? 0,
          pursueDecision: this.toSupportedPursueDecision(opportunity.pursueDecision),
          evidenceCoveragePercent: opportunity.evidenceCoveragePercent ?? 0,
          effortHours: opportunity.effortEstimateHours ?? 0,
          reportingBurdenScore: opportunity.reportingBurdenScore ?? null,
          priorityScore: this.computePriorityScore(opportunity),
          nextBestAction: this.buildNextBestAction(opportunity),
          tasks: (tasksByOpportunityId.get(opportunity.id) ?? []).map((task) => ({
            title: task.description,
            priority: this.toSupportedPriority(task.priority),
            status: this.toSupportedTaskStatus(task.status),
            dueDate: task.dueDate,
            assignee: task.assignee,
            blocking: Boolean(task.blockingDependency),
          })),
          requirements: scopedRequirements.map((requirement) => ({
            questionText: requirement.questionText,
            required: normalizeText(requirement.approvalStatus).toLowerCase() !== "optional",
            coverageStatus: this.toSupportedCoverageStatus(requirement.coverageStatus),
            riskLevel: riskLevelFromCoverage(requirement.coverageStatus),
            note:
              normalizeText(requirement.reviewerNotes) ||
              "Coverage and risk were synced from the local analysis record.",
            riskFlag: requirement.reviewerNotes,
          })),
        });
      }

      const scopedDrafts = draftsByOpportunityId.get(opportunity.id) ?? [];
      if (scopedDrafts.length > 0) {
        await this.notionClient.syncDraftAnswers({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          drafts: scopedDrafts.map((draft) => ({
            requirementId: draft.requirementId,
            requirementText:
              requirementById.get(draft.requirementId)?.questionText ?? `Requirement ${draft.requirementId}`,
            status: this.toSupportedDraftStatus(draft.status),
            draftText: draft.draftText,
            evidenceCitations: parseJsonArray(draft.evidenceCitations),
            dnaMatchPercent: draft.dnaMatchScore ?? 0,
            unsupportedClaims: parseJsonArray(draft.unsupportedClaims),
            reviewerNotes: draft.reviewerComments,
          })),
        });
      }

      const scopedReports = reportsByOpportunityId.get(opportunity.id) ?? [];
      if (scopedReports.length > 0) {
        const reportingTemplateDrafts = scopedDrafts
          .filter((draft) => {
            const requirement = requirementById.get(draft.requirementId);
            return normalizeText(requirement?.requirementType).toLowerCase() ===
              "reporting template";
          })
          .map((draft) => ({
            title:
              requirementById.get(draft.requirementId)?.questionText ?? "Reporting template",
            templateLink: null,
          }));

        await this.notionClient.syncReportingWorkflow({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          metricsToTrack: this.collectMetricsToTrack(scopedReports),
          templates: reportingTemplateDrafts,
          reports: scopedReports.map((report) => ({
            title: report.reportName,
            dueDate: report.dueDate,
            status: this.toSupportedReportStatus(report.status),
            owner: report.owner,
            reportingPeriod: report.reportingPeriod,
            requiredMetrics: report.requiredMetrics,
            templateLink: report.templateLink,
          })),
          tasks: (tasksByOpportunityId.get(opportunity.id) ?? []).map((task) => ({
            title: task.description,
            priority: this.toSupportedPriority(task.priority),
            status: this.toSupportedTaskStatus(task.status),
            dueDate: task.dueDate,
            assignee: task.assignee,
            blocking: Boolean(task.blockingDependency),
          })),
        });
      }
    }

    for (const [funderId, scopedLessons] of lessonsByFunderId.entries()) {
      const funder = funderById.get(funderId);
      if (!funder || scopedLessons.length === 0) {
        continue;
      }

      await this.notionClient.syncLessonsMemory({
        lessons: scopedLessons.map((lesson) => {
          const opportunityTitle = opportunityRows.find(
            (row) => row.id === lesson.opportunityId,
          )?.title;

          return {
            title: buildLessonTitle({
              funderName: funder.name,
              opportunityTitle,
              createdAt: lesson.createdAt,
            }),
            funderName: funder.name,
            opportunityTitle,
            result: "Rejected",
            feedbackText: lesson.feedbackText,
            themes: parseJsonArray(lesson.themes),
            recommendations: lesson.recommendations,
            appliesNextCycle: Boolean(lesson.appliesNextCycle),
            recordedAt: lesson.createdAt,
            appendToFunderPage: true,
          };
        }) satisfies NotionLessonsMemorySyncInput["lessons"],
      });
    }

    for (const log of logRows) {
      await this.notionClient.syncStoredAgentLog({
        logId: log.id,
        runId: log.runId,
        agentName: log.agentName,
        actionDescription: log.actionDescription,
        summary: log.outputSummary,
        source: log.sourceUrl,
        sourceUrl: log.sourceUrl,
        confidenceLevel: log.confidenceLevel,
        followUpRequired: Boolean(log.followUpRequired),
        createdAt: log.createdAt,
      });
    }

    const status = await this.notionClient.getSyncStatus();
    const syncedAt = status.lastSyncedAt ?? new Date().toISOString();
    const counts = {
      organization: 1,
      programs: programRows.length,
      evidence: evidenceRows.length,
      budgets: budgetRows.length,
      documents: documentRows.length,
      funders: funderRows.length,
      opportunities: opportunityRows.length,
      requirements: requirementRows.length,
      drafts: draftRows.length,
      lessons: lessonRows.length,
      reportingEntries: reportingRows.length,
      tasks: taskRows.length,
      agentLogs: logRows.length,
    };

    this.logger.info(
      {
        organizationId: organization.id,
        organizationName: organization.legalName,
        counts,
        syncedAt,
      },
      "Completed manual Notion workspace sync",
    );

    return {
      organizationId: organization.id,
      organizationName: organization.legalName,
      syncedAt,
      status,
      counts,
    };
  }

  private async requireOrganization(organizationId: string, clerkUserId?: string | null) {
    const normalizedOrganizationId = normalizeText(organizationId);
    if (!normalizedOrganizationId) {
      throw new Error("Workspace sync requires an organizationId.");
    }

    const [organization] = clerkUserId
      ? await db
          .select()
          .from(organizations)
          .where(
            and(
              eq(organizations.id, normalizedOrganizationId),
              eq(organizations.clerkUserId, normalizeText(clerkUserId)),
            ),
          )
          .limit(1)
      : await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, normalizedOrganizationId))
          .limit(1);

    if (!organization) {
      throw new Error("Organization does not belong to the requested Clerk user.");
    }

    return organization;
  }

  private groupBy<T>(rows: T[], getKey: (row: T) => string) {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const key = normalizeText(getKey(row));
      if (!key) {
        continue;
      }
      const current = grouped.get(key) ?? [];
      current.push(row);
      grouped.set(key, current);
    }
    return grouped;
  }

  private parseFunderInsights(value?: string | null): StoredFunderInsights | null {
    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }

    try {
      return JSON.parse(normalized) as StoredFunderInsights;
    } catch {
      return null;
    }
  }

  private toSupportedCoverageStatus(
    value?: string | null,
  ): "Green" | "Amber" | "Red" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "green") {
      return "Green";
    }
    if (normalized === "amber") {
      return "Amber";
    }
    return "Red";
  }

  private toSupportedDraftStatus(
    value?: string | null,
  ): "Not Started" | "Drafting" | "Needs Review" | "Approved" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "approved") {
      return "Approved";
    }
    if (normalized === "needs review") {
      return "Needs Review";
    }
    if (normalized === "drafting") {
      return "Drafting";
    }
    return "Not Started";
  }

  private toSupportedPursueDecision(
    value?: string | null,
  ): "Pursue Now" | "Revisit Later" | "Skip" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "pursue" || normalized === "pursue now") {
      return "Pursue Now";
    }
    if (normalized === "revisit" || normalized === "revisit later") {
      return "Revisit Later";
    }
    return "Skip";
  }

  private toSupportedPriority(value?: string | null): "Low" | "Medium" | "High" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "low") {
      return "Low";
    }
    if (normalized === "high" || normalized === "critical") {
      return "High";
    }
    return "Medium";
  }

  private toSupportedTaskStatus(
    value?: string | null,
  ): "To Do" | "In Progress" | "Blocked" | "Done" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "done") {
      return "Done";
    }
    if (normalized === "in progress") {
      return "In Progress";
    }
    if (normalized === "blocked") {
      return "Blocked";
    }
    return "To Do";
  }

  private toSupportedParsedStatus(
    value?: string | null,
  ): "Queued" | "Parsed" | "Partial" | "Failed" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "parsed") {
      return "Parsed";
    }
    if (normalized === "partial") {
      return "Partial";
    }
    if (normalized === "failed") {
      return "Failed";
    }
    return "Queued";
  }

  private toSupportedReportStatus(
    value?: string | null,
  ): "Not started" | "In Progress" | "Submitted" | "Overdue" {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "submitted") {
      return "Submitted";
    }
    if (normalized === "overdue") {
      return "Overdue";
    }
    if (normalized === "in progress") {
      return "In Progress";
    }
    return "Not started";
  }

  private collectMetricsToTrack(rows: Array<typeof reportingCalendar.$inferSelect>) {
    return [...new Set(rows.flatMap((row) => parseJsonArray(row.requiredMetrics)))];
  }

  private computePriorityScore(opportunity: typeof opportunities.$inferSelect) {
    const fitScore = opportunity.fitScore ?? 0;
    const evidenceCoverage = opportunity.evidenceCoveragePercent ?? 0;
    const effortHours = opportunity.effortEstimateHours ?? 0;
    const deadlineProximityScore = this.computeDeadlineProximityScore(opportunity.deadline);
    return Math.round(
      (fitScore * 0.4 + evidenceCoverage * 0.3 + deadlineProximityScore * 0.2 - effortHours * 0.1) *
        10,
    ) / 10;
  }

  private computeDeadlineProximityScore(deadline?: string | null) {
    const normalizedDeadline = normalizeText(deadline);
    if (!normalizedDeadline) {
      return 50;
    }

    const deadlineMs = Date.parse(normalizedDeadline);
    if (!Number.isFinite(deadlineMs)) {
      return 50;
    }

    const daysUntilDeadline = Math.round((deadlineMs - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilDeadline <= 7) {
      return 90;
    }
    if (daysUntilDeadline <= 21) {
      return 75;
    }
    if (daysUntilDeadline <= 45) {
      return 60;
    }
    return 45;
  }

  private buildNextBestAction(opportunity: typeof opportunities.$inferSelect) {
    const decision = this.toSupportedPursueDecision(opportunity.pursueDecision);
    if (decision === "Pursue Now") {
      return "Run evidence mapping and begin drafting";
    }
    if (decision === "Revisit Later") {
      return "Close evidence gaps before investing more drafting time";
    }
    return "Skip for now and redirect time to higher-fit opportunities";
  }
}
