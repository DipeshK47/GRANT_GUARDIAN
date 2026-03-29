import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  budgets,
  documents,
  draftAnswers,
  organizations,
  opportunities,
  requirements,
  submissions,
  submissionFieldMappings,
  submissionSessions,
} from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import {
  annotatePortalFieldInventory,
  type PortalFieldInventoryDescriptor,
  type PortalFieldProfileHint,
} from "./portal-schema.js";
import { SubmissionUploadStagingService } from "./submission-upload-staging.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type PortalMappingFieldType = "Long Text" | "File Upload";
type PortalMappingFillAction = "type" | "upload" | "manual-review";
type PortalMappingSourceKind =
  | "draft_answer"
  | "document"
  | "budget"
  | "organization_profile";
type PortalMappingStatus = "Planned" | "Filled" | "Needs Review" | "Skipped" | "Paused";

export type PortalFieldMappingInput = {
  submissionSessionId: string;
  syncToNotion?: boolean;
};

export type PlannedPortalFieldMapping = {
  id: string;
  requirementId?: string | null;
  fieldLabel: string;
  fieldType: PortalMappingFieldType;
  sourceKind: PortalMappingSourceKind;
  sourceRecordId?: string | null;
  fillAction: PortalMappingFillAction;
  mappingStatus: PortalMappingStatus;
  plannedValue?: string | null;
  artifactTitle?: string | null;
  confidence: number;
  needsHumanReview: boolean;
  notes?: string | null;
};

export type PortalFieldPlanResult = {
  submissionSessionId: string;
  submissionRecordId: string;
  opportunityId: string;
  opportunityTitle: string;
  portalUrl: string;
  mappingSummary: {
    totalMappings: number;
    narrativeMappings: number;
    attachmentMappings: number;
    manualReviewCount: number;
    uploadReadyCount: number;
  };
  mappings: PlannedPortalFieldMapping[];
  guidedFillCommand: string;
  notionSync?: {
    submissionPageId: string;
  };
};

export type PortalFieldInventoryItem = PortalFieldInventoryDescriptor;

export type PortalFieldMatchResult = {
  mappingId: string;
  portalFieldKey?: string;
  matchedPortalLabel?: string;
  confidence: number;
  fillAction: PortalMappingFillAction;
  shouldAutofill: boolean;
  notes?: string;
};

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const tokenize = (value?: string | null) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const uniqueTokens = (value?: string | null) => [...new Set(tokenize(value))];

const scoreOverlap = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const overlap = right.filter((token) => leftSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
};

const resolveLocalUploadPath = (fileLink?: string | null) => {
  const normalized = normalizeText(fileLink);
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return null;
  }

  const candidatePath = normalized.startsWith("/")
    ? normalized
    : resolve(PROJECT_ROOT, normalized);
  return existsSync(candidatePath) ? candidatePath : null;
};

const buildOrganizationProfileMappings = (
  organization?: typeof organizations.$inferSelect | null,
) => {
  if (!organization) {
    return [] as Array<{
      fieldLabel: string;
      plannedValue: string;
      notes: string;
    }>;
  }

  const annualBudget =
    typeof organization.annualBudget === "number" && Number.isFinite(organization.annualBudget)
      ? Math.round(organization.annualBudget).toString()
      : "";
  const foundedYear =
    typeof organization.foundedYear === "number" && Number.isFinite(organization.foundedYear)
      ? String(organization.foundedYear)
      : "";

  return [
    {
      fieldLabel: "Organization name",
      plannedValue: normalizeText(organization.dbaName) || normalizeText(organization.legalName),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Legal organization name",
      plannedValue: normalizeText(organization.legalName),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Employer Identification Number (EIN)",
      plannedValue: normalizeText(organization.ein),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Mailing address",
      plannedValue: normalizeText(organization.address),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Executive director name",
      plannedValue: normalizeText(organization.executiveDirector),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Annual operating budget",
      plannedValue: annualBudget,
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Founded year",
      plannedValue: foundedYear,
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Grants contact",
      plannedValue: normalizeText(organization.grantsContact),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Organization phone",
      plannedValue: normalizeText(organization.phone),
      notes: "Auto-fill from the workspace organization profile.",
    },
    {
      fieldLabel: "Organization website",
      plannedValue: normalizeText(organization.website),
      notes: "Auto-fill from the workspace organization profile.",
    },
  ].filter((mapping) => Boolean(mapping.plannedValue));
};

