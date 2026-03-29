import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  budgets,
  documents,
  draftAnswers,
  funders,
  opportunities,
  requirements,
  submissions,
} from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import {
  OpportunityReviewWorkflowService,
  type OpportunitySubmissionReadiness,
} from "./review-workflow.js";
import {
  assessPortalReadiness,
  type PortalReadinessResult,
} from "./portal-discovery.js";
import {
  buildSubmissionAdapterPlan,
  type SubmissionAdapterPlan,
} from "./submission-adapters.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type RequirementKind = "narrative" | "document" | "budget" | "eligibility";
type SubmissionMethod = "Submittable" | "Email" | "Portal" | "Other";

type SubmissionNarrativeRecord = {
  requirementId: string;
  questionText: string;
  draftAnswerId: string;
  wordCount: number;
  evidenceCitations: string[];
  draftPreview: string;
};

type SubmissionAttachmentSource = {
  id: string;
  type: "document" | "budget";
  title: string;
  note?: string | null;
};

type SubmissionAttachmentRecord = {
  requirementId: string;
  questionText: string;
  requirementType: string;
  included: boolean;
  artifactType: "document" | "budget";
  selectedSources: SubmissionAttachmentSource[];
};

export type SubmissionPacketAssemblyInput = {
  opportunityId: string;
  syncToNotion?: boolean;
  confirmAutopilot?: boolean;
};

export type SubmissionPacketAssemblyResult = {
  opportunityId: string;
  opportunityTitle: string;
  funderId: string;
  funderName: string;
  submissionMethod: SubmissionMethod;
  portalUrl?: string | null;
  portalReadiness: PortalReadinessResult;
  reviewReadiness: OpportunitySubmissionReadiness;
  packet: {
    narratives: SubmissionNarrativeRecord[];
    attachments: SubmissionAttachmentRecord[];
    budgetIncluded: boolean;
  };
  completeness: {
    requiredNarratives: number;
    approvedNarrativesIncluded: number;
    requiredAttachments: number;
    approvedAttachmentsIncluded: number;
    missingItems: string[];
  };
  adapterPlan: SubmissionAdapterPlan;
  safetyGate: {
    safeToLaunchAutopilot: boolean;
    humanConfirmationRequired: boolean;
    autopilotArmed: boolean;
    blockers: string[];
  };
  submissionRecordId: string;
  notionSync?: {
    submissionPageId: string;
  };
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

const parseSupportRefs = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

const inferRequirementKind = (requirementType: string, questionText: string): RequirementKind => {
  const normalizedType = normalizeText(requirementType).toLowerCase();
  const normalizedText = normalizeText(questionText).toLowerCase();

  if (normalizedType.includes("budget") || normalizedText.includes("budget")) {
    return "budget";
  }

  if (
    normalizedType.includes("document") ||
    normalizedText.includes("determination letter") ||
    normalizedText.includes("required document")
  ) {
    return "document";
  }

  if (normalizedType.includes("eligib")) {
    return "eligibility";
  }

  return "narrative";
};

const toSupportedSubmissionMethod = (value?: string | null): SubmissionMethod => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.includes("submittable")) {
    return "Submittable";
  }
  if (normalized.includes("email")) {
    return "Email";
  }
  if (normalized.includes("portal")) {
    return "Portal";
  }
  if (normalized.startsWith("mailto:") || normalized.includes("@")) {
    return "Email";
  }
  return "Other";
};

const shortLabel = (value?: string | null, fallback = "Requirement") => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
};

const previewText = (value?: string | null, max = 180) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
};

