import type { FastifyInstance } from "fastify";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { draftAnswers, funders, opportunities, requirements } from "../db/schema.js";
import { isNotionAuthorizationError } from "../services/notion/client.js";
import { FunderContrastService } from "../services/funders/contrast.js";
import { FunderFilingParsingService } from "../services/funders/filing-parser.js";
import { computeGrantDnaAlignment, readStoredGrantDnaProfile } from "../services/funders/grant-dna.js";
import { FunderIntelligenceService } from "../services/funders/intelligence.js";

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

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const parseCommaSeparated = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const parseGrantDnaTopTerms = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return normalizeText(item);
      }

      if (item && typeof item === "object" && "term" in item) {
        return normalizeText(String((item as { term?: unknown }).term ?? ""));
      }

      return normalizeText(String(item));
    })
    .filter(Boolean);
};

const parseStoredInsights = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null as null | {
      sourceLine?: string;
      grantDna?: {
        topTerms?: unknown[];
        framingStyles?: string[];
        toneSummary?: string;
      };
    };
  }

  try {
    return JSON.parse(normalized) as {
      sourceLine?: string;
      grantDna?: {
        topTerms?: unknown[];
        framingStyles?: string[];
        toneSummary?: string;
      };
    };
  } catch {
    return null;
  }
};

const parseDraftRevisionNotes = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(normalized) as { dnaSuggestions?: unknown };
    return Array.isArray(parsed.dnaSuggestions)
      ? parsed.dnaSuggestions.map((item) => normalizeText(String(item))).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