export const scorePortalFieldMatch = (
  mapping: Pick<PlannedPortalFieldMapping, "fieldLabel" | "fieldType">,
  field: PortalFieldInventoryItem,
  profileHint?: PortalFieldProfileHint,
) => {
  const mappingTokens = uniqueTokens(mapping.fieldLabel);
  const fieldTokens = uniqueTokens(
    [field.label, field.placeholder, field.ariaLabel].filter(Boolean).join(" "),
  );
  let score = scoreOverlap(mappingTokens, fieldTokens);

  const normalizedLabel = normalizeText(field.label).toLowerCase();
  const normalizedFieldType = normalizeText(field.type).toLowerCase();

  if (mapping.fieldType === "Long Text" && field.tagName.toLowerCase() === "textarea") {
    score += 0.2;
  }
  if (
    mapping.fieldType === "File Upload" &&
    (normalizedFieldType === "file" || normalizedLabel.includes("upload"))
  ) {
    score += 0.25;
  }

  if (
    profileHint &&
    normalizeText(profileHint.lastMappedFieldLabel).toLowerCase() ===
      normalizeText(mapping.fieldLabel).toLowerCase()
  ) {
    score += 0.22;
  }
  if (profileHint && profileHint.timesMatched > 0) {
    score += 0.05;
  }

  return Math.min(1, Number(score.toFixed(3)));
};

export const matchPortalFieldsToMappings = (
  mappings: PlannedPortalFieldMapping[],
  fields: PortalFieldInventoryItem[],
  profileHints: PortalFieldProfileHint[] = [],
) => {
  const matches: PortalFieldMatchResult[] = [];
  const usedFieldKeys = new Set<string>();
  const annotatedFields = annotatePortalFieldInventory(fields);
  const profileBySignature = new Map(
    profileHints.map((profile) => [
      `${profile.fieldType}::${profile.normalizedLabel}::${profile.occurrenceIndex}`,
      profile,
    ]),
  );

  for (const mapping of mappings) {
    const scored = annotatedFields
      .map((field) => ({
        field,
        profileHint: profileBySignature.get(field.portalSignature),
        score: scorePortalFieldMatch(
          mapping,
          field,
          profileBySignature.get(field.portalSignature),
        ),
      }))
      .filter((item) => item.score >= 0.28)
      .sort((left, right) => right.score - left.score);

    const best = scored[0];
    const second = scored[1];
    const ambiguous =
      best !== undefined &&
      second !== undefined &&
      Math.abs(best.score - second.score) < 0.08;
    const shouldAutofill =
      best !== undefined &&
      !ambiguous &&
      !usedFieldKeys.has(best.field.key) &&
      mapping.fillAction === "type" &&
      best.score >= 0.45;

    if (best && shouldAutofill) {
      usedFieldKeys.add(best.field.key);
    }

    matches.push({
      mappingId: mapping.id,
      portalFieldKey: best?.field.key,
      matchedPortalLabel: best?.field.label,
      confidence: Number((best?.score ?? mapping.confidence).toFixed(3)),
      fillAction: mapping.fillAction,
      shouldAutofill,
      notes: ambiguous
        ? "Multiple similar portal fields were detected, so human review is still recommended."
        : best?.profileHint &&
            normalizeText(best.profileHint.lastMappedFieldLabel).toLowerCase() ===
              normalizeText(mapping.fieldLabel).toLowerCase()
          ? "Reused a previously learned field profile for this portal."
          : undefined,
    });
  }

  return matches;
};