export class SubmissionPacketService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly reviewWorkflowService: OpportunityReviewWorkflowService,
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

  async run(input: SubmissionPacketAssemblyInput): Promise<SubmissionPacketAssemblyResult> {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);
    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }

    const [requirementRows, draftRows, documentRows, budgetRows] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunity.id)),
      db.select().from(documents),
      db.select().from(budgets),
    ]);

    if (requirementRows.length === 0) {
      throw new Error("This opportunity has no requirement records to assemble.");
    }

    const reviewReadiness = await this.reviewWorkflowService.getReadiness(opportunity.id);
    const draftByRequirementId = new Map(draftRows.map((draft) => [draft.requirementId, draft]));
    const documentById = new Map(documentRows.map((document) => [document.id, document]));
    const budgetById = new Map(budgetRows.map((budget) => [budget.id, budget]));

    const narratives: SubmissionNarrativeRecord[] = [];
    const attachments: SubmissionAttachmentRecord[] = [];
    const missingItems: string[] = [];

    for (const requirement of requirementRows) {
      const requirementType = requirement.requirementType ?? "Narrative Question";
      const kind = inferRequirementKind(requirementType, requirement.questionText);

      if (kind === "narrative") {
        const draft = draftByRequirementId.get(requirement.id);
        const approved =
          draft &&
          normalizeText(draft.status) === "Approved" &&
          normalizeText(requirement.approvalStatus) === "Approved";

        if (!draft || !approved) {
          missingItems.push(
            `Narrative not approved yet: ${shortLabel(requirement.questionText)}`,
          );
          continue;
        }

        narratives.push({
          requirementId: requirement.id,
          questionText: requirement.questionText,
          draftAnswerId: draft.id,
          wordCount: draft.wordCount ?? 0,
          evidenceCitations: parseJsonArray(draft.evidenceCitations),
          draftPreview: previewText(draft.draftText),
        });
        continue;
      }

      if (kind === "eligibility") {
        continue;
      }

      const refs = parseSupportRefs(requirement.linkedEvidenceIds);
      const selectedSources: SubmissionAttachmentSource[] = [];

      for (const ref of refs) {
        if (ref.startsWith("document:")) {
          const id = ref.replace("document:", "");
          const document = documentById.get(id);
          if (document) {
            selectedSources.push({
              id: document.id,
              type: "document",
              title: document.name,
              note: document.uploadStatus,
            });
          }
        }

        if (ref.startsWith("budget:")) {
          const id = ref.replace("budget:", "");
          const budget = budgetById.get(id);
          if (budget) {
            selectedSources.push({
              id: budget.id,
              type: "budget",
              title: budget.name,
              note: budget.budgetType,
            });
          }
        }
      }

      const uniqueSources = selectedSources.filter(
        (source, index, collection) =>
          collection.findIndex(
            (candidate) => candidate.id === source.id && candidate.type === source.type,
          ) === index,
      );
      const included = uniqueSources.length > 0;

      if (!included) {
        missingItems.push(
          `Attachment not linked yet: ${shortLabel(requirement.questionText)}`,
        );
      }

      attachments.push({
        requirementId: requirement.id,
        questionText: requirement.questionText,
        requirementType,
        included,
        artifactType: kind === "budget" ? "budget" : "document",
        selectedSources: uniqueSources,
      });
    }

    const requiredNarratives = requirementRows.filter(
      (requirement) =>
        inferRequirementKind(
          requirement.requirementType ?? "Narrative Question",
          requirement.questionText,
        ) === "narrative",
    ).length;
    const requiredAttachments = requirementRows.filter((requirement) => {
      const kind = inferRequirementKind(
        requirement.requirementType ?? "Narrative Question",
        requirement.questionText,
      );
      return kind === "document" || kind === "budget";
    }).length;

    const approvedAttachmentsIncluded = attachments.filter((attachment) => attachment.included).length;
    const budgetIncluded = attachments.some(
      (attachment) => attachment.artifactType === "budget" && attachment.included,
    );

    const packetBlockers = [...reviewReadiness.blockers];
    if (requiredNarratives !== narratives.length) {
      packetBlockers.push(
        `${requiredNarratives - narratives.length} narrative response(s) are still missing or not approved for the packet.`,
      );
    }
    if (requiredAttachments !== approvedAttachmentsIncluded) {
      packetBlockers.push(
        `${requiredAttachments - approvedAttachmentsIncluded} attachment requirement(s) are still missing from the packet.`,
      );
    }

    const inferredMethodFromRecord = toSupportedSubmissionMethod(opportunity.submissionMethod);
    const submissionMethod =
      inferredMethodFromRecord !== "Other"
        ? inferredMethodFromRecord
        : toSupportedSubmissionMethod(opportunity.portalUrl);
    const portalReadiness = assessPortalReadiness({
      portalUrl: opportunity.portalUrl,
      submissionMethod,
      sourceUrl: opportunity.sourceUrl,
    });
    const adapterPlan = buildSubmissionAdapterPlan({
      opportunityTitle: opportunity.title,
      funderName: funder.name,
      submissionMethod,
      portalUrl: portalReadiness.preferredBrowserUrl ?? opportunity.portalUrl,
      portalReadiness,
      baseBlockers: packetBlockers,
      narratives: narratives.map((narrative) => ({
        questionText: narrative.questionText,
        draftPreview: narrative.draftPreview,
      })),
      attachments: attachments.map((attachment) => ({
        questionText: attachment.questionText,
        included: attachment.included,
        artifactTitle: attachment.selectedSources[0]?.title ?? null,
      })),
    });

    const safetyBlockers = adapterPlan.supportsBrowserLaunch
      ? [...adapterPlan.blockers]
      : [
          ...adapterPlan.blockers,
          `Browser autopilot is not used for ${adapterPlan.adapterLabel}.`,
        ];

    const safeToLaunchAutopilot =
      adapterPlan.supportsBrowserLaunch && adapterPlan.readyForHandoff;
    const humanConfirmationRequired = safeToLaunchAutopilot && !input.confirmAutopilot;
    const autopilotArmed = safeToLaunchAutopilot && input.confirmAutopilot === true;

    const summary = this.buildPacketSummary({
      adapterPlan,
      narrativesIncluded: narratives.length,
      narrativesRequired: requiredNarratives,
      attachmentsIncluded: approvedAttachmentsIncluded,
      attachmentsRequired: requiredAttachments,
      readyForSubmission: reviewReadiness.readyForSubmission,
      safeToLaunchAutopilot,
      humanConfirmationRequired,
      autopilotArmed,
      blockers: safetyBlockers,
    });

    const submissionRecord = await this.upsertSubmissionRecord({
      organizationId: opportunity.organizationId ?? null,
      opportunityId: opportunity.id,
      method: submissionMethod,
      adapterKey: adapterPlan.adapterKey,
      portalReference: summary,
      documentsIncluded: JSON.stringify(
        attachments.map((attachment) => ({
          requirementId: attachment.requirementId,
          questionText: attachment.questionText,
          artifactType: attachment.artifactType,
          included: attachment.included,
          selectedSources: attachment.selectedSources,
        })),
      ),
      narrativesIncluded: JSON.stringify(
        narratives.map((narrative) => ({
          requirementId: narrative.requirementId,
          questionText: narrative.questionText,
          draftAnswerId: narrative.draftAnswerId,
          wordCount: narrative.wordCount,
          evidenceCitations: narrative.evidenceCitations,
        })),
      ),
      budgetIncluded,
    });

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Submission Agent",
      actionDescription: "Assembled submission packet and evaluated pre-submit automation gate",
      confidenceLevel: round(
        reviewReadiness.readyForSubmission
          ? safeToLaunchAutopilot
            ? 1
            : 0.8
          : 0.6,
        2,
      ),
      outputSummary: `Submission packet for '${opportunity.title}' includes ${narratives.length}/${requiredNarratives} narrative(s) and ${approvedAttachmentsIncluded}/${requiredAttachments} attachment(s).`,
      followUpRequired: !reviewReadiness.readyForSubmission || humanConfirmationRequired,
    });

    let notionSync: SubmissionPacketAssemblyResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncSubmissionPacket({
          opportunityTitle: opportunity.title,
          method: submissionMethod,
          readyStatus: reviewReadiness.readyForSubmission ? "Ready" : "Preparing",
          portalUrl: opportunity.portalUrl,
          portalReference: summary,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for submission packet");
      }
    }

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      funderId: funder.id,
      funderName: funder.name,
      submissionMethod,
      portalUrl: portalReadiness.preferredBrowserUrl ?? opportunity.portalUrl,
      portalReadiness,
      reviewReadiness,
      packet: {
        narratives,
        attachments,
        budgetIncluded,
      },
      completeness: {
        requiredNarratives,
        approvedNarrativesIncluded: narratives.length,
        requiredAttachments,
        approvedAttachmentsIncluded,
        missingItems,
      },
      adapterPlan,
      safetyGate: {
        safeToLaunchAutopilot,
        humanConfirmationRequired,
        autopilotArmed,
        blockers: safetyBlockers,
      },
      submissionRecordId: submissionRecord.id,
      notionSync,
    };
  }

  private buildPacketSummary(input: {
    adapterPlan: SubmissionAdapterPlan;
    narrativesIncluded: number;
    narrativesRequired: number;
    attachmentsIncluded: number;
    attachmentsRequired: number;
    readyForSubmission: boolean;
    safeToLaunchAutopilot: boolean;
    humanConfirmationRequired: boolean;
    autopilotArmed: boolean;
    blockers: string[];
  }) {
    if (input.adapterPlan.adapterKey === "email" && input.adapterPlan.readyForHandoff) {
      const recipient = input.adapterPlan.emailDraft?.recipientEmail ?? "the discovered recipient";
      return `Packet ready for email handoff with ${input.narrativesIncluded}/${input.narrativesRequired} approved narratives and ${input.attachmentsIncluded}/${input.attachmentsRequired} attachments. Draft email prepared for ${recipient}.`;
    }

    if (input.autopilotArmed) {
      return `Packet ready with ${input.narrativesIncluded}/${input.narrativesRequired} approved narratives and ${input.attachmentsIncluded}/${input.attachmentsRequired} attachments. Explicit human confirmation recorded. Safe to open ${input.adapterPlan.adapterLabel} handoff.`;
    }

    if (input.safeToLaunchAutopilot && input.humanConfirmationRequired) {
      return `Packet ready with ${input.narrativesIncluded}/${input.narrativesRequired} approved narratives and ${input.attachmentsIncluded}/${input.attachmentsRequired} attachments. Awaiting explicit human confirmation before opening ${input.adapterPlan.adapterLabel} handoff.`;
    }

    if (input.readyForSubmission) {
      return `Packet ready for submission with ${input.narrativesIncluded}/${input.narrativesRequired} approved narratives and ${input.attachmentsIncluded}/${input.attachmentsRequired} attachments. Recommended handoff: ${input.adapterPlan.adapterLabel}.`;
    }

    const blockerText =
      input.blockers.length > 0 ? ` Blockers: ${input.blockers.join(" ")}` : "";
    return `Packet still preparing with ${input.narrativesIncluded}/${input.narrativesRequired} approved narratives and ${input.attachmentsIncluded}/${input.attachmentsRequired} attachments.${blockerText}`;
  }

  private async upsertSubmissionRecord(values: {
    organizationId?: string | null;
    opportunityId: string;
    method: SubmissionMethod;
    adapterKey: SubmissionAdapterPlan["adapterKey"];
    portalReference: string;
    documentsIncluded: string;
    narrativesIncluded: string;
    budgetIncluded: boolean;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    await db
      .insert(submissions)
      .values({
        id,
        organizationId: values.organizationId ?? null,
        opportunityId: values.opportunityId,
        method: values.method,
        adapterKey: values.adapterKey,
        portalReference: values.portalReference,
        documentsIncluded: values.documentsIncluded,
        narrativesIncluded: values.narrativesIncluded,
        budgetIncluded: values.budgetIncluded,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: submissions.opportunityId,
        set: {
          updatedAt: now,
          organizationId: values.organizationId ?? null,
          method: values.method,
          adapterKey: values.adapterKey,
          portalReference: values.portalReference,
          documentsIncluded: values.documentsIncluded,
          narrativesIncluded: values.narrativesIncluded,
          budgetIncluded: values.budgetIncluded,
        },
      });

    const [submissionRecord] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.opportunityId, values.opportunityId))
      .limit(1);

    if (!submissionRecord) {
      throw new Error("Expected to find upserted submission row.");
    }

    return submissionRecord;
  }
}
