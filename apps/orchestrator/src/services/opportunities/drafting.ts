import { randomUUID } from "node:crypto";
import { Type, type Schema } from "@google/genai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  budgets,
  documents,
  draftAnswers,
  evidenceLibrary,
  funders,
  opportunities,
  organizations,
  programs,
  requirements,
} from "../../db/schema.js";
import { AgentProgressService } from "../agent-progress/service.js";
import { GeminiClient } from "../gemini/client.js";
import {
  computeGrantDnaAlignment,
  readStoredGrantDnaProfile,
  type GrantDnaProfile,
} from "../funders/grant-dna.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { OpportunityAnalysisService } from "./analysis.js";
import {
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "./opportunity-identity.js";
import { selectRetainedRequirementIds } from "./requirement-normalization.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type SupportSourceType = "organization" | "program" | "evidence" | "document" | "budget";
type RequirementKind = "narrative" | "document" | "budget" | "eligibility";

type DraftStatus = "Not Started" | "Drafting" | "Needs Review" | "Approved";

type DraftSupportSource = {
  ref: string;
  id: string;
  type: SupportSourceType;
  title: string;
  text: string;
};

export type OpportunityDraftingInput = {
  opportunityId: string;
  syncToNotion?: boolean;
  force?: boolean;
};

export type DraftAnswerMutationInput = {
  draftAnswerId: string;
  draftText?: string;
  syncToNotion?: boolean;
};

export type DraftAnswerMutationResult = {
  draftAnswerId: string;
  opportunityId: string;
  opportunityTitle: string;
  requirementId: string;
  questionText: string;
  status: DraftStatus;
  draftText: string;
  wordCount: number;
  evidenceCitations: string[];
  unsupportedClaims: string[];
  dnaMatchScore: number;
  dnaSuggestions: string[];
  notionSync?: {
    opportunityPageId: string;
    draftPageIds: string[];
  };
};

export type OpportunityDraftingResult = {
  opportunityId: string;
  opportunityTitle: string;
  funderId: string;
  funderName: string;
  draftedCount: number;
  preservedCount: number;
  drafts: Array<{
    requirementId: string;
    draftAnswerId: string;
    questionText: string;
    requirementType: string;
    status: DraftStatus;
    draftText: string;
    wordCount: number;
    evidenceCitations: string[];
    unsupportedClaims: string[];
    dnaMatchScore: number;
    dnaSuggestions: string[];
    generationMethod: "gemini" | "heuristic" | "preserved";
    draftPreview: string;
  }>;
  notionSync?: {
    opportunityPageId: string;
    draftPageIds: string[];
  };
};

const structuredDraftSchema = z.object({
  draftText: z.string().min(1),
  evidenceCitations: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
});

const draftResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["draftText", "evidenceCitations", "unsupportedClaims"],
  propertyOrdering: ["draftText", "evidenceCitations", "unsupportedClaims"],
  properties: {
    draftText: {
      type: Type.STRING,
      description: "Grounded draft text that uses only the provided support sources.",
    },
    evidenceCitations: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: "Titles of the support sources explicitly used in the draft.",
    },
    unsupportedClaims: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: "Claims that still need human verification or additional evidence.",
    },
  },
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const unique = <T>(values: T[]) => [...new Set(values)];

const firstSentence = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const sentence = normalized.match(/.+?[.!?](?:\s|$)/)?.[0]?.trim();
  return sentence || normalized;
};

const truncateToWordLimit = (value: string, wordLimit?: number | null) => {
  if (!wordLimit || wordLimit <= 0) {
    return normalizeText(value);
  }

  const words = normalizeText(value).split(/\s+/g);
  if (words.length <= wordLimit) {
    return words.join(" ");
  }

  return `${words.slice(0, wordLimit).join(" ")}...`;
};

const renderUnsupportedSection = (unsupportedClaims: string[]) => {
  if (unsupportedClaims.length === 0) {
    return "";
  }

  return `\n\nUNSUPPORTED:\n${unsupportedClaims.map((claim) => `- ${claim}`).join("\n")}`;
};

const inferRequirementKind = (requirementType: string, questionText: string): RequirementKind => {
  const normalizedType = requirementType.trim().toLowerCase();
  const normalizedText = questionText.toLowerCase();

  if (normalizedType.includes("budget") || normalizedText.includes("budget")) {
    return "budget";
  }

  if (
    normalizedType.includes("document") ||
    normalizedText.includes("determination letter") ||
    normalizedText.includes("board") ||
    normalizedText.includes("audit")
  ) {
    return "document";
  }

  if (normalizedType.includes("eligib")) {
    return "eligibility";
  }

  return "narrative";
};