export class SubmissionFormFillService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly uploadStagingService: SubmissionUploadStagingService,
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

  async prepare(input: PortalFieldMappingInput): Promise<PortalFieldPlanResult> {
    const [session] = await db
      .select()
      .from(submissionSessions)
      .where(eq(submissionSessions.id, input.submissionSessionId))
      .limit(1);
    if (!session) {
      throw new Error("No submission session exists for the provided submissionSessionId.");
    }

    const [
      [submission],
      [opportunity],
      [organization],
      requirementRows,
      draftRows,
      documentRows,
      budgetRows,
      stagedArtifactRows,
    ] =
      await Promise.all([
        db.select().from(submissions).where(eq(submissions.id, session.submissionId)).limit(1),
        db.select().from(opportunities).where(eq(opportunities.id, session.opportunityId)).limit(1),
        session.organizationId
          ? db
              .select()
              .from(organizations)
              .where(eq(organizations.id, session.organizationId))
              .limit(1)
          : Promise.resolve([]),
        db.select().from(requirements).where(eq(requirements.opportunityId, session.opportunityId)),
        db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, session.opportunityId)),
        db.select().from(documents),
        db.select().from(budgets),
        this.uploadStagingService
          .stage({
            submissionSessionId: session.id,
            syncToNotion: false,
          })
          .then((result) => result.artifacts),
      ]);

    if (!submission) {
      throw new Error("The submission session references a missing submission record.");
    }
    if (!opportunity) {
      throw new Error("The submission session references a missing opportunity record.");
    }
    if (!["Submittable", "Portal"].includes(normalizeText(submission.method))) {
      throw new Error(
        `Portal field planning is only available for browser-based submission methods. This submission uses ${normalizeText(submission.method) || "Other"}.`,
      );
    }

    const draftByRequirementId = new Map(draftRows.map((draft) => [draft.requirementId, draft]));
    const documentById = new Map(documentRows.map((row) => [row.id, row]));
    const budgetById = new Map(budgetRows.map((row) => [row.id, row]));
    const stagedArtifactByRequirementId = new Map(
      stagedArtifactRows.map((artifact) => [artifact.requirementId, artifact]),
    );
    const mappings: PlannedPortalFieldMapping[] = [];
    const now = new Date().toISOString();

    await db
      .delete(submissionFieldMappings)
      .where(eq(submissionFieldMappings.submissionSessionId, session.id));

    for (const organizationMapping of buildOrganizationProfileMappings(organization ?? null)) {
      mappings.push({
        id: randomUUID(),
        requirementId: null,
        fieldLabel: organizationMapping.fieldLabel,
        fieldType: "Long Text",
        sourceKind: "organization_profile",
        sourceRecordId: organization?.id ?? null,
        fillAction: "type",
        mappingStatus: "Planned",
        plannedValue: organizationMapping.plannedValue,
        confidence: 0.98,
        needsHumanReview: false,
        notes: organizationMapping.notes,
      });
    }

    for (const requirement of requirementRows) {
      const questionText = normalizeText(requirement.questionText);
      const requirementType = normalizeText(requirement.requirementType);
      const draft = draftByRequirementId.get(requirement.id);

      const isAttachment =
        requirementType.toLowerCase().includes("document") ||
        questionText.toLowerCase().includes("budget") ||
        questionText.toLowerCase().includes("determination letter");

      if (!isAttachment) {
        if (!draft || normalizeText(draft.status) !== "Approved") {
          continue;
        }

        const mapping: PlannedPortalFieldMapping = {
          id: randomUUID(),
          requirementId: requirement.id,
          fieldLabel: questionText,
          fieldType: "Long Text",
          sourceKind: "draft_answer",
          sourceRecordId: draft.id,
          fillAction: "type",
          mappingStatus: "Planned",
          plannedValue: draft.draftText,
          confidence: 0.94,
          needsHumanReview: false,
          notes:
            "Approved narrative draft is ready for guided portal fill. Grant Guardian will still stop short of any submit click.",
        };

        mappings.push(mapping);
        continue;
      }

      const linkedRefs = normalizeText(requirement.linkedEvidenceIds)
        .split(",")
        .map((value) => normalizeText(value))
        .filter(Boolean);
      const candidateDocuments = linkedRefs
        .filter((ref) => ref.startsWith("document:"))
        .map((ref) => documentById.get(ref.replace("document:", "")))
        .filter(Boolean);
      const candidateBudgets = linkedRefs
        .filter((ref) => ref.startsWith("budget:"))
        .map((ref) => budgetById.get(ref.replace("budget:", "")))
        .filter(Boolean);

      const preferredDocument = candidateDocuments.find(
        (row) => resolveLocalUploadPath(row?.fileLink) !== null,
      ) ?? candidateDocuments[0];
      const preferredBudget = candidateBudgets[0];
      const sourceRow = preferredDocument ?? preferredBudget;
      const sourceKind: PortalMappingSourceKind = preferredDocument ? "document" : "budget";
      const stagedArtifact = stagedArtifactByRequirementId.get(requirement.id);
      const localUploadPath = preferredDocument
        ? resolveLocalUploadPath(preferredDocument.fileLink)
        : null;
      const stagedUploadPath =
        stagedArtifact?.stagingStatus !== "Missing Source"
          ? normalizeText(stagedArtifact?.stagedPath)
          : "";
      const uploadReady = Boolean(stagedUploadPath || localUploadPath);
      const uploadPath = stagedUploadPath || localUploadPath;
      const uploadNote =
        stagedArtifact?.stagingStatus === "Generated"
          ? "Generated upload package selected for guided portal fill."
          : stagedArtifact?.stagingStatus === "Staged"
            ? "Staged local upload file selected for guided portal fill."
            : uploadReady
              ? "Upload candidate selected for guided portal fill."
          : "A matching attachment exists, but no local file path is available for auto-upload yet, so manual file selection is still recommended.";

      const mapping: PlannedPortalFieldMapping = {
        id: randomUUID(),
        requirementId: requirement.id,
        fieldLabel: questionText,
        fieldType: "File Upload",
        sourceKind:
          stagedArtifact?.sourceKind === "budget" || stagedArtifact?.sourceKind === "document"
            ? stagedArtifact.sourceKind
            : sourceKind,
        sourceRecordId: stagedArtifact?.sourceRecordId ?? sourceRow?.id,
        fillAction: uploadReady ? "upload" : "manual-review",
        mappingStatus: "Planned",
        plannedValue: uploadPath || null,
        artifactTitle: stagedArtifact?.artifactTitle ?? sourceRow?.name ?? null,
        confidence:
          stagedArtifact?.stagingStatus === "Generated" || stagedArtifact?.stagingStatus === "Staged"
            ? 0.96
            : preferredDocument
              ? 0.9
              : 0.72,
        needsHumanReview: !uploadReady,
        notes: uploadNote,
      };

      mappings.push(mapping);
    }

    if (mappings.length === 0) {
      throw new Error("No portal field mappings could be prepared for this submission session.");
    }

    await db.insert(submissionFieldMappings).values(
      mappings.map((mapping) => ({
        id: mapping.id,
        organizationId: session.organizationId ?? opportunity.organizationId ?? null,
        submissionSessionId: session.id,
        submissionId: submission.id,
        opportunityId: opportunity.id,
        requirementId: mapping.requirementId ?? null,
        fieldLabel: mapping.fieldLabel,
        fieldType: mapping.fieldType,
        sourceKind: mapping.sourceKind,
        sourceRecordId: mapping.sourceRecordId ?? null,
        fillAction: mapping.fillAction,
        mappingStatus: mapping.mappingStatus,
        plannedValue: mapping.plannedValue ?? null,
        artifactTitle: mapping.artifactTitle ?? null,
        confidence: mapping.confidence,
        needsHumanReview: mapping.needsHumanReview,
        notes: mapping.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const mappingSummary = {
      totalMappings: mappings.length,
      narrativeMappings: mappings.filter((mapping) => mapping.fieldType === "Long Text").length,
      attachmentMappings: mappings.filter((mapping) => mapping.fieldType === "File Upload").length,
      manualReviewCount: mappings.filter((mapping) => mapping.needsHumanReview).length,
      uploadReadyCount: mappings.filter((mapping) => mapping.fillAction === "upload").length,
    };

    const portalReference = `Portal field plan ready with ${mappingSummary.narrativeMappings} narrative field(s) and ${mappingSummary.attachmentMappings} attachment field(s). ${mappingSummary.uploadReadyCount} attachment field(s) are upload-ready and ${mappingSummary.manualReviewCount} field(s) still need human review before or during guided fill.`;

    await db
      .update(submissions)
      .set({
        portalReference,
        updatedAt: now,
      })
      .where(eq(submissions.id, submission.id));

    await db
      .update(submissionSessions)
      .set({
        status: "Field Plan Ready",
        updatedAt: now,
      })
      .where(eq(submissionSessions.id, session.id));

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Portal Mapping Agent",
      actionDescription: "Prepared portal-aware field mapping plan for guided form fill",
      confidenceLevel: 0.9,
      outputSummary: `Prepared ${mappingSummary.totalMappings} portal field mapping(s) for '${opportunity.title}'.`,
      followUpRequired: mappingSummary.manualReviewCount > 0,
    });

    let notionSync: PortalFieldPlanResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncSubmissionPacket({
          opportunityTitle: opportunity.title,
          method:
            normalizeText(submission.method).includes("Submittable")
              ? "Submittable"
              : normalizeText(submission.method).includes("Portal")
                ? "Portal"
                : "Other",
          readyStatus: "Ready",
          portalUrl: session.portalUrl,
          portalReference,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for portal field plan");
      }
    }

    return {
      submissionSessionId: session.id,
      submissionRecordId: submission.id,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      portalUrl: session.portalUrl,
      mappingSummary,
      mappings,
      guidedFillCommand: [
        JSON.stringify(process.execPath),
        JSON.stringify(resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs")),
        JSON.stringify(resolve(PROJECT_ROOT, "scripts/open-submission-handoff.ts")),
        `--submission-session-id=${JSON.stringify(session.id)}`,
        `--portal-url=${JSON.stringify(session.portalUrl)}`,
        `--opportunity-title=${JSON.stringify(opportunity.title)}`,
      ].join(" "),
      notionSync,
    };
  }
}
