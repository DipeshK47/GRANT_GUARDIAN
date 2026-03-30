import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { AppEnv } from "../../config/env.js";
import { sanitizeScopeSegment } from "../../lib/organization-scope.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type StoredFileDescriptor = {
  provider: "local" | "s3" | "supabase";
  storageKey: string;
  localPath?: string | null;
  fileLink?: string | null;
  fileUrl?: string | null;
  byteSize: number;
  mimeType: string;
};

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const toProjectRelativePath = (absolutePath: string) => {
  const projectRootWithSlash = `${PROJECT_ROOT}/`;
  if (absolutePath.startsWith(projectRootWithSlash)) {
    return absolutePath.slice(projectRootWithSlash.length);
  }
  return absolutePath;
};

const streamToBuffer = async (value: unknown) => {
  if (!value) {
    return Buffer.alloc(0);
  }

  const candidate = value as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof candidate.transformToByteArray === "function") {
    return Buffer.from(await candidate.transformToByteArray());
  }

  if (value instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of value) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return Buffer.from([]);
};

export class FileStorageService {
  private readonly logger: LoggerLike;
  private s3Client?: S3Client;
  private supabaseClient?: SupabaseClient;

  constructor(
    private readonly config: AppEnv,
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

  async storeBuffer(input: {
    organizationId?: string | null;
    namespace: "library";
    entityId: string;
    fileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredFileDescriptor> {
    const storageKey = this.buildStorageKey(input.organizationId, input.namespace, input.entityId, input.fileName);

    if (this.config.FILE_STORAGE_BACKEND === "s3") {
      const client = this.getS3Client();
      const bucket = normalizeText(this.config.FILE_STORAGE_BUCKET);
      if (!bucket) {
        throw new Error("FILE_STORAGE_BUCKET is required when FILE_STORAGE_BACKEND=s3.");
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          Body: input.buffer,
          ContentType: input.mimeType,
        }),
      );

      return {
        provider: "s3",
        storageKey,
        localPath: null,
        fileLink: this.buildRemoteFileUrl(storageKey),
        fileUrl: this.buildRemoteFileUrl(storageKey),
        byteSize: input.buffer.byteLength,
        mimeType: input.mimeType,
      };
    }

    if (this.config.FILE_STORAGE_BACKEND === "supabase") {
      const client = this.getSupabaseClient();
      const bucket = normalizeText(this.config.SUPABASE_STORAGE_BUCKET);
      if (!bucket) {
        throw new Error(
          "SUPABASE_STORAGE_BUCKET is required when FILE_STORAGE_BACKEND=supabase.",
        );
      }

      const { error } = await client.storage.from(bucket).upload(storageKey, input.buffer, {
        contentType: input.mimeType,
        upsert: true,
      });
      if (error) {
        throw new Error(`Supabase file upload failed: ${error.message}`);
      }

      return {
        provider: "supabase",
        storageKey,
        localPath: null,
        fileLink: this.buildSupabaseFileUrl(storageKey),
        fileUrl: this.buildSupabaseFileUrl(storageKey),
        byteSize: input.buffer.byteLength,
        mimeType: input.mimeType,
      };
    }

    const uploadRoot = this.resolveProjectPath(this.config.UPLOAD_DIR);
    const absolutePath = resolve(uploadRoot, storageKey);
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return {
      provider: "local",
      storageKey,
      localPath: absolutePath,
      fileLink: toProjectRelativePath(absolutePath),
      fileUrl: this.buildLocalFileUrl(storageKey),
      byteSize: input.buffer.byteLength,
      mimeType: input.mimeType,
    };
  }

  async materializeToPath(input: {
    storageProvider?: string | null;
    storageKey?: string | null;
    fileLink?: string | null;
    targetPath: string;
  }) {
    const provider = normalizeText(input.storageProvider) || "local";
    const normalizedKey = normalizeText(input.storageKey);
    const normalizedLink = normalizeText(input.fileLink);

    if (provider === "supabase") {
      const bucket = normalizeText(this.config.SUPABASE_STORAGE_BUCKET);
      if (!bucket) {
        throw new Error(
          "SUPABASE_STORAGE_BUCKET is required when FILE_STORAGE_BACKEND=supabase.",
        );
      }
      if (!normalizedKey) {
        return null;
      }

      const client = this.getSupabaseClient();
      const { data, error } = await client.storage.from(bucket).download(normalizedKey);
      if (error) {
        throw new Error(`Supabase file download failed: ${error.message}`);
      }
      if (!data) {
        return null;
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      await mkdir(resolve(input.targetPath, ".."), { recursive: true });
      await writeFile(input.targetPath, buffer);
      return {
        originalPath: null,
        byteSize: buffer.byteLength,
      };
    }

    if (provider !== "s3") {
      const sourcePath = this.resolveLocalSourcePath(normalizedLink || normalizedKey);
      if (!sourcePath) {
        return null;
      }

      const buffer = await this.readLocalBuffer(sourcePath);
      await mkdir(resolve(input.targetPath, ".."), { recursive: true });
      await writeFile(input.targetPath, buffer);
      return {
        originalPath: sourcePath,
        byteSize: buffer.byteLength,
      };
    }

    if (!normalizedKey) {
      return null;
    }

    const client = this.getS3Client();
    const bucket = normalizeText(this.config.FILE_STORAGE_BUCKET);
    if (!bucket) {
      throw new Error("FILE_STORAGE_BUCKET is required when FILE_STORAGE_BACKEND=s3.");
    }

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      }),
    );
    const buffer = await streamToBuffer(response.Body);
    await mkdir(resolve(input.targetPath, ".."), { recursive: true });
    await writeFile(input.targetPath, buffer);

