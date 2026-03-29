import type { FastifyInstance } from "fastify";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { toErrorPayload, getStatusCodeForError } from "../lib/error-handler.js";
import { CustomerOnboardingService } from "../services/onboarding/customer-onboarding.js";

export const registerOnboardingRoutes = (
  app: FastifyInstance,
  onboardingService: CustomerOnboardingService,
) => {
  app.get("/onboarding/status", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      const clerkUserId = getClerkUserIdFromRequest(request);
      return await onboardingService.getStatus({
        organizationId: query.organizationId,
        clerkUserId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to load onboarding status");
      const payload = toErrorPayload(error);
      return reply.status(getStatusCodeForError(error, payload, 500)).send(payload);
    }
  });
};
