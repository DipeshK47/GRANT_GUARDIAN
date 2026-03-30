import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import { agentLogs, documents, organizations } from "../../db/schema.js";
import {
  normalizeScopedText,
  resolveOrganizationId,
} from "../../lib/organization-scope.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { FileStorageService } from "../storage/file-storage.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type DocumentVaultUploadInput = {
  documentId?: string;
  organizationId?: string | null;
  name: string;
  documentType: string;
  fileName: string;
  contentBase64: string;
  mimeType?: string | null;
  owner?: string | null;
  expirationDate?: string | null;
  requiredByOpportunityIds?: string[];
  syncToNotion?: boolean;
};

export type DocumentVaultBufferUploadInput = Omit<DocumentVaultUploadInput, "contentBase64"> & {
  buffer: Buffer;
};

export type DocumentVaultUploadResult = {
  documentId: string;
  organizationId?: string | null;
  name: string;
  documentType: string;
  uploadStatus: string;
  storedPath: string;
  mimeType: string;
  byteSize: number;
  storageProvider: "local" | "s3" | "supabase";
  storageKey: string;
  fileUrl?: string | null;
  owner?: string | null;
  expirationDate?: string | null;
  notionSync?: {
    documentPageId: string;
  };
};

export type DocumentVaultListResult = {
  documents: Array<{
    id: string;
    organizationId?: string | null;
    name: string;
    documentType: string;
    uploadStatus: string;
    fileLink?: string | null;
    fileUrl?: string | null;
    storageProvider?: string | null;
    storageKey?: string | null;
    owner?: string | null;
    expirationDate?: string | null;
    lastVerifiedAt?: string | null;
    updatedAt: string;
  }>;
};

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

const sanitizeFileName = (value: string) => {
  const normalized = normalizeScopedText(value);
  const fallback = `upload-${randomUUID()}.bin`;
  if (!normalized) {
    return fallback;
  }

  const cleaned = normalized
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || fallback;
};

const normalizeBase64Content = (value: string) => {
  const trimmed = normalizeScopedText(value);
  const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  return dataUrlMatch?.[1] ?? trimmed;
};

