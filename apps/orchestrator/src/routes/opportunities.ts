import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { funderFilings, funderGrantRows, funders, opportunities } from "../db/schema.js";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { FunderFilingParsingService } from "../services/funders/filing-parser.js";
import { FunderIntelligenceService } from "../services/funders/intelligence.js";
import { OpportunityDraftingService } from "../services/opportunities/drafting.js";
import { OpportunityAnalysisService } from "../services/opportunities/analysis.js";
import { OpportunityCatalogService } from "../services/opportunities/catalog.js";
import { OpportunityReviewWorkflowService } from "../services/opportunities/review-workflow.js";
import { SubmissionPacketService } from "../services/opportunities/submission-packet.js";
import { SubmissionAutopilotService } from "../services/opportunities/submission-autopilot.js";
import { SubmissionFormFillService } from "../services/opportunities/submission-form-fill.js";
import { PortalSchemaProfileService } from "../services/opportunities/portal-schema.js";
import { PortalDiscoveryService } from "../services/opportunities/portal-discovery.js";
import { SubmissionSessionsService } from "../services/opportunities/submission-sessions.js";
import { SubmissionUploadStagingService } from "../services/opportunities/submission-upload-staging.js";
import { OpportunityWorkbenchService } from "../services/opportunities/workbench.js";

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

const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
  isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

