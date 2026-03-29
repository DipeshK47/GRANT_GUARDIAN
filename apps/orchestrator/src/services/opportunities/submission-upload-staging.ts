import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  agentLogs,
  budgets,
  documents,
  opportunities,
  requirements,
  submissions,
  submissionSessions,
  submissionUploadArtifacts,
} from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { FileStorageService } from "../storage/file-storage.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type UploadArtifactSourceKind = "document" | "budget";
type UploadArtifactStatus = "Staged" | "Generated" | "Missing Source";

export type SubmissionUploadStagingInput = {
  submissionSessionId: string;
  syncToNotion?: boolean;
};

export type SubmissionUploadArtifactRecord = {
  id: string;
  requirementId: string;
  sourceKind: UploadArtifactSourceKind;
  sourceRecordId?: string | null;
  artifactTitle: string;
  fileName?: string | null;
  mimeType?: string | null;
  originalPath?: string | null;
  stagedPath?: string | null;
  stagingStatus: UploadArtifactStatus;
  byteSize?: number | null;
  notes?: string | null;
};

export type SubmissionUploadStagingResult = {
  submissionSessionId: string;
  submissionRecordId: string;
  opportunityId: string;
  opportunityTitle: string;
  artifactSummary: {
    totalArtifacts: number;
    stagedArtifacts: number;
    generatedArtifacts: number;
    missingArtifacts: number;
  };
  artifacts: SubmissionUploadArtifactRecord[];
  notionSync?: {
    submissionPageId: string;
  };
};

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const parseSupportRefs = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const quoteCsv = (value: string | number | null | undefined) => {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const toMimeType = (extension: string) => {
  switch (extension.toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".txt":
      return "text/plain";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
};

export class SubmissionUploadStagingService {
  private readonly logger: LoggerLike;
  private readonly fileStorage: FileStorageService;

  constructor(
    private readonly config: AppEnv,
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
    this.fileStorage = new FileStorageService(config, logger);
  }

  async stage(input: SubmissionUploadStagingInput): Promise<SubmissionUploadStagingResult> {
    const [session] = await db
      .select()
      .from(submissionSessions)
      .where(eq(submissionSessions.id, input.submissionSessionId))
      .limit(1);
    if (!session) {
      throw new Error("No submission session exists for the provided submissionSessionId.");
    }

    const [[submission], [opportunity], requirementRows, documentRows, budgetRows] =
      await Promise.all([
        db.select().from(submissions).where(eq(submissions.id, session.submissionId)).limit(1),
        db.select().from(opportunities).where(eq(opportunities.id, session.opportunityId)).limit(1),
        db.select().from(requirements).where(eq(requirements.opportunityId, session.opportunityId)),
        db.select().from(documents),
        db.select().from(budgets),
      ]);

    if (!submission) {
      throw new Error("The submission session references a missing submission record.");
    }
    if (!opportunity) {
      throw new Error("The submission session references a missing opportunity record.");
    }

    const documentById = new Map(documentRows.map((row) => [row.id, row]));
    const budgetById = new Map(budgetRows.map((row) => [row.id, row]));
    const stagingDirectory = await this.ensureStagingDirectory(session.id);
    const now = new Date().toISOString();

    await db
      .delete(submissionUploadArtifacts)
      .where(eq(submissionUploadArtifacts.submissionSessionId, session.id));

    const artifacts: SubmissionUploadArtifactRecord[] = [];

    for (const requirement of requirementRows) {
      if (!this.isAttachmentRequirement(requirement.questionText, requirement.requirementType)) {
        continue;
      }

      const refs = parseSupportRefs(requirement.linkedEvidenceIds);
      const candidateDocuments = refs
        .filter((ref) => ref.startsWith("document:"))
        .map((ref) => documentById.get(ref.replace("document:", "")))
        .filter((row): row is typeof documents.$inferSelect => Boolean(row));
      const candidateBudgets = refs
        .filter((ref) => ref.startsWith("budget:"))
        .map((ref) => budgetById.get(ref.replace("budget:", "")))
        .filter((row): row is typeof budgets.$inferSelect => Boolean(row));

      const stagedDocument = await this.tryStageDocumentArtifact({
        requirementId: requirement.id,
        questionText: requirement.questionText,
        documents: candidateDocuments,
        stagingDirectory,
      });
      if (stagedDocument) {
        artifacts.push(stagedDocument);
        continue;
      }

      const generatedBudget = await this.tryGenerateBudgetArtifact({
        requirementId: requirement.id,
        questionText: requirement.questionText,
        budgets: candidateBudgets,
        stagingDirectory,
      });
      if (generatedBudget) {
        artifacts.push(generatedBudget);
        continue;
      }

      artifacts.push({
        id: randomUUID(),
        requirementId: requirement.id,
        sourceKind: candidateDocuments.length > 0 ? "document" : "budget",
        sourceRecordId: candidateDocuments[0]?.id ?? candidateBudgets[0]?.id ?? null,
        artifactTitle: normalizeText(requirement.questionText) || "Attachment",
        stagingStatus: "Missing Source",
        notes:
          candidateDocuments.length > 0
            ? "Attachment record exists, but no valid local file path is available for staging."
            : candidateBudgets.length > 0
              ? "Budget data exists, but no packageable budget artifact could be generated."
              : "No attachment source records are linked to this requirement yet.",
      });
    }

    if (artifacts.length === 0) {
      throw new Error("No attachment requirements were available for upload staging.");
    }

    await db.insert(submissionUploadArtifacts).values(
      artifacts.map((artifact) => ({
        id: artifact.id,
        organizationId: session.organizationId ?? opportunity.organizationId ?? null,
        submissionSessionId: session.id,
        submissionId: submission.id,
        opportunityId: opportunity.id,
        requirementId: artifact.requirementId,
        sourceKind: artifact.sourceKind,
        sourceRecordId: artifact.sourceRecordId ?? null,
        artifactTitle: artifact.artifactTitle,
        fileName: artifact.fileName ?? null,
        mimeType: artifact.mimeType ?? null,
        originalPath: artifact.originalPath ?? null,
        stagedPath: artifact.stagedPath ?? null,
        stagingStatus: artifact.stagingStatus,
        byteSize: artifact.byteSize ?? null,
        notes: artifact.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const artifactSummary = {
      totalArtifacts: artifacts.length,
      stagedArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Staged").length,
      generatedArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Generated")
        .length,
      missingArtifacts: artifacts.filter((artifact) => artifact.stagingStatus === "Missing Source")
        .length,
    };

    const portalReference = `Upload staging prepared ${artifactSummary.totalArtifacts} attachment artifact(s): ${artifactSummary.stagedArtifacts} copied from local files, ${artifactSummary.generatedArtifacts} generated package(s), ${artifactSummary.missingArtifacts} still missing a local source.`;

    await db
      .update(submissions)
      .set({
        portalReference,
        updatedAt: now,
      })
      .where(eq(submissions.id, submission.id));

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Attachment Staging Agent",
      actionDescription: "Prepared local upload artifacts for a submission session",
      confidenceLevel: artifactSummary.missingArtifacts === 0 ? 0.95 : 0.78,
      outputSummary: `Prepared ${artifactSummary.totalArtifacts} upload artifact(s) for '${opportunity.title}'.`,
      followUpRequired: artifactSummary.missingArtifacts > 0,
    });

    let notionSync: SubmissionUploadStagingResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncSubmissionPacket({
          opportunityTitle: opportunity.title,
          method: normalizeText(submission.method).includes("Submittable")
            ? "Submittable"
            : "Other",
          readyStatus: "Ready",
          portalUrl: session.portalUrl,
          portalReference,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for upload artifact staging");
      }
    }

    return {
      submissionSessionId: session.id,
      submissionRecordId: submission.id,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      artifactSummary,
      artifacts,
      notionSync,
    };
  }

  async getArtifactsForSession(submissionSessionId: string) {
    return db
      .select()
      .from(submissionUploadArtifacts)
      .where(eq(submissionUploadArtifacts.submissionSessionId, submissionSessionId));
  }

  private async tryStageDocumentArtifact(input: {
    requirementId: string;
    questionText: string;
    documents: Array<typeof documents.$inferSelect>;
    stagingDirectory: string;
  }): Promise<SubmissionUploadArtifactRecord | null> {
    for (const document of input.documents) {
      const extension = extname(document.fileLink ?? "") || ".pdf";
      const fileName = `${slugify(document.name || input.questionText) || "attachment"}${extension}`;
      const stagedPath = resolve(input.stagingDirectory, fileName);
      const stagedSource = await this.fileStorage.materializeToPath({
        storageProvider: document.storageProvider,
        storageKey: document.storageKey,
        fileLink: document.fileLink,
        targetPath: stagedPath,
      });
      if (!stagedSource) {
        continue;
      }
      const fileStats = await stat(stagedPath);

      return {
        id: randomUUID(),
        requirementId: input.requirementId,
        sourceKind: "document",
        sourceRecordId: document.id,
        artifactTitle: document.name,
        fileName,
        mimeType: toMimeType(extension),
        originalPath: stagedSource.originalPath,
        stagedPath,
        stagingStatus: "Staged",
        byteSize: fileStats.size,
        notes: "Copied from a verified local document path into the per-session staging folder.",
      };
    }

    return null;
  }

  private async tryGenerateBudgetArtifact(input: {
    requirementId: string;
    questionText: string;
    budgets: Array<typeof budgets.$inferSelect>;
    stagingDirectory: string;
  }): Promise<SubmissionUploadArtifactRecord | null> {
    const budget = input.budgets[0];
    if (!budget) {
      return null;
    }

    const fileName = `${slugify(budget.name || input.questionText) || "budget"}-package.csv`;
    const stagedPath = resolve(input.stagingDirectory, fileName);
    const rows = [
      ["Field", "Value"],
      ["Budget Name", budget.name],
      ["Budget Type", budget.budgetType],
      ["Fiscal Year", budget.fiscalYear ?? ""],
      ["Total Revenue", budget.totalRevenue ?? ""],
      ["Total Expense", budget.totalExpense ?? ""],
    ];

    const csvContent = rows.map((row) => row.map((cell) => quoteCsv(cell)).join(",")).join("\n");
    await writeFile(stagedPath, `${csvContent}\n`, "utf8");
    const fileStats = await stat(stagedPath);

    return {
      id: randomUUID(),
      requirementId: input.requirementId,
      sourceKind: "budget",
      sourceRecordId: budget.id,
      artifactTitle: budget.name,
      fileName,
      mimeType: "text/csv",
      originalPath: null,
      stagedPath,
      stagingStatus: "Generated",
      byteSize: fileStats.size,
      notes: "Generated a lightweight CSV package from the stored budget totals for guided portal upload.",
    };
  }

  private isAttachmentRequirement(questionText?: string | null, requirementType?: string | null) {
    const normalizedText = normalizeText(questionText).toLowerCase();
    const normalizedType = normalizeText(requirementType).toLowerCase();
    return (
      normalizedType.includes("document") ||
      normalizedText.includes("budget") ||
      normalizedText.includes("determination letter")
    );
  }

  private async ensureStagingDirectory(submissionSessionId: string) {
    const uploadRoot = this.resolveProjectPath(this.config.UPLOAD_DIR);
    const directory = resolve(uploadRoot, "staged", submissionSessionId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private resolveProjectPath(value: string) {
    return value.startsWith("/") ? value : resolve(PROJECT_ROOT, value);
  }
}
