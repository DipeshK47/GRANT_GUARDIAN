import type { FastifyInstance, FastifyRequest } from "fastify";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { DocumentVaultService } from "../services/documents/vault.js";

type MultipartRequest = FastifyRequest & {
  isMultipart: () => boolean;
  file: () => Promise<
    | {
        filename: string;
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
        fields: Record<string, unknown>;
      }
    | undefined
  >;
};

const toErrorPayload = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: "Unknown error",
  };
};

const toBoolean = (value?: string) => (value ?? "").toLowerCase() === "true";

const toStringArray = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const getMultipartFieldValue = (value: unknown) => {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return getMultipartFieldValue(value[0]);
  }

  if (typeof value === "object" && value !== null && "value" in value) {
    const candidate = value as { value?: unknown };
    return typeof candidate.value === "string" ? candidate.value : undefined;
  }

  return undefined;
};

const statusCodeForPayload = (payload: { message: string }) =>
  payload.message.includes("requires a name") ||
  payload.message.includes("requires a documentType") ||
  payload.message.includes("requires a fileName") ||
  payload.message.includes("requires non-empty contentBase64") ||
  payload.message.includes("decoded to an empty file") ||
  payload.message.includes("multipart/form-data")
    ? 400
    : 500;

const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
  isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

export const registerDocumentRoutes = (
  app: FastifyInstance,
  documentVaultService: DocumentVaultService,
) => {
  app.get("/documents", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      return await documentVaultService.list({
        organizationId: query.organizationId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list documents");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/documents/upload", async (request, reply) => {
    try {
      const body =
        (request.body as {
          documentId?: string;
          organizationId?: string;
          name?: string;
          documentType?: string;
          fileName?: string;
          contentBase64?: string;
          mimeType?: string | null;
          owner?: string | null;
          expirationDate?: string | null;
          requiredByOpportunityIds?: string[];
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await documentVaultService.upload({
        documentId: body.documentId,
        organizationId: body.organizationId,
        name: body.name ?? "",
        documentType: body.documentType ?? "",
        fileName: body.fileName ?? "",
        contentBase64: body.contentBase64 ?? "",
        mimeType: body.mimeType ?? null,
        owner: body.owner ?? null,
        expirationDate: body.expirationDate ?? null,
        requiredByOpportunityIds: body.requiredByOpportunityIds ?? [],
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to upload document");
      const payload = toErrorPayload(error);
      return reply.status(statusCodeForError(error, statusCodeForPayload(payload))).send(payload);
    }
  });

  app.post("/documents/:documentId/upload", async (request, reply) => {
    try {
      const params = request.params as { documentId: string };
      const body =
        (request.body as {
          organizationId?: string;
          name?: string;
          documentType?: string;
          fileName?: string;
          contentBase64?: string;
          mimeType?: string | null;
          owner?: string | null;
          expirationDate?: string | null;
          requiredByOpportunityIds?: string[];
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await documentVaultService.upload({
        documentId: params.documentId,
        organizationId: body.organizationId,
        name: body.name ?? "",
        documentType: body.documentType ?? "",
        fileName: body.fileName ?? "",
        contentBase64: body.contentBase64 ?? "",
        mimeType: body.mimeType ?? null,
        owner: body.owner ?? null,
        expirationDate: body.expirationDate ?? null,
        requiredByOpportunityIds: body.requiredByOpportunityIds ?? [],
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to upload document");
      const payload = toErrorPayload(error);
      return reply.status(statusCodeForError(error, statusCodeForPayload(payload))).send(payload);
    }
  });

  const registerMultipartRoute = (
    path: string,
    resolveDocumentId: (request: FastifyRequest) => string | undefined,
  ) => {
    app.post(path, async (request, reply) => {
      try {
        const multipartRequest = request as MultipartRequest;
        if (!multipartRequest.isMultipart?.()) {
          throw new Error("Document multipart upload requires multipart/form-data.");
        }

        const file = await multipartRequest.file();
        if (!file) {
          throw new Error("Document multipart upload requires a file field.");
        }

        const fields = file.fields ?? {};
        const buffer = await file.toBuffer();

        return await documentVaultService.uploadBuffer({
          documentId: resolveDocumentId(request) ?? getMultipartFieldValue(fields.documentId),
          organizationId: getMultipartFieldValue(fields.organizationId),
          name: getMultipartFieldValue(fields.name) ?? "",
          documentType: getMultipartFieldValue(fields.documentType) ?? "",
          fileName: file.filename,
          buffer,
          mimeType: file.mimetype ?? null,
          owner: getMultipartFieldValue(fields.owner) ?? null,
          expirationDate: getMultipartFieldValue(fields.expirationDate) ?? null,
          requiredByOpportunityIds: toStringArray(
            getMultipartFieldValue(fields.requiredByOpportunityIds),
          ),
          syncToNotion: toBoolean(getMultipartFieldValue(fields.syncToNotion)),
        });
      } catch (error) {
        request.log.error({ error }, "Failed to upload multipart document");
        const payload = toErrorPayload(error);
        return reply
          .status(statusCodeForError(error, statusCodeForPayload(payload)))
          .send(payload);
      }
    });
  };

  registerMultipartRoute("/documents/upload-multipart", () => undefined);
  registerMultipartRoute("/documents/:documentId/upload-multipart", (request) => {
    const params = request.params as { documentId: string };
    return params.documentId;
  });
};