export const registerOpportunityRoutes = (
  app: FastifyInstance,
  portalDiscoveryService: PortalDiscoveryService,
  funderIntelligenceService: FunderIntelligenceService,
  funderFilingParsingService: FunderFilingParsingService,
  opportunityCatalogService: OpportunityCatalogService,
  opportunityAnalysisService: OpportunityAnalysisService,
  opportunityWorkbenchService: OpportunityWorkbenchService,
  opportunityDraftingService: OpportunityDraftingService,
  opportunityReviewWorkflowService: OpportunityReviewWorkflowService,
  submissionPacketService: SubmissionPacketService,
  submissionAutopilotService: SubmissionAutopilotService,
  submissionFormFillService: SubmissionFormFillService,
  submissionUploadStagingService: SubmissionUploadStagingService,
  portalSchemaProfileService: PortalSchemaProfileService,
  submissionSessionsService: SubmissionSessionsService,
) => {
  const runAnalysisPipeline = async (input: {
    opportunityId: string;
    syncToNotion?: boolean;
    log: FastifyInstance["log"];
  }) => {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1);

    if (!opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);

    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }

    const shouldEnrichFunder =
      !funder.lastResearchedAt || !funder.givingSummary || !funder.ein;

    input.log.info(
      {
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        funderId: funder.id,
        shouldEnrichFunder,
        syncToNotion: input.syncToNotion ?? false,
      },
      "Analyze opportunity route hit",
    );

    if (shouldEnrichFunder) {
      const funderIntelligence = await funderIntelligenceService.run({
        funderId: funder.id,
        website: funder.website ?? undefined,
        syncToNotion: input.syncToNotion,
      });

      input.log.info(
        {
          opportunityId: opportunity.id,
          funderId: funder.id,
          latestTaxYear: funderIntelligence.metrics.latestTaxYear,
          privateFoundationFilings: funderIntelligence.metrics.privateFoundationFilings,
          averageGrant: funderIntelligence.metrics.averageGrant,
          medianGrant: funderIntelligence.metrics.medianGrant,
        },
        "Funder intelligence completed during analyze pipeline",
      );
    } else {
      input.log.info(
        {
          opportunityId: opportunity.id,
          funderId: funder.id,
          lastResearchedAt: funder.lastResearchedAt,
        },
        "Skipping funder enrichment because stored intelligence already exists",
      );
    }

    const [currentGrantRows, currentFilingRows] = await Promise.all([
      db.select().from(funderGrantRows).where(eq(funderGrantRows.funderId, funder.id)),
      db.select().from(funderFilings).where(eq(funderFilings.funderId, funder.id)),
    ]);

    const hasFilingMetadata = currentFilingRows.some(
      (row) => typeof row.sourceUrl === "string" && row.sourceUrl.length > 0,
    );
    const hasPendingFilingWork = currentFilingRows.some(
      (row) => row.parsedStatus === "Queued" || row.parsedStatus === "Failed",
    );

    if (hasFilingMetadata && (currentGrantRows.length === 0 || hasPendingFilingWork)) {
      const parsingResult = await funderFilingParsingService.run({
        funderId: funder.id,
        limit: 3,
        force: hasPendingFilingWork,
        syncToNotion: input.syncToNotion,
      });

      input.log.info(
        {
          opportunityId: opportunity.id,
          funderId: funder.id,
          parsedFilingCount: parsingResult.aggregate.parsedFilingCount,
          extractedGrantRows: parsingResult.aggregate.extractedGrantRows,
        },
        "Parsed funder filings during analyze pipeline",
      );
    }

    const analysis = await opportunityAnalysisService.run({
      opportunityId: opportunity.id,
      syncToNotion: input.syncToNotion,
    });

    input.log.info(
      {
        opportunityId: opportunity.id,
        fitScore: analysis.scoring.fitScore,
        evidenceCoveragePercent: analysis.scoring.evidenceCoveragePercent,
        pursueDecision: analysis.scoring.pursueDecision,
      },
      "Opportunity analysis pipeline completed",
    );

    return analysis;
  };

  app.get("/opportunities", async (request, reply) => {
    try {
      const query = (request.query as { organizationId?: string } | undefined) ?? {};
      const clerkUserId = getClerkUserIdFromRequest(request);
      return await opportunityCatalogService.list({
        organizationId: query.organizationId,
        clerkUserId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list opportunities");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/opportunities/discover-portal", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          sourceUrl?: string;
          rawText?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId && !body.sourceUrl && !body.rawText) {
        return reply.status(400).send({
          message: "Portal discovery requires an opportunityId, sourceUrl, or rawText.",
          name: "Error",
        });
      }

      return await portalDiscoveryService.run({
        opportunityId: body.opportunityId,
        sourceUrl: body.sourceUrl,
        rawText: body.rawText,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to discover opportunity portal");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId, sourceUrl, or rawText") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("Failed to discover a portal from source URL")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/discover-portal", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          sourceUrl?: string;
          rawText?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await portalDiscoveryService.run({
        opportunityId: params.opportunityId,
        sourceUrl: body.sourceUrl,
        rawText: body.rawText,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to discover opportunity portal");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("Failed to discover a portal from source URL")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/portal-readiness", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const query = (request.query as { probe?: string } | undefined) ?? {};

      return await portalDiscoveryService.assessReadiness({
        opportunityId: params.opportunityId,
        probe: (query.probe ?? "").toLowerCase() === "true",
      });
    } catch (error) {
      request.log.error({ error }, "Failed to assess opportunity portal readiness");
      const payload = toErrorPayload(error);
      const statusCode = payload.message.includes("No opportunity exists") ? 400 : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.patch("/opportunities/:opportunityId", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          portalUrl?: string;
          submissionMethod?: "Submittable" | "Email" | "Portal" | "Other";
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.portalUrl) {
        return reply.status(400).send({
          message: "Opportunity update currently requires a portalUrl.",
          name: "Error",
        });
      }

      return await opportunityCatalogService.updatePortal({
        opportunityId: params.opportunityId,
        portalUrl: body.portalUrl,
        submissionMethod: body.submissionMethod,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to update opportunity portal");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a portalUrl") ||
        payload.message.includes("No opportunity exists")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/analyze", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId) {
        return reply.status(400).send({
          message: "Opportunity analysis requires an opportunityId.",
          name: "Error",
        });
      }

      return await runAnalysisPipeline({
        opportunityId: body.opportunityId,
        syncToNotion: body.syncToNotion,
        log: request.log,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to analyze opportunity");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/analyze", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await runAnalysisPipeline({
        opportunityId: params.opportunityId,
        syncToNotion: body.syncToNotion,
        log: request.log,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to analyze opportunity");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/workbench", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      request.log.info({ opportunityId: params.opportunityId }, "Opportunity workbench snapshot requested");
      return await opportunityWorkbenchService.get(params.opportunityId);
    } catch (error) {
      request.log.error({ error }, "Failed to load opportunity workbench snapshot");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("references a missing funder")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/draft-answers", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId) {
        return reply.status(400).send({
          message: "Draft generation requires an opportunityId.",
          name: "Error",
        });
      }

      return await opportunityDraftingService.run({
        opportunityId: body.opportunityId,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to generate draft answers");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/draft-answers", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      return await opportunityDraftingService.run({
        opportunityId: params.opportunityId,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to generate draft answers");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.patch("/opportunities/:opportunityId/draft-answers/:draftAnswerId", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string; draftAnswerId: string };
      const body =
        (request.body as {
          draftText?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await opportunityDraftingService.update({
        draftAnswerId: params.draftAnswerId,
        draftText: body.draftText,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to update draft answer");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No draft answer exists") ||
        payload.message.includes("references a missing requirement") ||
        payload.message.includes("references an opportunity with no funder")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post(
    "/opportunities/:opportunityId/draft-answers/:draftAnswerId/approve",
    async (request, reply) => {
      try {
        const params = request.params as { opportunityId: string; draftAnswerId: string };
        const body =
          (request.body as {
            syncToNotion?: boolean;
          } | undefined) ?? {};

        return await opportunityDraftingService.approve({
          draftAnswerId: params.draftAnswerId,
          syncToNotion: body.syncToNotion,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to approve draft answer");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("No draft answer exists") ||
          payload.message.includes("references a missing requirement") ||
          payload.message.includes("references an opportunity with no funder") ||
          payload.message.includes("still has unsupported sections")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.post("/opportunities/review", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          reviewer?: string;
          dueDate?: string;
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId) {
        return reply.status(400).send({
          message: "Review workflow requires an opportunityId.",
          name: "Error",
        });
      }

      return await opportunityReviewWorkflowService.run({
        opportunityId: body.opportunityId,
        reviewer: body.reviewer,
        dueDate: body.dueDate,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to prepare opportunity review workflow");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records") ||
        payload.message.includes("has no draft answer yet")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/review", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          reviewer?: string;
          dueDate?: string;
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      return await opportunityReviewWorkflowService.run({
        opportunityId: params.opportunityId,
        reviewer: body.reviewer,
        dueDate: body.dueDate,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to prepare opportunity review workflow");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records") ||
        payload.message.includes("has no draft answer yet")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/review-readiness", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      return await opportunityReviewWorkflowService.getReadiness(params.opportunityId);
    } catch (error) {
      request.log.error({ error }, "Failed to read opportunity review readiness");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("No organization profile exists") ||
        payload.message.includes("has no requirement records")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/reviews/respond", async (request, reply) => {
    try {
      const body =
        (request.body as {
          reviewId?: string;
          status?: "Requested" | "In Review" | "Changes Requested" | "Approved";
          reviewerNotes?: string;
          assignee?: string;
          dueDate?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.reviewId || !body.status) {
        return reply.status(400).send({
          message: "Review response requires both reviewId and status.",
          name: "Error",
        });
      }

      return await opportunityReviewWorkflowService.respond({
        reviewId: body.reviewId,
        status: body.status,
        reviewerNotes: body.reviewerNotes,
        assignee: body.assignee,
        dueDate: body.dueDate,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to record review response");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires both reviewId and status") ||
        payload.message.includes("No review exists") ||
        payload.message.includes("references a missing opportunity")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/reviews/:reviewId/respond", async (request, reply) => {
    try {
      const params = request.params as { reviewId: string };
      const body =
        (request.body as {
          status?: "Requested" | "In Review" | "Changes Requested" | "Approved";
          reviewerNotes?: string;
          assignee?: string;
          dueDate?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.status) {
        return reply.status(400).send({
          message: "Review response requires a status.",
          name: "Error",
        });
      }

      return await opportunityReviewWorkflowService.respond({
        reviewId: params.reviewId,
        status: body.status,
        reviewerNotes: body.reviewerNotes,
        assignee: body.assignee,
        dueDate: body.dueDate,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to record review response");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a status") ||
        payload.message.includes("No review exists") ||
        payload.message.includes("references a missing opportunity")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/assemble-submission", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          syncToNotion?: boolean;
          confirmAutopilot?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId) {
        return reply.status(400).send({
          message: "Submission packet assembly requires an opportunityId.",
          name: "Error",
        });
      }

      return await submissionPacketService.run({
        opportunityId: body.opportunityId,
        syncToNotion: body.syncToNotion,
        confirmAutopilot: body.confirmAutopilot,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to assemble submission packet");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("has no requirement records") ||
        payload.message.includes("missing funder")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/assemble-submission", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          syncToNotion?: boolean;
          confirmAutopilot?: boolean;
        } | undefined) ?? {};

      return await submissionPacketService.run({
        opportunityId: params.opportunityId,
        syncToNotion: body.syncToNotion,
        confirmAutopilot: body.confirmAutopilot,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to assemble submission packet");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("has no requirement records") ||
        payload.message.includes("missing funder")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/launch-autopilot", async (request, reply) => {
    try {
      const body =
        (request.body as {
          opportunityId?: string;
          confirmLaunch?: boolean;
          launchBrowser?: boolean;
          reviewerName?: string;
          reviewerNotes?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.opportunityId) {
        return reply.status(400).send({
          message: "Autopilot launch requires an opportunityId.",
          name: "Error",
        });
      }

      return await submissionAutopilotService.launch({
        opportunityId: body.opportunityId,
        confirmLaunch: body.confirmLaunch,
        launchBrowser: body.launchBrowser,
        reviewerName: body.reviewerName,
        reviewerNotes: body.reviewerNotes,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to prepare submission autopilot launch");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires an opportunityId") ||
        payload.message.includes("confirmLaunch=true") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("Submission handoff is blocked") ||
        payload.message.includes("does not support browser launch") ||
        payload.message.includes("requires a target reference")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/opportunities/:opportunityId/launch-autopilot", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const body =
        (request.body as {
          confirmLaunch?: boolean;
          launchBrowser?: boolean;
          reviewerName?: string;
          reviewerNotes?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await submissionAutopilotService.launch({
        opportunityId: params.opportunityId,
        confirmLaunch: body.confirmLaunch,
        launchBrowser: body.launchBrowser,
        reviewerName: body.reviewerName,
        reviewerNotes: body.reviewerNotes,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to prepare submission autopilot launch");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("confirmLaunch=true") ||
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("Submission handoff is blocked") ||
        payload.message.includes("does not support browser launch") ||
        payload.message.includes("requires a target reference")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/opportunities/:opportunityId/submission-sessions", async (request, reply) => {
    try {
      const params = request.params as { opportunityId: string };
      const query = (request.query as { organizationId?: string } | undefined) ?? {};

      return await submissionSessionsService.listByOpportunity({
        opportunityId: params.opportunityId,
        organizationId: query.organizationId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to list submission sessions");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No opportunity exists") ||
        payload.message.includes("requested organizationId")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get(
    "/opportunities/:opportunityId/submission-sessions/:submissionSessionId",
    async (request, reply) => {
      try {
        const params = request.params as {
          opportunityId: string;
          submissionSessionId: string;
        };
        const query = (request.query as { organizationId?: string } | undefined) ?? {};

        return await submissionSessionsService.getByOpportunity({
          opportunityId: params.opportunityId,
          submissionSessionId: params.submissionSessionId,
          organizationId: query.organizationId,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to read submission session detail");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("No opportunity exists") ||
          payload.message.includes("No submission session exists") ||
          payload.message.includes("requested organizationId") ||
          payload.message.includes("missing submission record")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.post("/submission-sessions/authorize-final-submit", async (request, reply) => {
    try {
      const body =
        (request.body as {
          submissionSessionId?: string;
          confirmFinalSubmit?: boolean;
          reviewerName?: string;
          reviewerNotes?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.submissionSessionId) {
        return reply.status(400).send({
          message: "Final submit authorization requires a submissionSessionId.",
          name: "Error",
        });
      }

      return await submissionAutopilotService.authorizeFinalSubmit({
        submissionSessionId: body.submissionSessionId,
        confirmFinalSubmit: body.confirmFinalSubmit,
        reviewerName: body.reviewerName,
        reviewerNotes: body.reviewerNotes,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to authorize final submit");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a submissionSessionId") ||
        payload.message.includes("confirmFinalSubmit=true") ||
        payload.message.includes("No submission session exists") ||
        payload.message.includes("Final submit authorization is blocked") ||
        payload.message.includes("only used for browser-based submission adapters")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post(
    "/submission-sessions/:submissionSessionId/authorize-final-submit",
    async (request, reply) => {
      try {
        const params = request.params as { submissionSessionId: string };
        const body =
          (request.body as {
            confirmFinalSubmit?: boolean;
            reviewerName?: string;
            reviewerNotes?: string;
            syncToNotion?: boolean;
          } | undefined) ?? {};

        return await submissionAutopilotService.authorizeFinalSubmit({
          submissionSessionId: params.submissionSessionId,
          confirmFinalSubmit: body.confirmFinalSubmit,
          reviewerName: body.reviewerName,
          reviewerNotes: body.reviewerNotes,
          syncToNotion: body.syncToNotion,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to authorize final submit");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("confirmFinalSubmit=true") ||
          payload.message.includes("No submission session exists") ||
          payload.message.includes("Final submit authorization is blocked") ||
          payload.message.includes("only used for browser-based submission adapters")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.post("/submission-sessions/stage-upload-artifacts", async (request, reply) => {
    try {
      const body =
        (request.body as {
          submissionSessionId?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.submissionSessionId) {
        return reply.status(400).send({
          message: "Upload staging requires a submissionSessionId.",
          name: "Error",
        });
      }

      return await submissionUploadStagingService.stage({
        submissionSessionId: body.submissionSessionId,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to stage upload artifacts");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a submissionSessionId") ||
        payload.message.includes("No submission session exists") ||
        payload.message.includes("missing submission record") ||
        payload.message.includes("missing opportunity record") ||
        payload.message.includes("No attachment requirements")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post(
    "/submission-sessions/:submissionSessionId/stage-upload-artifacts",
    async (request, reply) => {
      try {
        const params = request.params as { submissionSessionId: string };
        const body =
          (request.body as {
            syncToNotion?: boolean;
          } | undefined) ?? {};

        return await submissionUploadStagingService.stage({
          submissionSessionId: params.submissionSessionId,
          syncToNotion: body.syncToNotion,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to stage upload artifacts");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("No submission session exists") ||
          payload.message.includes("missing submission record") ||
          payload.message.includes("missing opportunity record") ||
          payload.message.includes("No attachment requirements")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.post("/submission-sessions/prepare-form-fill", async (request, reply) => {
    try {
      const body =
        (request.body as {
          submissionSessionId?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      if (!body.submissionSessionId) {
        return reply.status(400).send({
          message: "Portal field planning requires a submissionSessionId.",
          name: "Error",
        });
      }

      return await submissionFormFillService.prepare({
        submissionSessionId: body.submissionSessionId,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to prepare portal field plan");
      const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("requires a submissionSessionId") ||
          payload.message.includes("No submission session exists") ||
          payload.message.includes("missing submission record") ||
          payload.message.includes("missing opportunity record") ||
          payload.message.includes("No portal field mappings") ||
          payload.message.includes("only available for browser-based submission methods")
            ? 400
            : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post(
    "/submission-sessions/:submissionSessionId/prepare-form-fill",
    async (request, reply) => {
      try {
        const params = request.params as { submissionSessionId: string };
        const body =
          (request.body as {
            syncToNotion?: boolean;
          } | undefined) ?? {};

        return await submissionFormFillService.prepare({
          submissionSessionId: params.submissionSessionId,
          syncToNotion: body.syncToNotion,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to prepare portal field plan");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("No submission session exists") ||
          payload.message.includes("missing submission record") ||
          payload.message.includes("missing opportunity record") ||
          payload.message.includes("No portal field mappings") ||
          payload.message.includes("only available for browser-based submission methods")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.post("/submission-sessions/capture-portal-schema", async (request, reply) => {
    try {
      const body =
        (request.body as {
          submissionSessionId?: string;
          portalUrl?: string;
          fields?: Array<{
            key: string;
            label: string;
            tagName: string;
            type: string;
            placeholder?: string | null;
            ariaLabel?: string | null;
          }>;
          captureSource?: string;
        } | undefined) ?? {};

      if (!body.fields || body.fields.length === 0) {
        return reply.status(400).send({
          message: "Portal schema capture requires a non-empty fields array.",
          name: "Error",
        });
      }
      if (!body.submissionSessionId && !body.portalUrl) {
        return reply.status(400).send({
          message: "Portal schema capture requires either a submissionSessionId or portalUrl.",
          name: "Error",
        });
      }

      return await portalSchemaProfileService.capture({
        submissionSessionId: body.submissionSessionId,
        portalUrl: body.portalUrl,
        fields: body.fields,
        captureSource: body.captureSource,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to capture portal schema");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a non-empty fields array") ||
        payload.message.includes("requires either a submissionSessionId or portalUrl") ||
        payload.message.includes("No submission session exists") ||
        payload.message.includes("requires a portal URL")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post(
    "/submission-sessions/:submissionSessionId/capture-portal-schema",
    async (request, reply) => {
      try {
        const params = request.params as { submissionSessionId: string };
        const body =
          (request.body as {
            portalUrl?: string;
            fields?: Array<{
              key: string;
              label: string;
              tagName: string;
              type: string;
              placeholder?: string | null;
              ariaLabel?: string | null;
            }>;
            captureSource?: string;
          } | undefined) ?? {};

        if (!body.fields || body.fields.length === 0) {
          return reply.status(400).send({
            message: "Portal schema capture requires a non-empty fields array.",
            name: "Error",
          });
        }

        return await portalSchemaProfileService.capture({
          submissionSessionId: params.submissionSessionId,
          portalUrl: body.portalUrl,
          fields: body.fields,
          captureSource: body.captureSource,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to capture portal schema");
        const payload = toErrorPayload(error);
        const statusCode =
          payload.message.includes("requires a non-empty fields array") ||
          payload.message.includes("No submission session exists") ||
          payload.message.includes("requires a portal URL")
            ? 400
            : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );

  app.get(
    "/submission-sessions/:submissionSessionId/portal-schema-profiles",
    async (request, reply) => {
      try {
        const params = request.params as { submissionSessionId: string };
        return await portalSchemaProfileService.getProfileHintsForSession(
          params.submissionSessionId,
        );
      } catch (error) {
        request.log.error({ error }, "Failed to read portal schema profiles");
        const payload = toErrorPayload(error);
        const statusCode = payload.message.includes("No submission session exists") ? 400 : 500;
        return reply.status(statusCodeForError(error, statusCode)).send(payload);
      }
    },
  );
};
