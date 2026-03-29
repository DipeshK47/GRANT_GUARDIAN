import type { FastifyInstance } from "fastify";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { WorkspaceContextService } from "../services/workspace/context.js";

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

const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const statusCodeForPayload = (payload: { message: string }) =>
  payload.message.includes("requires")
    ? 400
    : 500;

const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
  isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

export const registerWorkspaceContextRoutes = (
  app: FastifyInstance,
  workspaceContextService: WorkspaceContextService,
) => {
  app.get("/programs", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      return await workspaceContextService.listPrograms({
        organizationId: query.organizationId ?? "",
        clerkUserId: getClerkUserIdFromRequest(request),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list programs");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/programs", async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown> | undefined) ?? {};
      return await workspaceContextService.saveProgram({
        programId: body.programId ? String(body.programId) : undefined,
        organizationId: String(body.organizationId ?? ""),
        clerkUserId: getClerkUserIdFromRequest(request),
        name: String(body.name ?? ""),
        description: body.description ? String(body.description) : null,
        targetPopulation: body.targetPopulation ? String(body.targetPopulation) : null,
        geography: body.geography ? String(body.geography) : null,
        theoryOfChange: body.theoryOfChange ? String(body.theoryOfChange) : null,
        status: body.status ? String(body.status) : null,
        keyOutcomes: body.keyOutcomes ? String(body.keyOutcomes) : null,
        programBudget: toOptionalNumber(body.programBudget),
        programLead: body.programLead ? String(body.programLead) : null,
        fundingHistory: body.fundingHistory ? String(body.fundingHistory) : null,
        syncToNotion: Boolean(body.syncToNotion),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to save program");
      const payload = toErrorPayload(error);
      return reply.status(statusCodeForError(error, statusCodeForPayload(payload))).send(payload);
    }
  });

  app.get("/evidence-library", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      return await workspaceContextService.listEvidence({
        organizationId: query.organizationId ?? "",
        clerkUserId: getClerkUserIdFromRequest(request),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list evidence");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/evidence-library", async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown> | undefined) ?? {};
      return await workspaceContextService.saveEvidence({
        evidenceId: body.evidenceId ? String(body.evidenceId) : undefined,
        organizationId: String(body.organizationId ?? ""),
        clerkUserId: getClerkUserIdFromRequest(request),
        programId: String(body.programId ?? ""),
        title: String(body.title ?? ""),
        evidenceType: String(body.evidenceType ?? ""),
        content: String(body.content ?? ""),
        sourceDocument: body.sourceDocument ? String(body.sourceDocument) : null,
        collectedAt: body.collectedAt ? String(body.collectedAt) : null,
        reliabilityRating: toOptionalNumber(body.reliabilityRating),
        tags: body.tags ? String(body.tags) : null,
        syncToNotion: Boolean(body.syncToNotion),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to save evidence");
      const payload = toErrorPayload(error);
      return reply.status(statusCodeForError(error, statusCodeForPayload(payload))).send(payload);
    }
  });

  app.get("/budgets", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      return await workspaceContextService.listBudgets({
        organizationId: query.organizationId ?? "",
        clerkUserId: getClerkUserIdFromRequest(request),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list budgets");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/budgets", async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown> | undefined) ?? {};
      return await workspaceContextService.saveBudget({
        budgetId: body.budgetId ? String(body.budgetId) : undefined,
        organizationId: String(body.organizationId ?? ""),
        clerkUserId: getClerkUserIdFromRequest(request),
        programId: String(body.programId ?? ""),
        name: String(body.name ?? ""),
        fiscalYear: toOptionalNumber(body.fiscalYear),
        budgetType: String(body.budgetType ?? ""),
        lineItems: body.lineItems ? String(body.lineItems) : null,
        totalRevenue: toOptionalNumber(body.totalRevenue),
        totalExpense: toOptionalNumber(body.totalExpense),
        restrictedVsUnrestricted: body.restrictedVsUnrestricted
          ? String(body.restrictedVsUnrestricted)
          : null,
        syncToNotion: Boolean(body.syncToNotion),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to save budget");
      const payload = toErrorPayload(error);
      return reply.status(statusCodeForError(error, statusCodeForPayload(payload))).send(payload);
    }
  });
};
