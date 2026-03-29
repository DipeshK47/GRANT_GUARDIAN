import { access, constants } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  opportunities,
  submissionFieldMappings,
  submissionSessions,
  submissions,
  submissionUploadArtifacts,
} from "../../db/schema.js";
import { normalizeScopedText } from "../../lib/organization-scope.js";
import { assessPortalReadiness, type PortalReadinessResult } from "./portal-discovery.js";
import {
  PortalSchemaProfileService,
  type PortalSchemaProfileLookupResult,
} from "./portal-schema.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type SubmissionSessionSummaryRecord = {
  id: string;
  status: string;
  launchMode: string;
  adapterKey?: string | null;
  portalUrl: string;
  portalReadiness: PortalReadinessResult;
  launchRequestedAt: string;
  launchTriggeredAt?: string | null;
  finalSubmitAuthorized: boolean;
  reviewerName?: string | null;
  storageStatePresent: boolean;
  updatedAt: string;
};

export type SubmissionSessionListResult = {
  opportunityId: string;
  opportunityTitle: string;
  submissionSessions: SubmissionSessionSummaryRecord[];
};

type SubmissionPacketAttachment = {
  requirementId?: string;
  questionText?: string;
  artifactType?: string;
  included?: boolean;
  selectedSources?: Array<{
    id?: string;
    title?: string;
    type?: string;
    status?: string;
  }>;
};

type SubmissionPacketNarrative = {
  requirementId?: string;
  questionText?: string;
  draftAnswerId?: string;
  wordCount?: number;
  evidenceCitations?: string[];
};

type SubmissionRecordDetail = {
  id: string;
  method?: string | null;
  adapterKey?: string | null;
  portalReference?: string | null;
  budgetIncluded: boolean;
  narratives: SubmissionPacketNarrative[];
  attachments: SubmissionPacketAttachment[];
};

type SubmissionFieldMappingDetail = {
  id: string;
  requirementId?: string | null;
  fieldLabel: string;
  fieldType: string;
  sourceKind: string;
  sourceRecordId?: string | null;
  fillAction: string;
  mappingStatus: string;
  plannedValue?: string | null;
  artifactTitle?: string | null;
  matchedPortalLabel?: string | null;
  confidence?: number | null;
  needsHumanReview: boolean;
  notes?: string | null;
  lastAttemptedAt?: string | null;
};

type SubmissionUploadArtifactDetail = {
  id: string;
  requirementId: string;
  sourceKind: string;
  sourceRecordId?: string | null;
  artifactTitle: string;
  fileName?: string | null;
  mimeType?: string | null;
  originalPath?: string | null;
  stagedPath?: string | null;
  stagingStatus: string;
  byteSize?: number | null;
  notes?: string | null;
};

