import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { getStatusCodeForError, toErrorPayload } from "../lib/error-handler.js";
import { NotionMcpClient } from "../services/notion/client.js";
import {
  OrganizationProfileService,
  type OrganizationProfileInput,
} from "../services/organizations/profile.js";

const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

export const registerOrganizationRoutes = (
  app: FastifyInstance,
  organizationProfileService: OrganizationProfileService,
  notionClient?: NotionMcpClient,
) => {
  app.get("/organizations", async (request, reply) => {
    try {
      const clerkUserId = getClerkUserIdFromRequest(request);
      return await organizationProfileService.listForScope(clerkUserId);
    } catch (error) {
      request.log.error({ error }, "Failed to list organizations");
      const payload = toErrorPayload(error);
      return reply.status(getStatusCodeForError(error, payload, 500)).send(payload);
    }
  });

  const saveOrganization = async (
    request: FastifyRequest,
    reply: FastifyReply,
    organizationId?: string,
  ) => {
    try {
      const body = (request.body as Record<string, unknown> | undefined) ?? {};
      const clerkUserId = getClerkUserIdFromRequest(request);
      const payload: OrganizationProfileInput = {
        organizationId,
        clerkUserId,
        legalName: String(body.legalName ?? ""),
        ein: String(body.ein ?? ""),
        mission: String(body.mission ?? ""),
        dbaName: body.dbaName ? String(body.dbaName) : null,
        foundedYear: toOptionalNumber(body.foundedYear),
        vision: body.vision ? String(body.vision) : null,
        annualBudget: toOptionalNumber(body.annualBudget),
        staffCount: toOptionalNumber(body.staffCount),
        volunteerCount: toOptionalNumber(body.volunteerCount),
        executiveDirector: body.executiveDirector ? String(body.executiveDirector) : null,
        grantsContact: body.grantsContact ? String(body.grantsContact) : null,
        boardChair: body.boardChair ? String(body.boardChair) : null,
        address: body.address ? String(body.address) : null,
        website: body.website ? String(body.website) : null,
        phone: body.phone ? String(body.phone) : null,
        serviceArea: body.serviceArea ? String(body.serviceArea) : null,
        programSummary: body.programSummary ? String(body.programSummary) : null,
        onboardingCompleted:
          typeof body.onboardingCompleted === "boolean"
            ? Boolean(body.onboardingCompleted)
            : null,
      };

      const result = await organizationProfileService.save(payload);
      const syncToNotion = Boolean(body.syncToNotion);
      const notionSync =
        syncToNotion && notionClient
          ? await notionClient.syncOrganizationProfile({
              legalName: result.organization.legalName,
              ein: result.organization.ein,
              mission: result.organization.mission,
              annualBudget: result.organization.annualBudget,
              staffSize: result.organization.staffCount,
              foundingYear: result.organization.foundedYear,
              executiveDirector: result.organization.executiveDirector,
              grantsContact: result.organization.grantsContact,
              address: result.organization.address,
              serviceArea: result.organization.serviceArea,
              programAreas: result.organization.programSummary,
              website: result.organization.website,
            })
          : undefined;

      return {
        ...result,
        notionSync,
      };
    } catch (error) {
      request.log.error({ error }, "Failed to save organization profile");
      const payload = toErrorPayload(error);
      const statusCode = getStatusCodeForError(error, payload, 500);
      return reply.status(statusCode).send(payload);
    }
  };

  app.post("/organizations", async (request, reply) => saveOrganization(request, reply));
  app.patch("/organizations/:organizationId", async (request, reply) => {
    const params = request.params as { organizationId: string };
    return saveOrganization(request, reply, params.organizationId);
  });
};