    return {
      originalPath: null,
      byteSize: buffer.byteLength,
    };
  }

  resolveBrowserStorageStatePath(organizationId?: string | null) {
    const normalizedOrganizationId = normalizeText(organizationId);
    if (!normalizedOrganizationId) {
      return this.resolveProjectPath(this.config.PLAYWRIGHT_STORAGE_STATE);
    }

    const browserRoot = this.resolveProjectPath(this.config.PLAYWRIGHT_STORAGE_STATE_DIR);
    return resolve(
      browserRoot,
      sanitizeScopeSegment(normalizedOrganizationId),
      basename(this.config.PLAYWRIGHT_STORAGE_STATE),
    );
  }

  private resolveProjectPath(value: string) {
    return value.startsWith("/") ? value : resolve(PROJECT_ROOT, value);
  }

  private buildStorageKey(
    organizationId: string | null | undefined,
    namespace: "library",
    entityId: string,
    fileName: string,
  ) {
    const prefix = normalizeText(this.config.FILE_STORAGE_KEY_PREFIX);
    const scopedOrg = sanitizeScopeSegment(organizationId);
    const parts = [prefix, namespace, scopedOrg, entityId, fileName].filter(Boolean);
    return parts.join("/");
  }

  private buildLocalFileUrl(storageKey: string) {
    const baseUrl = normalizeText(this.config.FILE_STORAGE_PUBLIC_BASE_URL);
    if (!baseUrl) {
      return null;
    }
    return `${baseUrl.replace(/\/+$/, "")}/${storageKey}`;
  }

  private buildRemoteFileUrl(storageKey: string) {
    const configuredBaseUrl = normalizeText(this.config.FILE_STORAGE_PUBLIC_BASE_URL);
    if (configuredBaseUrl) {
      return `${configuredBaseUrl.replace(/\/+$/, "")}/${storageKey}`;
    }

    const endpoint = normalizeText(this.config.FILE_STORAGE_ENDPOINT);
    const bucket = normalizeText(this.config.FILE_STORAGE_BUCKET);
    if (!endpoint || !bucket) {
      return null;
    }

    return `${endpoint.replace(/\/+$/, "")}/${bucket}/${storageKey}`;
  }

  private buildSupabaseFileUrl(storageKey: string) {
    const configuredBaseUrl = normalizeText(this.config.FILE_STORAGE_PUBLIC_BASE_URL);
    if (configuredBaseUrl) {
      return `${configuredBaseUrl.replace(/\/+$/, "")}/${storageKey}`;
    }

    const supabaseUrl = normalizeText(this.config.SUPABASE_URL);
    const bucket = normalizeText(this.config.SUPABASE_STORAGE_BUCKET);
    if (!supabaseUrl || !bucket) {
      return null;
    }

    return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${storageKey}`;
  }

  private resolveLocalSourcePath(candidate?: string | null) {
    const normalized = normalizeText(candidate);
    if (!normalized || /^https?:\/\//i.test(normalized)) {
      return null;
    }

    if (normalized.startsWith("/")) {
      return normalized;
    }

    if (normalized.startsWith("data/") || normalized.startsWith("./data/")) {
      return this.resolveProjectPath(normalized);
    }

    return resolve(this.resolveProjectPath(this.config.UPLOAD_DIR), normalized);
  }

  private async readLocalBuffer(sourcePath: string) {
    const { readFile } = await import("node:fs/promises");
    return readFile(sourcePath);
  }

  private getS3Client() {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: normalizeText(this.config.FILE_STORAGE_REGION) || "us-east-1",
        endpoint: normalizeText(this.config.FILE_STORAGE_ENDPOINT) || undefined,
        forcePathStyle: this.config.FILE_STORAGE_FORCE_PATH_STYLE,
        credentials:
          normalizeText(this.config.FILE_STORAGE_ACCESS_KEY_ID) &&
          normalizeText(this.config.FILE_STORAGE_SECRET_ACCESS_KEY)
            ? {
                accessKeyId: this.config.FILE_STORAGE_ACCESS_KEY_ID,
                secretAccessKey: this.config.FILE_STORAGE_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
    }

    return this.s3Client;
  }

  private getSupabaseClient() {
    if (!this.supabaseClient) {
      const supabaseUrl = normalizeText(this.config.SUPABASE_URL);
      const serviceRoleKey = normalizeText(this.config.SUPABASE_SERVICE_ROLE_KEY);
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error(
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when FILE_STORAGE_BACKEND=supabase.",
        );
      }

      this.supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }

    return this.supabaseClient;
  }
}
