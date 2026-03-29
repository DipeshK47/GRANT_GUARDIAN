import type { FastifyInstance } from "fastify";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { PortfolioOptimizerService } from "../services/opportunities/portfolio.js";

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

const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
  isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

export const registerPortfolioRoutes = (
  app: FastifyInstance,
  portfolioOptimizerService: PortfolioOptimizerService,
) => {
  app.get("/portfolio", async (request, reply) => {
    try {
      const query =
        (request.query as {
          organizationId?: string;
          monthlyStaffHours?: string;
        } | undefined) ?? {};

      return await portfolioOptimizerService.run({
        organizationId: query.organizationId,
        clerkUserId: getClerkUserIdFromRequest(request),
        monthlyStaffHours: toOptionalNumber(query.monthlyStaffHours),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to build portfolio ranking");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/portfolio/sync", async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown> | undefined) ?? {};

      return await portfolioOptimizerService.run({
        organizationId: body.organizationId ? String(body.organizationId) : undefined,
        clerkUserId: getClerkUserIdFromRequest(request),
        monthlyStaffHours: toOptionalNumber(body.monthlyStaffHours),
        syncToNotion: true,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to sync portfolio ranking to Notion");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });
};
