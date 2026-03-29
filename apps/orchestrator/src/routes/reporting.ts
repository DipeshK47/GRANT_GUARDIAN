import type { FastifyInstance } from "fastify";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { PostAwardReportingService } from "../services/reporting/workflow.js";

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

const isScopeError = (message: string) =>
  message.includes("requested organizationId") || message.includes("not scoped");

const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
  isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

export const registerReportingRoutes = (
  app: FastifyInstance,
  reportingService: PostAwardReportingService,
) => {
  app.post("/opportunities/:opportunityId/activate-reporting", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          organizationId?: string;
          awardDate?: string;
          owner?: string;
          cadence?: "Final Only" | "Semiannual + Final" | "Quarterly + Final";
          templateLink?: string;
          requiredMetrics?: string[];
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await reportingService.activate({
        opportunityId: params.opportunityId,
        organizationId: body.organizationId,
        awardDate: body.awardDate,
        owner: body.owner,
        cadence: body.cadence,
        templateLink: body.templateLink,
        requiredMetrics: body.requiredMetrics,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to activate reporting workflow");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") || isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/reporting-calendar", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      return await reportingService.list({
        opportunityId: params.opportunityId,
        organizationId: query.organizationId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list reporting calendar");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") || isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.patch("/reporting-calendar/:reportId", async (request, reply) => {
    try {
      const params = request.params as { reportId: string };
      const body =
        (request.body as {
          organizationId?: string;
          status?: "Upcoming" | "In Progress" | "Submitted" | "Overdue";
          owner?: string;
          templateLink?: string;
          requiredMetrics?: string[];
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await reportingService.updateReport({
        reportId: params.reportId,
        organizationId: body.organizationId,
        status: body.status,
        owner: body.owner,
        templateLink: body.templateLink,
        requiredMetrics: body.requiredMetrics,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to update reporting entry");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No reporting entry exists") ||
        payload.message.includes("No opportunity exists") ||
        isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });
};
