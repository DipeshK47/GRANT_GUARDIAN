import type { FastifyInstance } from "fastify";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { LessonMemoryService } from "../services/lessons/workflow.js";

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

export const registerLessonRoutes = (
  app: FastifyInstance,
  lessonMemoryService: LessonMemoryService,
) => {
  app.post("/opportunities/:opportunityId/lessons", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          organizationId?: string;
          feedbackText?: string;
          themes?: string[];
          recommendations?: string;
          appliesNextCycle?: boolean;
          markOpportunityRejected?: boolean;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await lessonMemoryService.record({
        opportunityId: params.opportunityId,
        organizationId: body.organizationId,
        feedbackText: body.feedbackText ?? "",
        themes: body.themes,
        recommendations: body.recommendations,
        appliesNextCycle: body.appliesNextCycle,
        markOpportunityRejected: body.markOpportunityRejected,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to record lesson for opportunity");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires feedbackText") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No funder exists") ||
        isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/lessons", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const query =
        (request.query as { reusableOnly?: string; organizationId?: string } | undefined) ?? {};
      return await lessonMemoryService.list({
        opportunityId: params.opportunityId,
        organizationId: query.organizationId,
        reusableOnly: (query.reusableOnly ?? "").toLowerCase() === "true",
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list lessons for opportunity");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a funderId or opportunityId") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No funder exists") ||
        isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/funders/:funderId/lessons", async (request, reply) => {
    try {
      const params = request.params as { funderId: string };
      const query =
        (request.query as { reusableOnly?: string; organizationId?: string } | undefined) ?? {};
      return await lessonMemoryService.list({
        funderId: params.funderId,
        organizationId: query.organizationId,
        reusableOnly: (query.reusableOnly ?? "").toLowerCase() === "true",
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list lessons for funder");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a funderId or opportunityId") ||
        payload.message.includes("No funder exists") ||
        isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.patch("/lessons/:lessonId", async (request, reply) => {
    try {
      const params = request.params as { lessonId: string };
      const body =
        (request.body as {
          organizationId?: string;
          themes?: string[];
          recommendations?: string;
          appliesNextCycle?: boolean;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await lessonMemoryService.update({
        lessonId: params.lessonId,
        organizationId: body.organizationId,
        themes: body.themes,
        recommendations: body.recommendations,
        appliesNextCycle: body.appliesNextCycle,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to update lesson");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No lesson exists") ||
        payload.message.includes("No funder exists") ||
        payload.message.includes("No opportunity exists") ||
        isScopeError(payload.message)
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });
};