const toMimeType = (fileName: string, explicitMimeType?: string | null) => {
  const normalizedMimeType = normalizeScopedText(explicitMimeType);
  if (normalizedMimeType) {
    return normalizedMimeType;
  }

  switch (extname(fileName).toLowerCase()) {
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

export class DocumentVaultService {
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

  async list(input?: { organizationId?: string | null }): Promise<DocumentVaultListResult> {
    const organizationId = normalizeScopedText(input?.organizationId);
    const rows = organizationId
      ? await db
          .select()
          .from(documents)
          .where(eq(documents.organizationId, organizationId))
          .orderBy(desc(documents.updatedAt))
      : await db.select().from(documents).orderBy(desc(documents.updatedAt));

    return {
      documents: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        documentType: row.documentType,
        uploadStatus: row.uploadStatus,
        fileLink: row.fileLink,
        fileUrl: row.fileUrl,
        storageProvider: row.storageProvider,
        storageKey: row.storageKey,
        owner: row.owner,
        expirationDate: row.expirationDate,
        lastVerifiedAt: row.lastVerifiedAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async upload(input: DocumentVaultUploadInput): Promise<DocumentVaultUploadResult> {
    if (!normalizeScopedText(input.contentBase64)) {
      throw new Error("Document upload requires non-empty contentBase64.");
    }

    const buffer = Buffer.from(normalizeBase64Content(input.contentBase64), "base64");
    return this.uploadBuffer({
      ...input,
      buffer,
    });
  }

  async uploadBuffer(input: DocumentVaultBufferUploadInput): Promise<DocumentVaultUploadResult> {
    if (!normalizeScopedText(input.name)) {
      throw new Error("Document upload requires a name.");
    }
    if (!normalizeScopedText(input.documentType)) {
      throw new Error("Document upload requires a documentType.");
    }
    if (!normalizeScopedText(input.fileName)) {
      throw new Error("Document upload requires a fileName.");
    }
    if (input.buffer.byteLength === 0) {
      throw new Error("Document upload content decoded to an empty file.");
    }

    const now = new Date().toISOString();
    const documentId = input.documentId ?? randomUUID();
    const organizationId = await this.resolveDocumentOrganizationId(
      input.documentId,
      input.organizationId,
    );
    const safeFileName = sanitizeFileName(input.fileName);
    const mimeType = toMimeType(safeFileName, input.mimeType);
    const storedFile = await this.fileStorage.storeBuffer({
      organizationId,
      namespace: "library",
      entityId: documentId,
      fileName: safeFileName,
      buffer: input.buffer,
      mimeType,
    });

    const [existing] = input.documentId
      ? await db.select().from(documents).where(eq(documents.id, input.documentId)).limit(1)
      : [];

    if (existing) {
      await db
        .update(documents)
        .set({
          organizationId,
          name: input.name,
          documentType: input.documentType,
          fileLink: storedFile.fileLink ?? storedFile.fileUrl ?? null,
          fileUrl: storedFile.fileUrl ?? null,
          storageProvider: storedFile.provider,
          storageKey: storedFile.storageKey,
          uploadStatus: "Ready",
          owner: normalizeScopedText(input.owner) || null,
          expirationDate: normalizeScopedText(input.expirationDate) || null,
          lastVerifiedAt: now,
          requiredByOpportunityIds:
            input.requiredByOpportunityIds && input.requiredByOpportunityIds.length > 0
              ? input.requiredByOpportunityIds.join(", ")
              : existing.requiredByOpportunityIds,
          updatedAt: now,
        })
        .where(eq(documents.id, existing.id));
    } else {
      await db.insert(documents).values({
        id: documentId,
        organizationId,
        name: input.name,
        documentType: input.documentType,
        fileLink: storedFile.fileLink ?? storedFile.fileUrl ?? null,
        fileUrl: storedFile.fileUrl ?? null,
        storageProvider: storedFile.provider,
        storageKey: storedFile.storageKey,
        uploadStatus: "Ready",
        owner: normalizeScopedText(input.owner) || null,
        expirationDate: normalizeScopedText(input.expirationDate) || null,
        lastVerifiedAt: now,
        requiredByOpportunityIds:
          input.requiredByOpportunityIds && input.requiredByOpportunityIds.length > 0
            ? input.requiredByOpportunityIds.join(", ")
            : null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Document Vault Agent",
      actionDescription: "Stored an uploaded reusable grant document in the scoped document vault",
      confidenceLevel: 0.97,
      outputSummary: `Uploaded '${input.name}' to the document vault${organizationId ? ` for organization ${organizationId}` : ""}.`,
      followUpRequired: false,
    });

    let notionSync: DocumentVaultUploadResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        const [organization] = organizationId
          ? await db
              .select()
              .from(organizations)
              .where(eq(organizations.id, organizationId))
              .limit(1)
          : [];
        notionSync = await this.notionClient.syncDocumentVaultEntry({
          organizationName: organization?.legalName ?? null,
          documentName: input.name,
          category: input.documentType,
          uploadStatus: "Ready",
          owner: input.owner ?? null,
          expirationDate: input.expirationDate ?? null,
          fileUrl: storedFile.fileUrl ?? null,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error, documentId }, "Skipping Notion sync for document upload");
      }
    }

    return {
      documentId,
      organizationId,
      name: input.name,
      documentType: input.documentType,
      uploadStatus: "Ready",
      storedPath: storedFile.fileLink ?? storedFile.fileUrl ?? storedFile.storageKey,
      mimeType,
      byteSize: storedFile.byteSize,
      storageProvider: storedFile.provider,
      storageKey: storedFile.storageKey,
      fileUrl: storedFile.fileUrl ?? null,
      owner: input.owner ?? null,
      expirationDate: input.expirationDate ?? null,
      notionSync,
    };
  }

  async uploadFromLocalPath(input: {
    documentId?: string;
    organizationId?: string | null;
    name: string;
    documentType: string;
    filePath: string;
    owner?: string | null;
    expirationDate?: string | null;
    requiredByOpportunityIds?: string[];
    syncToNotion?: boolean;
  }) {
    const absolutePath = input.filePath.startsWith("/")
      ? input.filePath
      : resolve(PROJECT_ROOT, input.filePath);
    const fileBuffer = await readFile(absolutePath);
    const fileStats = await stat(absolutePath);

    const result = await this.uploadBuffer({
      documentId: input.documentId,
      organizationId: input.organizationId,
      name: input.name,
      documentType: input.documentType,
      fileName: basename(absolutePath),
      buffer: fileBuffer,
      owner: input.owner ?? null,
      expirationDate: input.expirationDate ?? null,
      requiredByOpportunityIds: input.requiredByOpportunityIds,
      syncToNotion: input.syncToNotion,
    });

    return {
      ...result,
      byteSize: fileStats.size,
    };
  }

  private async resolveDocumentOrganizationId(
    documentId?: string,
    requestedOrganizationId?: string | null,
  ) {
    const requested = normalizeScopedText(requestedOrganizationId);
    if (requested) {
      return requested;
    }

    if (documentId) {
      const [existing] = await db
        .select({ organizationId: documents.organizationId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      if (normalizeScopedText(existing?.organizationId)) {
        return normalizeScopedText(existing?.organizationId);
      }
    }

    return resolveOrganizationId();
  }
}