const parseSupportRefs = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export class OpportunityDraftingService {
  private readonly logger: LoggerLike;
  private readonly progressService: AgentProgressService;

  constructor(
    private readonly geminiClient: GeminiClient,
    private readonly analysisService: OpportunityAnalysisService,
    private readonly notionClient?: NotionMcpClient,
    logger?: Partial<LoggerLike>,
  ) {
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : () => undefined,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : () => undefined,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : () => undefined,
    };
    this.progressService = new AgentProgressService(notionClient, logger);
  }

  async run(input: OpportunityDraftingInput): Promise<OpportunityDraftingResult> {
    const runId = randomUUID();
    const opportunity = await this.resolveOpportunity(input.opportunityId);
    await this.ensureOpportunityAnalyzed(opportunity.id, input.syncToNotion);

    await this.progressService.record({
      runId,
      agentName: "Narrative Agent",
      actionDescription: "Started grounded draft generation",
      progressLine: "⏳ Drafting grounded answers",
      summary: `Preparing draft answers for ${opportunity.title} using approved evidence and organization context.`,
      opportunityTitle: opportunity.title,
      followUpRequired: false,
      syncToNotion: input.syncToNotion,
    });

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);
    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }
    const grantDnaProfile = readStoredGrantDnaProfile({
      relationshipHistory: funder.relationshipHistory,
      grantDnaTopTerms: funder.grantDnaTopTerms,
      narrativeStyle: funder.narrativeStyle,
      toneNotes: funder.toneNotes,
    });

    const normalizedOrganizationId = normalizeText(opportunity.organizationId);
    const [organization] = normalizedOrganizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, normalizedOrganizationId))
          .limit(1)
      : await db.select().from(organizations).limit(1);
    if (!organization) {
      throw new Error("No organization profile exists yet. Seed demo data or create one first.");
    }

    const [
      rawRequirementRows,
      existingDraftRows,
      programRows,
      allEvidenceRows,
      allDocumentRows,
      allBudgetRows,
    ] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunity.id)),
      db.select().from(programs).where(eq(programs.organizationId, organization.id)),
      db.select().from(evidenceLibrary),
      db.select().from(documents),
      db.select().from(budgets),
    ]);

    if (rawRequirementRows.length === 0) {
      throw new Error("This opportunity has no requirement records to draft against.");
    }

    const activeRequirementIds = new Set(
      selectRetainedRequirementIds(
        rawRequirementRows.map((row) => ({
          id: row.id,
          questionText: row.questionText,
          requirementType: row.requirementType,
          wordLimit: row.wordLimit,
        })),
      ),
    );
    const requirementRows = rawRequirementRows.filter((row) => activeRequirementIds.has(row.id));

    const programIds = new Set(programRows.map((row) => row.id));
    const evidenceRows = allEvidenceRows.filter(
      (row) => row.programId && programIds.has(row.programId),
    );
    const documentRows = allDocumentRows.filter(
      (row) => !row.organizationId || row.organizationId === organization.id,
    );
    const budgetRows = allBudgetRows.filter(
      (row) => row.programId && programIds.has(row.programId),
    );

    const supportSourceMap = this.buildSupportSourceMap({
      organization,
      programs: programRows,
      evidence: evidenceRows,
      documents: documentRows,
      budgets: budgetRows,
    });
    const existingDraftMap = new Map(existingDraftRows.map((draft) => [draft.requirementId, draft]));

    let draftedCount = 0;
    let preservedCount = 0;
    const resultDrafts: OpportunityDraftingResult["drafts"] = [];

    for (const requirement of requirementRows) {
      const existingDraft = existingDraftMap.get(requirement.id);
      if (existingDraft && existingDraft.status === "Approved" && !input.force) {
        const preservedAlignment = computeGrantDnaAlignment({
          profile: grantDnaProfile,
          draftText: existingDraft.draftText,
        });
        preservedCount += 1;
        resultDrafts.push({
          requirementId: requirement.id,
          draftAnswerId: existingDraft.id,
          questionText: requirement.questionText,
          requirementType: requirement.requirementType ?? "Narrative Question",
          status: this.toDraftStatus(existingDraft.status),
          draftText: existingDraft.draftText,
          wordCount: existingDraft.wordCount ?? 0,
          evidenceCitations: this.parseJsonArray(existingDraft.evidenceCitations),
          unsupportedClaims: this.parseJsonArray(existingDraft.unsupportedClaims),
          dnaMatchScore: existingDraft.dnaMatchScore ?? 0,
          dnaSuggestions:
            this.parseDnaSuggestions(existingDraft.revisionNotes) ??
            preservedAlignment.suggestions,
          generationMethod: "preserved",
          draftPreview: normalizeText(existingDraft.draftText).slice(0, 200),
        });
        continue;
      }

      const supportSources = parseSupportRefs(requirement.linkedEvidenceIds)
        .map((ref) => supportSourceMap.get(ref))
        .filter((source): source is DraftSupportSource => Boolean(source));

      const generated = await this.generateRequirementDraft({
        grantDnaProfile,
        funder,
        opportunity,
        organization,
        requirement,
        supportSources,
      });

      const now = new Date().toISOString();
      const renderedDraftText = this.composeStoredDraftText(
        generated.draftText,
        generated.unsupportedClaims,
      );
      const upsertedDraft = existingDraft
        ? await this.updateDraft(existingDraft.id, {
            updatedAt: now,
            draftText: renderedDraftText,
            wordCount: normalizeText(renderedDraftText).split(/\s+/g).filter(Boolean).length,
            evidenceCitations: JSON.stringify(generated.evidenceCitations),
            unsupportedClaims: JSON.stringify(generated.unsupportedClaims),
            status: generated.status,
            dnaMatchScore: generated.dnaMatchScore,
            revisionNotes: JSON.stringify({
              dnaSuggestions: generated.dnaSuggestions,
              groundingRefs: generated.evidenceCitations,
            }),
          })
        : await this.insertDraft({
            id: randomUUID(),
            opportunityId: opportunity.id,
            requirementId: requirement.id,
            draftText: renderedDraftText,
            wordCount: normalizeText(renderedDraftText).split(/\s+/g).filter(Boolean).length,
            evidenceCitations: JSON.stringify(generated.evidenceCitations),
            unsupportedClaims: JSON.stringify(generated.unsupportedClaims),
            status: generated.status,
            dnaMatchScore: generated.dnaMatchScore,
            revisionNotes: JSON.stringify({
              dnaSuggestions: generated.dnaSuggestions,
              groundingRefs: generated.evidenceCitations,
            }),
          });

      await db
        .update(requirements)
        .set({
          updatedAt: now,
          draftAnswerId: upsertedDraft.id,
        })
        .where(eq(requirements.id, requirement.id));

      draftedCount += 1;
      resultDrafts.push({
        requirementId: requirement.id,
        draftAnswerId: upsertedDraft.id,
        questionText: requirement.questionText,
        requirementType: requirement.requirementType ?? "Narrative Question",
        status: generated.status,
        draftText: renderedDraftText,
        wordCount: normalizeText(renderedDraftText).split(/\s+/g).filter(Boolean).length,
        evidenceCitations: generated.evidenceCitations,
        unsupportedClaims: generated.unsupportedClaims,
        dnaMatchScore: generated.dnaMatchScore,
        dnaSuggestions: generated.dnaSuggestions,
        generationMethod: generated.generationMethod,
        draftPreview: renderedDraftText.slice(0, 200),
      });
    }

    let notionSync: OpportunityDraftingResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncDraftAnswers({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          drafts: resultDrafts.map((draft) => ({
            requirementId: draft.requirementId,
            requirementText: draft.questionText,
            status: draft.status,
            draftText: draft.draftText,
            evidenceCitations: draft.evidenceCitations,
            dnaMatchPercent: draft.dnaMatchScore,
            unsupportedClaims: draft.unsupportedClaims,
            reviewerNotes:
              draft.unsupportedClaims.length > 0
                ? `UNSUPPORTED: ${draft.unsupportedClaims.join("; ")}`
                : draft.dnaSuggestions[0] ?? null,
          })),
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for generated draft answers");
      }
    }

    await this.progressService.record({
      runId,
      agentName: "Narrative Agent",
      actionDescription: "Generated grounded draft answers from analyzed opportunity evidence",
      progressLine: "✅ Draft answers prepared",
      summary: `Prepared ${draftedCount} draft${draftedCount === 1 ? "" : "s"} for ${opportunity.title} and preserved ${preservedCount} approved draft${preservedCount === 1 ? "" : "s"}.`,
      confidenceLevel: round(
        resultDrafts.length === 0
          ? 0
          : resultDrafts.filter((draft) => draft.unsupportedClaims.length === 0).length /
              resultDrafts.length,
        2,
      ),
      followUpRequired: resultDrafts.some((draft) => draft.unsupportedClaims.length > 0),
      opportunityTitle: opportunity.title,
      targetPageId: notionSync?.opportunityPageId,
      syncToNotion: input.syncToNotion,
    });

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      funderId: funder.id,
      funderName: funder.name,
      draftedCount,
      preservedCount,
      drafts: resultDrafts,
      notionSync,
    };
  }

  async update(input: DraftAnswerMutationInput): Promise<DraftAnswerMutationResult> {
    const context = await this.loadDraftMutationContext(input.draftAnswerId);
    const nextDraftText = normalizeText(input.draftText) || context.cleanedDraftText;
    const unsupportedClaims =
      nextDraftText !== context.cleanedDraftText ? [] : context.unsupportedClaims;
    const renderedDraftText = this.composeStoredDraftText(
      nextDraftText,
      unsupportedClaims,
    );
    const alignment = computeGrantDnaAlignment({
      profile: context.grantDnaProfile,
      draftText: renderedDraftText,
    });
    const now = new Date().toISOString();

    const updatedDraft = await this.updateDraft(context.draft.id, {
      updatedAt: now,
      draftText: renderedDraftText,
      wordCount: normalizeText(renderedDraftText).split(/\s+/g).filter(Boolean).length,
      evidenceCitations: JSON.stringify(context.evidenceCitations),
      unsupportedClaims: JSON.stringify(unsupportedClaims),
      status: unsupportedClaims.length > 0 ? "Drafting" : "Needs Review",
      dnaMatchScore: alignment.score,
      revisionNotes: JSON.stringify({
        dnaSuggestions: alignment.suggestions,
        groundingRefs: context.evidenceCitations,
      }),
    });

    await db
      .update(requirements)
      .set({
        updatedAt: now,
        approvalStatus: unsupportedClaims.length > 0 ? "Changes Requested" : "Requested",
      })
      .where(eq(requirements.id, context.requirement.id));

    const notionSync = input.syncToNotion
      ? await this.syncOpportunityDraftsToNotion(context.opportunity.id, context.opportunity.title)
      : undefined;

    return {
      draftAnswerId: updatedDraft.id,
      opportunityId: context.opportunity.id,
      opportunityTitle: context.opportunity.title,
      requirementId: context.requirement.id,
      questionText: context.requirement.questionText,
      status: this.toDraftStatus(updatedDraft.status),
      draftText: updatedDraft.draftText,
      wordCount: updatedDraft.wordCount ?? 0,
      evidenceCitations: context.evidenceCitations,
      unsupportedClaims,
      dnaMatchScore: updatedDraft.dnaMatchScore ?? alignment.score,
      dnaSuggestions: alignment.suggestions,
      notionSync,
    };
  }

  async approve(input: DraftAnswerMutationInput): Promise<DraftAnswerMutationResult> {
    const context = await this.loadDraftMutationContext(input.draftAnswerId);
    if (context.unsupportedClaims.length > 0) {
      throw new Error(
        "This draft still has unsupported sections. Resolve them before approving the answer.",
      );
    }

    const alignment = computeGrantDnaAlignment({
      profile: context.grantDnaProfile,
      draftText: context.draft.draftText,
    });
    const now = new Date().toISOString();

    const updatedDraft = await this.updateDraft(context.draft.id, {
      updatedAt: now,
      draftText: context.draft.draftText,
      wordCount: context.draft.wordCount ?? normalizeText(context.draft.draftText).split(/\s+/g).filter(Boolean).length,
      evidenceCitations: JSON.stringify(context.evidenceCitations),
      unsupportedClaims: JSON.stringify(context.unsupportedClaims),
      status: "Approved",
      dnaMatchScore: alignment.score,
      revisionNotes: JSON.stringify({
        dnaSuggestions: alignment.suggestions,
        groundingRefs: context.evidenceCitations,
      }),
    });

    await db
      .update(requirements)
      .set({
        updatedAt: now,
        approvalStatus: "Approved",
      })
      .where(eq(requirements.id, context.requirement.id));

    const notionSync = input.syncToNotion
      ? await this.syncOpportunityDraftsToNotion(context.opportunity.id, context.opportunity.title)
      : undefined;

    return {
      draftAnswerId: updatedDraft.id,
      opportunityId: context.opportunity.id,
      opportunityTitle: context.opportunity.title,
      requirementId: context.requirement.id,
      questionText: context.requirement.questionText,
      status: "Approved",
      draftText: updatedDraft.draftText,
      wordCount: updatedDraft.wordCount ?? 0,
      evidenceCitations: context.evidenceCitations,
      unsupportedClaims: context.unsupportedClaims,
      dnaMatchScore: updatedDraft.dnaMatchScore ?? alignment.score,
      dnaSuggestions: alignment.suggestions,
      notionSync,
    };
  }

  private async ensureOpportunityAnalyzed(
    opportunityId: string,
    syncToNotion?: boolean,
  ) {
    const requirementRows = await db
      .select()
      .from(requirements)
      .where(eq(requirements.opportunityId, opportunityId));

    const needsAnalysis =
      requirementRows.length === 0 ||
      requirementRows.some(
        (requirement) =>
          !normalizeText(requirement.linkedEvidenceIds) ||
          requirement.coverageStatus === "Missing",
      );

    if (needsAnalysis) {
      await this.analysisService.run({
        opportunityId,
        syncToNotion,
      });
    }
  }

  private async resolveOpportunity(opportunityId: string) {
    const [requestedOpportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!requestedOpportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const relatedOpportunityRows = normalizeText(requestedOpportunity.organizationId)
      ? collectRelatedOpportunityRows(
          await db
            .select()
            .from(opportunities)
            .where(eq(opportunities.organizationId, requestedOpportunity.organizationId!)),
          requestedOpportunity,
        )
      : [requestedOpportunity];

    return selectCanonicalOpportunity(relatedOpportunityRows) ?? requestedOpportunity;
  }

  private async loadDraftMutationContext(draftAnswerId: string) {
    const [draft] = await db
      .select()
      .from(draftAnswers)
      .where(eq(draftAnswers.id, draftAnswerId))
      .limit(1);
    if (!draft) {
      throw new Error("No draft answer exists for the provided draftAnswerId.");
    }

    const [opportunity, requirement] = await Promise.all([
      this.resolveOpportunity(draft.opportunityId),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.id, draft.requirementId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

    if (!requirement) {
      throw new Error("The draft answer references a missing requirement.");
    }

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);
    if (!funder) {
      throw new Error("The draft answer references an opportunity with no funder.");
    }

    const grantDnaProfile = readStoredGrantDnaProfile({
      relationshipHistory: funder.relationshipHistory,
      grantDnaTopTerms: funder.grantDnaTopTerms,
      narrativeStyle: funder.narrativeStyle,
      toneNotes: funder.toneNotes,
    });

    return {
      draft,
      opportunity,
      requirement,
      evidenceCitations: this.parseJsonArray(draft.evidenceCitations),
      unsupportedClaims: this.parseJsonArray(draft.unsupportedClaims),
      cleanedDraftText: this.stripUnsupportedSection(draft.draftText),
      grantDnaProfile,
    };
  }

  private buildSupportSourceMap(input: {
    organization: typeof organizations.$inferSelect;
    programs: Array<typeof programs.$inferSelect>;
    evidence: Array<typeof evidenceLibrary.$inferSelect>;
    documents: Array<typeof documents.$inferSelect>;
    budgets: Array<typeof budgets.$inferSelect>;
  }) {
    const map = new Map<string, DraftSupportSource>();

    const register = (source: DraftSupportSource) => {
      map.set(source.ref, source);
    };

    register({
      ref: `organization:${input.organization.id}`,
      id: input.organization.id,
      type: "organization",
      title: input.organization.legalName,
      text: [
        input.organization.mission,
        input.organization.programSummary,
        input.organization.serviceArea,
      ]
        .filter(Boolean)
        .join(" "),
    });

    for (const program of input.programs) {
      register({
        ref: `program:${program.id}`,
        id: program.id,
        type: "program",
        title: program.name,
        text: [
          program.description,
          program.targetPopulation,
          program.keyOutcomes,
          program.geography,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    for (const evidence of input.evidence) {
      register({
        ref: `evidence:${evidence.id}`,
        id: evidence.id,
        type: "evidence",
        title: evidence.title,
        text: [evidence.content, evidence.sourceDocument, evidence.tags]
          .filter(Boolean)
          .join(" "),
      });
    }

    for (const document of input.documents) {
      register({
        ref: `document:${document.id}`,
        id: document.id,
        type: "document",
        title: document.name,
        text: [document.name, document.documentType, document.uploadStatus]
          .filter(Boolean)
          .join(" "),
      });
    }

    for (const budget of input.budgets) {
      register({
        ref: `budget:${budget.id}`,
        id: budget.id,
        type: "budget",
        title: budget.name,
        text: [
          budget.name,
          budget.budgetType,
          budget.fiscalYear ? `FY${String(budget.fiscalYear).slice(-2)}` : null,
          budget.totalExpense ? `Total expense ${budget.totalExpense}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    return map;
  }

  private composeStoredDraftText(draftText: string, unsupportedClaims: string[]) {
    const base = this.stripUnsupportedSection(draftText);
    return `${base}${renderUnsupportedSection(unsupportedClaims)}`.trim();
  }

  private stripUnsupportedSection(value?: string | null) {
    return normalizeText(value).replace(/\n?\n?UNSUPPORTED:\n[\s\S]*$/i, "").trim();
  }

  private async generateRequirementDraft(input: {
    grantDnaProfile: GrantDnaProfile | null;
    funder: typeof funders.$inferSelect;
    opportunity: typeof opportunities.$inferSelect;
    organization: typeof organizations.$inferSelect;
    requirement: typeof requirements.$inferSelect;
    supportSources: DraftSupportSource[];
  }) {
    const requirementType = input.requirement.requirementType ?? "Narrative Question";
    const kind = inferRequirementKind(requirementType, input.requirement.questionText);

    if (kind !== "narrative") {
      const fallback = this.buildAdministrativeDraft(input.requirement, input.supportSources, kind);
      const alignment = computeGrantDnaAlignment({
        profile: input.grantDnaProfile,
        draftText: fallback.draftText,
      });
      return {
        ...fallback,
        status: fallback.unsupportedClaims.length > 0 ? ("Not Started" as const) : ("Needs Review" as const),
        dnaMatchScore: alignment.score,
        dnaSuggestions: alignment.suggestions,
      };
    }

    if (input.supportSources.length === 0) {
      const placeholder = `Blocked: no grounded evidence is linked to "${input.requirement.questionText}" yet. Add a program, outcome, document, or evidence record, then regenerate drafts.`;
      const alignment = computeGrantDnaAlignment({
        profile: input.grantDnaProfile,
        draftText: placeholder,
      });
      return {
        draftText: placeholder,
        wordCount: placeholder.split(/\s+/g).length,
        evidenceCitations: [],
        unsupportedClaims: ["No matched evidence sources were available for this narrative requirement."],
        dnaMatchScore: alignment.score,
        dnaSuggestions: alignment.suggestions,
        generationMethod: "heuristic" as const,
        status: "Not Started" as const,
      };
    }

    try {
      const generated = await this.generateNarrativeDraftWithGemini(input);
      const alignment = computeGrantDnaAlignment({
        profile: input.grantDnaProfile,
        draftText: generated.draftText,
      });
      return {
        ...generated,
        status: generated.unsupportedClaims.length > 0 ? ("Drafting" as const) : ("Needs Review" as const),
        dnaMatchScore: alignment.score,
        dnaSuggestions: alignment.suggestions,
      };
    } catch (error) {
      this.logger.warn({ error }, "Gemini narrative drafting failed, falling back to heuristic assembly");
      const fallback = this.buildHeuristicNarrativeDraft(input.requirement, input.supportSources);
      const alignment = computeGrantDnaAlignment({
        profile: input.grantDnaProfile,
        draftText: fallback.draftText,
      });
      return {
        ...fallback,
        status: fallback.unsupportedClaims.length > 0 ? ("Drafting" as const) : ("Needs Review" as const),
        dnaMatchScore: alignment.score,
        dnaSuggestions: alignment.suggestions,
      };
    }
  }

  private async generateNarrativeDraftWithGemini(input: {
    funder: typeof funders.$inferSelect;
    opportunity: typeof opportunities.$inferSelect;
    organization: typeof organizations.$inferSelect;
    requirement: typeof requirements.$inferSelect;
    supportSources: DraftSupportSource[];
  }) {
    const prompt = `
You are drafting a nonprofit grant response.
Return only valid JSON.

Your draft must:
- answer the requirement directly
- rely only on the support sources provided below
- not invent numbers, outcomes, partnerships, or claims
- stay grounded in the organization's actual language and evidence
- keep the answer under the word limit when one is provided

Requirement:
${input.requirement.questionText}

Requirement type: ${input.requirement.requirementType ?? "Narrative Question"}
Word limit: ${input.requirement.wordLimit ?? "none"}

Opportunity:
${input.opportunity.title}

Funder:
${input.funder.name}
Giving summary: ${normalizeText(input.funder.givingSummary) || "Not available"}
Grant DNA terms: ${normalizeText(input.funder.grantDnaTopTerms) || "Not available"}

Organization context:
Name: ${input.organization.legalName}
Mission: ${normalizeText(input.organization.mission)}
Program summary: ${normalizeText(input.organization.programSummary)}

Support sources:
${input.supportSources
  .map(
    (source, index) => `${index + 1}. [${source.title}] (${source.type}) ${normalizeText(source.text)}`,
  )
  .join("\n")}

JSON schema:
{
  "draftText": string,
  "evidenceCitations": string[],
  "unsupportedClaims": string[]
}

Rules for evidenceCitations:
- use source titles exactly as provided
- include only sources actually used in the draft

Rules for unsupportedClaims:
- include any statement you wanted to make but could not ground cleanly
- if everything is grounded, return an empty array
`;

    const response = await this.geminiClient.generateStructuredJson<unknown>({
      prompt,
      responseSchema: draftResponseSchema,
      temperature: 0.2,
      maxOutputTokens: 4096,
    });

    const parsed = structuredDraftSchema.parse(response);
    const normalizedDraft = truncateToWordLimit(
      parsed.draftText,
      input.requirement.wordLimit,
    );

    return {
      draftText: normalizedDraft,
      wordCount: normalizeText(normalizedDraft).split(/\s+/g).filter(Boolean).length,
      evidenceCitations: unique(
        parsed.evidenceCitations.filter((citation) =>
          input.supportSources.some((source) => source.title === citation),
        ),
      ),
      unsupportedClaims: unique(parsed.unsupportedClaims.map((claim) => normalizeText(claim)).filter(Boolean)),
      generationMethod: "gemini" as const,
    };
  }

  private buildAdministrativeDraft(
    requirement: typeof requirements.$inferSelect,
    supportSources: DraftSupportSource[],
    kind: RequirementKind,
  ) {
    if (supportSources.length === 0) {
      const draftText =
        kind === "budget"
          ? `Blocked: no linked budget artifact covers "${requirement.questionText}" yet. Add the correct organization or project budget, then regenerate drafts.`
          : kind === "eligibility"
            ? `Blocked: no linked eligibility support covers "${requirement.questionText}" yet. Add the relevant organization, policy, or compliance document, then regenerate drafts.`
            : `Blocked: no linked administrative document covers "${requirement.questionText}" yet. Add the required document to the vault, then regenerate drafts.`;

      return {
        draftText,
        wordCount: draftText.split(/\s+/g).length,
        evidenceCitations: [],
        unsupportedClaims: [
          kind === "budget"
            ? "No matching budget artifact is linked for this requirement."
            : "No matching administrative artifact is linked for this requirement.",
        ],
        generationMethod: "heuristic" as const,
      };
    }

    const citations = unique(supportSources.map((source) => source.title));
    const draftText =
      kind === "budget"
        ? `Ready for human confirmation: use these linked budget artifacts for "${requirement.questionText}": ${citations.join(", ")}.`
        : `Ready for human confirmation: use these linked administrative artifacts for "${requirement.questionText}": ${citations.join(", ")}.`;

    return {
      draftText,
      wordCount: draftText.split(/\s+/g).length,
      evidenceCitations: citations,
      unsupportedClaims: [],
      generationMethod: "heuristic" as const,
    };
  }

  private buildHeuristicNarrativeDraft(
    requirement: typeof requirements.$inferSelect,
    supportSources: DraftSupportSource[],
  ) {
    const question = requirement.questionText.toLowerCase();
    const sourcePool = supportSources.filter((source) =>
      source.type === "organization" || source.type === "program" || source.type === "evidence",
    );

    const prioritized = [...sourcePool].sort((left, right) => {
      const leftScore =
        (question.includes("family") && left.text.toLowerCase().includes("family") ? 3 : 0) +
        (question.includes("outcome") && left.text.toLowerCase().includes("outcome") ? 3 : 0) +
        (question.includes("track") && left.text.toLowerCase().includes("survey") ? 2 : 0) +
        (left.type === "evidence" ? 2 : left.type === "program" ? 1 : 0);
      const rightScore =
        (question.includes("family") && right.text.toLowerCase().includes("family") ? 3 : 0) +
        (question.includes("outcome") && right.text.toLowerCase().includes("outcome") ? 3 : 0) +
        (question.includes("track") && right.text.toLowerCase().includes("survey") ? 2 : 0) +
        (right.type === "evidence" ? 2 : right.type === "program" ? 1 : 0);
      return rightScore - leftScore;
    });

    const selected = unique(prioritized.map((source) => source.ref))
      .map((ref) => supportSources.find((source) => source.ref === ref))
      .filter((source): source is DraftSupportSource => Boolean(source))
      .slice(0, 3);

    const sentences = unique(
      selected
        .map((source) => firstSentence(source.text))
        .filter(Boolean),
    );

    const draftText = truncateToWordLimit(
      sentences.length > 0
        ? sentences.join(" ")
        : "A grounded narrative draft is not ready yet because the linked support sources were too thin to assemble a safe answer.",
      requirement.wordLimit,
    );

    return {
      draftText,
      wordCount: normalizeText(draftText).split(/\s+/g).filter(Boolean).length,
      evidenceCitations: selected.map((source) => source.title),
      unsupportedClaims:
        sentences.length > 0 ? [] : ["The linked sources were too thin to assemble a grounded narrative draft."],
      generationMethod: "heuristic" as const,
    };
  }

  private parseJsonArray(value?: string | null) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed)
        ? parsed.map((item) => normalizeText(String(item))).filter(Boolean)
        : [];
    } catch {
      return parseSupportRefs(normalized);
    }
  }

  private parseDnaSuggestions(value?: string | null) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized) as { dnaSuggestions?: unknown };
      return Array.isArray(parsed.dnaSuggestions)
        ? parsed.dnaSuggestions.map((item) => normalizeText(String(item))).filter(Boolean)
        : null;
    } catch {
      return null;
    }
  }

  private async syncOpportunityDraftsToNotion(
    opportunityId: string,
    opportunityTitle: string,
  ) {
    if (!this.notionClient) {
      return undefined;
    }

    const draftRows = await db
      .select()
      .from(draftAnswers)
      .where(eq(draftAnswers.opportunityId, opportunityId));
    const requirementRows = await db
      .select()
      .from(requirements)
      .where(eq(requirements.opportunityId, opportunityId));
    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));

    return this.notionClient.syncDraftAnswers({
      opportunityId,
      opportunityTitle,
      drafts: draftRows.map((draft) => ({
        requirementId: draft.requirementId,
        requirementText: requirementById.get(draft.requirementId)?.questionText ?? "Requirement",
        status: this.toDraftStatus(draft.status),
        draftText: draft.draftText,
        evidenceCitations: this.parseJsonArray(draft.evidenceCitations),
        dnaMatchPercent: draft.dnaMatchScore ?? 0,
        unsupportedClaims: this.parseJsonArray(draft.unsupportedClaims),
        reviewerNotes: draft.reviewerComments,
      })),
    });
  }

  private async updateDraft(
    draftId: string,
    values: {
      updatedAt: string;
      draftText: string;
      wordCount: number;
      evidenceCitations: string;
      unsupportedClaims: string;
      status: DraftStatus;
      dnaMatchScore: number;
      revisionNotes: string;
    },
  ) {
    await db.update(draftAnswers).set(values).where(eq(draftAnswers.id, draftId));
    const [updated] = await db
      .select()
      .from(draftAnswers)
      .where(eq(draftAnswers.id, draftId))
      .limit(1);

    if (!updated) {
      throw new Error("Expected to find updated draft answer row.");
    }

    return updated;
  }

  private async insertDraft(values: {
    id: string;
    opportunityId: string;
    requirementId: string;
    draftText: string;
    wordCount: number;
      evidenceCitations: string;
      unsupportedClaims: string;
      status: DraftStatus;
      dnaMatchScore: number;
      revisionNotes: string;
    }) {
    await db.insert(draftAnswers).values(values);
    const [created] = await db
      .select()
      .from(draftAnswers)
      .where(eq(draftAnswers.id, values.id))
      .limit(1);

    if (!created) {
      throw new Error("Expected to find inserted draft answer row.");
    }

    return created;
  }

  private toDraftStatus(value: string): DraftStatus {
    if (value === "Approved") {
      return "Approved";
    }
    if (value === "Needs Review") {
      return "Needs Review";
    }
    if (value === "Drafting") {
      return "Drafting";
    }
    return "Not Started";
  }
}