export const registerFunderRoutes = (
  app: FastifyInstance,
  funderIntelligenceService: FunderIntelligenceService,
  funderFilingParsingService: FunderFilingParsingService,
  funderContrastService: FunderContrastService,
) => {
  const statusCodeForError = (error: unknown, fallbackStatusCode: number) =>
    isNotionAuthorizationError(error) ? 401 : fallbackStatusCode;

  app.get("/funders", async (request, reply) => {
    try {
      const rows = await db.select().from(funders).orderBy(asc(funders.name));
      return {
        funders: rows.map((row) => ({
          id: row.id,
          name: row.name,
          ein: row.ein,
          website: row.website,
          givingSummary: row.givingSummary,
          averageGrant: row.averageGrant,
          medianGrant: row.medianGrant,
          geographicFocus: row.geographicFocus,
          updatedAt: row.updatedAt,
        })),
      };
    } catch (error) {
      request.log.error({ error }, "Failed to list funders");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.get("/funders/:funderId", async (request, reply) => {
    try {
      const params = request.params as { funderId: string };
      const [funder] = await db
        .select()
        .from(funders)
        .where(eq(funders.id, params.funderId))
        .limit(1);

      if (!funder) {
        return reply.status(404).send({
          message: "No local funder record exists for the provided funderId.",
          name: "Error",
        });
      }

      const opportunityRows = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.funderId, funder.id))
        .orderBy(desc(opportunities.updatedAt));
      const opportunityIds = opportunityRows.map((row) => row.id);
      const [requirementRows, draftRows] = opportunityIds.length
        ? await Promise.all([
            db.select().from(requirements).where(inArray(requirements.opportunityId, opportunityIds)),
            db.select().from(draftAnswers).where(inArray(draftAnswers.opportunityId, opportunityIds)),
          ])
        : [[], []];

      const storedInsights = parseStoredInsights(funder.relationshipHistory);
      const grantDnaProfile = readStoredGrantDnaProfile({
        relationshipHistory: funder.relationshipHistory,
        grantDnaTopTerms: funder.grantDnaTopTerms,
        narrativeStyle: funder.narrativeStyle,
        toneNotes: funder.toneNotes,
      });
      const opportunityById = new Map(opportunityRows.map((row) => [row.id, row]));
      const requirementById = new Map(requirementRows.map((row) => [row.id, row]));

      return {
        funder: {
          id: funder.id,
          name: funder.name,
          ein: funder.ein,
          website: funder.website,
          givingSummary: funder.givingSummary,
          averageGrant: funder.averageGrant,
          medianGrant: funder.medianGrant,
          grantRange: funder.grantRange,
          grantDnaTopPhrases:
            parseGrantDnaTopTerms(storedInsights?.grantDna?.topTerms).length
              ? parseGrantDnaTopTerms(storedInsights?.grantDna?.topTerms)
              : parseCommaSeparated(funder.grantDnaTopTerms),
          framingStyles:
            storedInsights?.grantDna?.framingStyles?.length
              ? storedInsights.grantDna.framingStyles
              : parseCommaSeparated(normalizeText(funder.narrativeStyle).replace(/·/g, ",")),
          toneSummary:
            normalizeText(storedInsights?.grantDna?.toneSummary) ||
            normalizeText(funder.toneNotes) ||
            "Grant DNA is still being assembled from the funder's website, RFP language, annual materials, and 990 descriptions.",
          sourceLine:
            normalizeText(storedInsights?.sourceLine) ||
            "Based on captured funder language, RFP text, and 990-backed purpose descriptions.",
          lastResearchedAt: funder.lastResearchedAt,
        },
        drafts: draftRows.map((draft) => {
          const alignment = computeGrantDnaAlignment({
            profile: grantDnaProfile,
            draftText: draft.draftText,
          });
          const opportunity = opportunityById.get(draft.opportunityId);
          const requirement = requirementById.get(draft.requirementId);

          return {
            id: draft.id,
            opportunityId: draft.opportunityId,
            opportunityTitle: opportunity?.title ?? "Opportunity",
            questionText: requirement?.questionText ?? "Requirement",
            status: draft.status,
            dnaMatchScore: draft.dnaMatchScore ?? alignment.score,
            dnaSuggestions: parseDraftRevisionNotes(draft.revisionNotes).length
              ? parseDraftRevisionNotes(draft.revisionNotes)
              : alignment.suggestions,
          };
        }),
      };
    } catch (error) {
      request.log.error({ error }, "Failed to load funder detail");
      return reply.status(statusCodeForError(error, 500)).send(toErrorPayload(error));
    }
  });

  app.post("/funders/enrich", async (request, reply) => {
    try {
      const body =
        (request.body as {
          funderId?: string;
          name?: string;
          ein?: string;
          website?: string;
          syncToNotion?: boolean;
        } | undefined) ?? {};

      return await funderIntelligenceService.run(body);
    } catch (error) {
      request.log.error({ error }, "Failed to enrich funder intelligence");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a funderId, name, or EIN") ||
        payload.message.includes("No local funder record exists")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/funders/:funderId/enrich", async (request, reply) => {
    try {
      const params = request.params as { funderId: string };
      const body =
        (request.body as {
          syncToNotion?: boolean;
          website?: string;
          name?: string;
          ein?: string;
        } | undefined) ?? {};

      return await funderIntelligenceService.run({
        funderId: params.funderId,
        syncToNotion: body.syncToNotion,
        website: body.website,
        name: body.name,
        ein: body.ein,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to enrich funder intelligence");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a funderId, name, or EIN") ||
        payload.message.includes("No local funder record exists")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/funders/parse-filings", async (request, reply) => {
    try {
      const body =
        (request.body as {
          funderId?: string;
          taxYear?: number;
          limit?: number;
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      if (!body.funderId) {
        return reply.status(400).send({
          message: "Filing parsing requires a funderId.",
          name: "Error",
        });
      }

      return await funderFilingParsingService.run({
        funderId: body.funderId,
        taxYear: body.taxYear,
        limit: body.limit,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to parse funder filings");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires a funderId") ||
        payload.message.includes("No local funder record exists") ||
        payload.message.includes("No filing metadata exists yet") ||
        payload.message.includes("No parseable PDF filings")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/funders/:funderId/parse-filings", async (request, reply) => {
    try {
      const params = request.params as { funderId: string };
      const body =
        (request.body as {
          taxYear?: number;
          limit?: number;
          syncToNotion?: boolean;
          force?: boolean;
        } | undefined) ?? {};

      return await funderFilingParsingService.run({
        funderId: params.funderId,
        taxYear: body.taxYear,
        limit: body.limit,
        syncToNotion: body.syncToNotion,
        force: body.force,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to parse funder filings");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("No local funder record exists") ||
        payload.message.includes("No filing metadata exists yet") ||
        payload.message.includes("No parseable PDF filings")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.get("/funders/contrast", async (request, reply) => {
    try {
      const query =
        (request.query as
          | {
              leftFunderId?: string;
              rightFunderId?: string;
            }
          | undefined) ?? {};

      if (!query.leftFunderId || !query.rightFunderId) {
        return reply.status(400).send({
          message: "Funder contrast requires leftFunderId and rightFunderId.",
          name: "Error",
        });
      }

      return await funderContrastService.run({
        leftFunderId: query.leftFunderId,
        rightFunderId: query.rightFunderId,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to build funder contrast");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires both leftFunderId and rightFunderId") ||
        payload.message.includes("Pick two different funders") ||
        payload.message.includes("No local funder record exists")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });

  app.post("/funders/contrast", async (request, reply) => {
    try {
      const body =
        (request.body as
          | {
              leftFunderId?: string;
              rightFunderId?: string;
              syncToNotion?: boolean;
            }
          | undefined) ?? {};

      if (!body.leftFunderId || !body.rightFunderId) {
        return reply.status(400).send({
          message: "Funder contrast requires leftFunderId and rightFunderId.",
          name: "Error",
        });
      }

      return await funderContrastService.run({
        leftFunderId: body.leftFunderId,
        rightFunderId: body.rightFunderId,
        syncToNotion: body.syncToNotion,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to build funder contrast");
      const payload = toErrorPayload(error);
      const statusCode =
        payload.message.includes("requires both leftFunderId and rightFunderId") ||
        payload.message.includes("Pick two different funders") ||
        payload.message.includes("No local funder record exists")
          ? 400
          : 500;
      return reply.status(statusCodeForError(error, statusCode)).send(payload);
    }
  });
};