export type SubmissionSessionDetailResult = {
  submissionSessionId: string;
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  organizationId?: string | null;
  submissionRecord: SubmissionRecordDetail;
  submissionMethod?: string | null;
  adapterKey?: string | null;
  launchStatus: string;
  launchMode: string;
  portalUrl: string;
  portalReadiness: PortalReadinessResult;
  launchRequestedAt: string;
  launchTriggeredAt?: string | null;
  launchCommand?: string | null;
  storageStatePath?: string | null;
  storageStatePresent: boolean;
  reviewerName?: string | null;
  reviewerNotes?: string | null;
  finalSubmitAuthorized: boolean;
  finalSubmitAuthorizedAt?: string | null;
  mappingSummary: {
    totalMappings: number;
    narrativeMappings: number;
    attachmentMappings: number;
    manualReviewCount: number;
    uploadReadyCount: number;
  };
  mappings: SubmissionFieldMappingDetail[];
  artifactSummary: {
    totalArtifacts: number;
    stagedArtifacts: number;
    generatedArtifacts: number;
    missingArtifacts: number;
  };
  artifacts: SubmissionUploadArtifactDetail[];
  portalProfiles: PortalSchemaProfileLookupResult;
  actionState: {
    canStageUploadArtifacts: boolean;
    canPrepareFormFill: boolean;
    canAuthorizeFinalSubmit: boolean;
    requiresSecondHumanConfirmation: boolean;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const canUseBrowserFlow = (launchMode?: string | null) =>
  launchMode === "Browser Launch" || launchMode === "Handoff Only";

const parseJsonArray = <T>(value?: string | null): T[] => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const pathExists = async (targetPath?: string | null) => {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return false;
  }

  try {
    await access(normalized, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const emptyPortalProfiles = (portalUrl: string): PortalSchemaProfileLookupResult => {
  try {
    const parsed = new URL(portalUrl);
    const portalPath = parsed.pathname.replace(/\/+$/, "") || "/";

    return {
      portalUrl,
      portalHost: parsed.host.toLowerCase(),
      portalPath,
      profileSummary: {
        totalProfiles: 0,
        matchedProfiles: 0,
        previouslyLearnedMappings: 0,
      },
      profiles: [],
    };
  } catch {
    return {
      portalUrl,
      portalHost: "unknown",
      portalPath: "/",
      profileSummary: {
        totalProfiles: 0,
        matchedProfiles: 0,
        previouslyLearnedMappings: 0,
      },
      profiles: [],
    };
  }
};

export class SubmissionSessionsService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly portalSchemaProfileService: PortalSchemaProfileService,
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

  async listByOpportunity(input: {
    opportunityId: string;
    organizationId?: string | null;
  }): Promise<SubmissionSessionListResult> {
    const opportunity = await this.resolveOpportunity(input.opportunityId);
    this.assertOpportunityScope(opportunity.organizationId, input.organizationId);

    const rows = await db
      .select()
      .from(submissionSessions)
      .where(eq(submissionSessions.opportunityId, opportunity.id))
      .orderBy(desc(submissionSessions.launchRequestedAt));

    const submissionMethod = normalizeText(opportunity.submissionMethod) || null;
    const records = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        status: row.status,
        launchMode: row.launchMode,
        adapterKey: row.adapterKey,
        portalUrl: row.portalUrl,
        portalReadiness: assessPortalReadiness({
          portalUrl: row.portalUrl,
          submissionMethod,
          sourceUrl: opportunity.sourceUrl,
        }),
        launchRequestedAt: row.launchRequestedAt,
        launchTriggeredAt: row.launchTriggeredAt,
        finalSubmitAuthorized: row.finalSubmitAuthorized,
        reviewerName: row.reviewerName,
        storageStatePresent: await pathExists(row.storageStatePath),
        updatedAt: row.updatedAt,
      })),
    );

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      submissionSessions: records,
    };
  }

  async getByOpportunity(input: {
    opportunityId: string;
    submissionSessionId: string;
    organizationId?: string | null;
  }): Promise<SubmissionSessionDetailResult> {
    const opportunity = await this.resolveOpportunity(input.opportunityId);
    this.assertOpportunityScope(opportunity.organizationId, input.organizationId);

    const [session] = await db
      .select()
      .from(submissionSessions)
      .where(
        and(
          eq(submissionSessions.id, input.submissionSessionId),
          eq(submissionSessions.opportunityId, input.opportunityId),
        ),
      )
      .limit(1);
    if (!session) {
      throw new Error(
        "No submission session exists for the provided submissionSessionId and opportunityId.",
      );
    }

    this.assertOpportunityScope(session.organizationId ?? opportunity.organizationId, input.organizationId);

    const [[submissionRecord], mappingRows, artifactRows] = await Promise.all([
      db
        .select()
        .from(submissions)
        .where(eq(submissions.id, session.submissionId))
        .limit(1),
      db
        .select()
        .from(submissionFieldMappings)
        .where(eq(submissionFieldMappings.submissionSessionId, session.id))
        .orderBy(desc(submissionFieldMappings.updatedAt)),
      db
        .select()
        .from(submissionUploadArtifacts)
        .where(eq(submissionUploadArtifacts.submissionSessionId, session.id))
        .orderBy(desc(submissionUploadArtifacts.updatedAt)),
    ]);

    if (!submissionRecord) {
      throw new Error("Submission session references a missing submission record.");
    }

    const mappings: SubmissionFieldMappingDetail[] = mappingRows.map((row) => ({
      id: row.id,
      requirementId: row.requirementId,
      fieldLabel: row.fieldLabel,
      fieldType: row.fieldType,
      sourceKind: row.sourceKind,
      sourceRecordId: row.sourceRecordId,
      fillAction: row.fillAction,
      mappingStatus: row.mappingStatus,
      plannedValue: row.plannedValue,
      artifactTitle: row.artifactTitle,
      matchedPortalLabel: row.matchedPortalLabel,
      confidence: row.confidence,
      needsHumanReview: row.needsHumanReview,
      notes: row.notes,
      lastAttemptedAt: row.lastAttemptedAt,
    }));

    const artifacts: SubmissionUploadArtifactDetail[] = artifactRows.map((row) => ({
      id: row.id,
      requirementId: row.requirementId,
      sourceKind: row.sourceKind,
      sourceRecordId: row.sourceRecordId,
      artifactTitle: row.artifactTitle,
      fileName: row.fileName,
      mimeType: row.mimeType,
      originalPath: row.originalPath,
      stagedPath: row.stagedPath,
      stagingStatus: row.stagingStatus,
      byteSize: row.byteSize,
      notes: row.notes,
    }));

    let portalProfiles: PortalSchemaProfileLookupResult;
    try {
      portalProfiles = await this.portalSchemaProfileService.getProfileHintsForSession(session.id);
    } catch (error) {
      this.logger.warn({ error, submissionSessionId: session.id }, "Falling back to empty portal profiles");
      portalProfiles = emptyPortalProfiles(session.portalUrl);
    }

    const browserFlow = canUseBrowserFlow(session.launchMode);

    return {
      submissionSessionId: session.id,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      opportunityStatus: opportunity.status,
      organizationId: session.organizationId ?? opportunity.organizationId,
      submissionRecord: {
        id: submissionRecord.id,
        method: submissionRecord.method,
        adapterKey: submissionRecord.adapterKey,
        portalReference: submissionRecord.portalReference,
        budgetIncluded: Boolean(submissionRecord.budgetIncluded),
        narratives: parseJsonArray<SubmissionPacketNarrative>(submissionRecord.narrativesIncluded),
        attachments: parseJsonArray<SubmissionPacketAttachment>(submissionRecord.documentsIncluded),
      },
      submissionMethod:
        normalizeText(submissionRecord.method) || normalizeText(opportunity.submissionMethod) || null,
      adapterKey: session.adapterKey ?? submissionRecord.adapterKey,
      launchStatus: session.status,
      launchMode: session.launchMode,
      portalUrl: session.portalUrl,
      portalReadiness: assessPortalReadiness({
        portalUrl: session.portalUrl,
        submissionMethod:
          normalizeText(submissionRecord.method) || normalizeText(opportunity.submissionMethod) || null,
        sourceUrl: opportunity.sourceUrl,
      }),
      launchRequestedAt: session.launchRequestedAt,
      launchTriggeredAt: session.launchTriggeredAt,
      launchCommand: session.launchCommand,
      storageStatePath: session.storageStatePath,
      storageStatePresent: await pathExists(session.storageStatePath),
      reviewerName: session.reviewerName,
      reviewerNotes: session.reviewerNotes,
      finalSubmitAuthorized: session.finalSubmitAuthorized,
      finalSubmitAuthorizedAt: session.finalSubmitAuthorizedAt,
      mappingSummary: {
        totalMappings: mappings.length,
        narrativeMappings: mappings.filter((mapping) => mapping.fieldType !== "File Upload").length,
        attachmentMappings: mappings.filter((mapping) => mapping.fieldType === "File Upload").length,
        manualReviewCount: mappings.filter((mapping) => mapping.needsHumanReview).length,
        uploadReadyCount: mappings.filter(
          (mapping) => mapping.fillAction === "upload" && Boolean(normalizeText(mapping.plannedValue)),
        ).length,
      },
      mappings,
      artifactSummary: {
        totalArtifacts: artifacts.length,
        stagedArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Staged").length,
        generatedArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Generated")
          .length,
        missingArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Missing Source")
          .length,
      },
      artifacts,
      portalProfiles,
      actionState: {
        canStageUploadArtifacts: browserFlow,
        canPrepareFormFill: browserFlow,
        canAuthorizeFinalSubmit: browserFlow && !session.finalSubmitAuthorized,
        requiresSecondHumanConfirmation: browserFlow,
      },
    };
  }

  private async resolveOpportunity(opportunityId: string) {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    return opportunity;
  }

  private assertOpportunityScope(
    actualOrganizationId?: string | null,
    requestedOrganizationId?: string | null,
  ) {
    const requested = normalizeScopedText(requestedOrganizationId);
    const actual = normalizeScopedText(actualOrganizationId);
    if (requested && actual && requested !== actual) {
      throw new Error("Submission session does not belong to the requested organizationId.");
    }
  }
}
