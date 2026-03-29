import type { FastifyInstance } from "fastify";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { toErrorPayload, getStatusCodeForError } from "../lib/error-handler.js";
import { OpportunityIntakeService } from "../services/intake/opportunity.js";

export const registerIntakeRoutes = (
  app: FastifyInstance,
  intakeService: OpportunityIntakeService,
) => {
  app.post("/intake/opportunity", async (request, reply) => {
    try {
      const clerkUserId = getClerkUserIdFromRequest(request);
      const body =
        (request.body as {
          organizationId?: string;
          clerkUserId?: string;
          url?: string;
          rawText?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};
      return await intakeService.run({
        ...body,
        clerkUserId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to run opportunity intake");
      const payload = toErrorPayload(error);
      return reply.status(getStatusCodeForError(error, payload, 500)).send(payload);
    }
  });
};
