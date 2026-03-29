import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  budgets,
  documents,
  evidenceLibrary,
  funderFilings,
  funderGrantRows,
  funders,
  opportunities,
  organizations,
  programs,
  requirements,
  tasks,
} from "../../db/schema.js";
import { AgentProgressService } from "../agent-progress/service.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import {
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "./opportunity-identity.js";
import { normalizeRequirementEntries } from "./requirement-normalization.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type RequirementCoverageStatus = "Green" | "Amber" | "Red";
type RequirementRiskLevel = "Low" | "Medium" | "High";
type PursueDecision = "Pursue Now" | "Revisit Later" | "Skip";
type SupportSourceType = "organization" | "program" | "evidence" | "document" | "budget";
type SupportTheme =
  | "program"
  | "outcomes"
  | "family"
  | "literacy"
  | "budget"
  | "eligibility"
  | "geography";

type SupportSource = {
  id: string;
  type: SupportSourceType;
  title: string;
  text: string;
  tokens: Set<string>;
  themes: Set<SupportTheme>;
  reliability: number;
};

type RequirementAnalysisRecord = {
  requirementId: string;
  questionText: string;
  requirementType: string;
  coverageStatus: RequirementCoverageStatus;
  riskLevel: RequirementRiskLevel;
  linkedSourceIds: string[];
  matchedSources: Array<{
    id: string;
    type: SupportSourceType;
    title: string;
    score: number;
    detail: string;
  }>;
  note: string;
};

type LoadedAnalysisContext = {
  opportunity: typeof opportunities.$inferSelect;
  funder: typeof funders.$inferSelect;
  organization: typeof organizations.$inferSelect;
  requirementRows: Array<typeof requirements.$inferSelect>;
  programRows: Array<typeof programs.$inferSelect>;
  evidenceRows: Array<typeof evidenceLibrary.$inferSelect>;
  documentRows: Array<typeof documents.$inferSelect>;
  budgetRows: Array<typeof budgets.$inferSelect>;
  filingRows: Array<typeof funderFilings.$inferSelect>;
  grantRows: Array<typeof funderGrantRows.$inferSelect>;
  sourceSummary: string | null;
};

type ComputedAnalysisState = {
  scoring: OpportunityAnalysisResult["scoring"];
  coverageBreakdown: OpportunityAnalysisResult["coverageBreakdown"];
  requirementAnalyses: RequirementAnalysisRecord[];
  rationale: string;
};

export type OpportunityAnalysisInput = {
  opportunityId: string;
  syncToNotion?: boolean;
};

export type OpportunityAnalysisResult = {
  opportunityId: string;
  opportunityTitle: string;
  funderId: string;
  funderName: string;
  scoring: {
    fitScore: number;
    pursueDecision: PursueDecision;
    evidenceCoveragePercent: number;
    effortEstimateHours: number;
    priorityScore: number;
    deadlineProximityScore: number;
    effortScore: number;
    capacityFlag: string;
    reportingBurdenScore: number;
    componentScores: {
      missionAlignment: number;
      geographyMatch: number;
      programFit: number;
      evidenceCoverage: number;
      deadlineFeasibility: number;
      grantSizeFit: number;
      smallOrgFriendly: number;
      reportingBurden: number;
    };
  };
  coverageBreakdown: {
    green: number;
    amber: number;
    red: number;
  };
  requirementAnalyses: RequirementAnalysisRecord[];
  rationale: string;
  notionSync?: {
    opportunityPageId: string;
    requirementPageIds: string[];
    taskPageIds: string[];
  };
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "this",
  "to",
  "what",
  "when",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

const THEME_KEYWORDS: Array<{ theme: SupportTheme; keywords: string[] }> = [
  {
    theme: "program",
    keywords: [
      "program",
      "service",
      "services",
      "model",
      "approach",
      "participant",
      "participants",
      "student",
      "students",
      "youth",
      "serve",
      "serves",
      "population",
      "mentor",
      "mentoring",
    ],
  },
  {
    theme: "outcomes",
    keywords: [
      "outcome",
      "outcomes",
      "impact",
      "result",
      "results",
      "metric",
      "metrics",
      "measure",
      "measures",
      "track",
      "tracking",
      "evaluation",
      "assess",
      "assessment",
      "progress",
      "growth",
    ],
  },
  {
    theme: "family",
    keywords: [
      "family",
      "families",
      "caregiver",
      "caregivers",
      "parent",
      "parents",
      "guardian",
      "guardians",
      "home",
    ],
  },
  {
    theme: "literacy",
    keywords: ["literacy", "reading", "reader", "readers", "books"],
  },
  {
    theme: "budget",
    keywords: ["budget", "financial", "expense", "expenses", "revenue", "cost", "costs"],
  },
  {
    theme: "eligibility",
    keywords: [
      "eligibility",
      "eligible",
      "501c3",
      "501(c)(3)",
      "determination",
      "letter",
      "irs",
      "audit",
      "board",
      "roster",
    ],
  },
  {
    theme: "geography",
    keywords: ["georgia", "atlanta", "county", "southeast", "national", "statewide"],
  },
];

const TOKEN_SYNONYMS: Record<string, string[]> = {
  caregiver: ["caregivers", "family", "families", "parent", "parents"],
  family: ["families", "caregiver", "caregivers", "parent", "parents"],
  literacy: ["reading"],
  reading: ["literacy"],
  outcome: ["outcomes", "metric", "metrics", "evaluation", "impact", "results"],
  outcomes: ["outcome", "metric", "metrics", "evaluation", "impact", "results"],
  budget: ["financial", "cost", "expenses"],
  student: ["students", "youth"],
  students: ["student", "youth"],
  mentoring: ["mentor"],
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const canonicalizeToken = (token: string) => {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) {
    return "";
  }

  normalized = normalized
    .replace(/^fy(\d{2})$/, "fiscalyear$1")
    .replace(/ies$/, "y")
    .replace(/ings$/, "ing");

  if (normalized.endsWith("es") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("s") && normalized.length > 3) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
};

const tokenize = (value?: string | null) => {
  const tokens = new Set<string>();
  for (const part of normalizeText(value).split(/[^a-zA-Z0-9()]+/g)) {
    const normalized = canonicalizeToken(part);
    if (!normalized || STOPWORDS.has(normalized) || normalized.length < 2) {
      continue;
    }

    tokens.add(normalized);
    for (const synonym of TOKEN_SYNONYMS[normalized] ?? []) {
      tokens.add(canonicalizeToken(synonym));
    }
  }

  return tokens;
};

const detectThemes = (value?: string | null) => {
  const normalized = normalizeText(value).toLowerCase();
  const themes = new Set<SupportTheme>();

  for (const rule of THEME_KEYWORDS) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      themes.add(rule.theme);
    }
  }

  return themes;
};

const setIntersectionSize = (left: Set<string>, right: Set<string>) => {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
};

const estimateRiskLevel = (coverageStatus: RequirementCoverageStatus): RequirementRiskLevel => {
  switch (coverageStatus) {
    case "Green":
      return "Low";
    case "Amber":
      return "Medium";
    default:
      return "High";
  }
};

const toRequirementKind = (requirementType: string, questionText: string) => {
  const normalizedType = requirementType.trim().toLowerCase();
  const normalizedText = questionText.toLowerCase();

  if (normalizedType.includes("budget") || normalizedText.includes("budget")) {
    return "budget";
  }

  if (
    normalizedType.includes("document") ||
    normalizedText.includes("required document") ||
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

const toSourceRef = (type: SupportSourceType, id: string) => `${type}:${id}`;

const summarizeSources = (
  sources: Array<{ title: string; type: SupportSourceType; score: number }>,
) => {
  if (sources.length === 0) {
    return "No strong local support source was matched automatically.";
  }

  return sources
    .map((source) => `${source.title} (${source.type}, ${round(source.score * 100, 0)}%)`)
    .join("; ");
};

const summarizeSourceDetail = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "No supporting detail was stored for this source yet.";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}...` : normalized;
};

const parseCommaSeparated = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const formatCurrency = (value?: number | null) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : null;

const extractOpportunitySummary = (value?: string | null) => {
  let normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  while (normalized.startsWith("Opportunity summary:")) {
    normalized = normalized.replace(/^Opportunity summary:\s*/i, "");
  }

  if (normalized.includes(" Fit score is ")) {
    return normalized.slice(0, normalized.indexOf(" Fit score is ")).trim() || null;
  }

  return normalized;
};

export class OpportunityAnalysisService {
  private readonly logger: LoggerLike;
  private readonly progressService: AgentProgressService;

  constructor(
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

  async run(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult> {
    const runId = randomUUID();
    const context = await this.loadContext(input.opportunityId);
    const { opportunity, funder } = context;

    this.logger.info(
      {
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        funderId: funder.id,
        requirementCount: context.requirementRows.length,
      },
      "Opportunity analysis started",
    );

    await this.progressService.record({
      runId,
      agentName: "Evidence Agent",
      actionDescription: "Started opportunity analysis",
      progressLine: "⏳ Analyzing fit and evidence coverage",
      summary: `Reviewing ${opportunity.title} against existing evidence, documents, and program context.`,
      opportunityTitle: opportunity.title,
      followUpRequired: false,
      syncToNotion: input.syncToNotion,
    });

    const computed = this.computeAnalysisState(context);
    const {
      scoring: {
        fitScore,
        pursueDecision,
        evidenceCoveragePercent,
        effortEstimateHours,
        priorityScore,
        deadlineProximityScore,
        effortScore,
        capacityFlag,
        reportingBurdenScore,
        componentScores,
      },
      coverageBreakdown,
      requirementAnalyses,
      rationale,
    } = computed;
    const greenCount = coverageBreakdown.green;
    const amberCount = coverageBreakdown.amber;
    const redCount = coverageBreakdown.red;

    const now = new Date().toISOString();
    const existingTaskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.opportunityId, opportunity.id));

    await db.update(opportunities).set({
      updatedAt: now,
      status:
        normalizeText(opportunity.status) === "researching" ? "Analyzed" : opportunity.status,
      fitScore,
      pursueDecision,
      rationale,
      evidenceCoveragePercent,
      effortEstimateHours,
      capacityFlag,
      reportingBurdenScore,
    }).where(eq(opportunities.id, opportunity.id));

    for (const requirementAnalysis of requirementAnalyses) {
      await db
        .update(requirements)
        .set({
          updatedAt: now,
          coverageStatus: requirementAnalysis.coverageStatus,
          linkedEvidenceIds: requirementAnalysis.linkedSourceIds.join(",") || null,
          reviewerNotes: requirementAnalysis.note,
        })
        .where(eq(requirements.id, requirementAnalysis.requirementId));
    }

    await this.syncEvidenceGapTasks({
      opportunity,
      now,
      requirementAnalyses,
      existingTaskRows,
    });

    const syncedTaskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.opportunityId, opportunity.id));

    let notionSync: OpportunityAnalysisResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncOpportunityAnalysis({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          funderName: funder.name,
          status: opportunity.status,
          deadline: opportunity.deadline,
          submissionPlatform: opportunity.submissionMethod,
          sourceUrl: opportunity.sourceUrl,
          portalUrl: opportunity.portalUrl,
          fitScorePercent: fitScore,
          pursueDecision,
          evidenceCoveragePercent,
          effortHours: effortEstimateHours,
          reportingBurdenScore: computed.scoring.reportingBurdenScore,
          priorityScore: computed.scoring.priorityScore,
          nextBestAction:
            pursueDecision === "Pursue Now"
              ? "Run evidence mapping and begin drafting"
              : pursueDecision === "Revisit Later"
                ? "Close evidence gaps before moving into full drafting"
                : "Skip for now and focus on stronger-fit opportunities",
          tasks: syncedTaskRows
            .filter((task) => normalizeText(task.description).startsWith("Evidence gap:"))
            .map((task) => ({
              title: task.description,
              priority: toNotionTaskPriority(task.priority),
              status: toNotionTaskStatus(task.status),
              dueDate: task.dueDate ?? null,
              assignee: task.assignee ?? null,
              blocking: Boolean(task.blockingDependency),
            })),
          requirements: requirementAnalyses.map((record) => ({
            questionText: record.questionText,
            required: true,
            coverageStatus: record.coverageStatus,
            riskLevel: record.riskLevel,
            note: record.note,
            riskFlag: record.note,
          })),
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for opportunity analysis");
      }
    }

    await this.progressService.record({
      runId,
      agentName: "Evidence Agent",
      actionDescription: "Mapped opportunity requirements to existing evidence and operating context",
      progressLine: "✅ Evidence mapped to requirements",
      summary: `Matched ${requirementAnalyses.length} requirement${requirementAnalyses.length === 1 ? "" : "s"} with ${greenCount} green, ${amberCount} amber, and ${redCount} red coverage result${requirementAnalyses.length === 1 ? "" : "s"}.`,
      confidenceLevel: round((greenCount + amberCount * 0.6) / requirementAnalyses.length, 2),
      followUpRequired: redCount > 0,
      opportunityTitle: opportunity.title,
      targetPageId: notionSync?.opportunityPageId,
      syncToNotion: input.syncToNotion,
    });

    await this.progressService.record({
      runId,
      agentName: "Fit Agent",
      actionDescription: "Calculated grant fit score, pursue recommendation, and effort estimate",
      progressLine: "✅ Fit score calculated",
      summary: `Scored ${opportunity.title} at ${fitScore}% and recommended '${pursueDecision}' with about ${effortEstimateHours} hour${effortEstimateHours === 1 ? "" : "s"} of work.`,
      confidenceLevel: round(fitScore / 100, 2),
      followUpRequired: pursueDecision !== "Pursue Now",
      opportunityTitle: opportunity.title,
      targetPageId: notionSync?.opportunityPageId,
      syncToNotion: input.syncToNotion,
    });

    this.logger.info(
      {
        opportunityId: opportunity.id,
        fitScore,
        pursueDecision,
        evidenceCoveragePercent,
        greenCount,
        amberCount,
        redCount,
      },
      "Opportunity analysis completed",
    );

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      funderId: funder.id,
      funderName: funder.name,
      scoring: computed.scoring,
      coverageBreakdown: computed.coverageBreakdown,
      requirementAnalyses,
      rationale,
      notionSync,
    };
  }

  async inspect(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult> {
    const context = await this.loadContext(input.opportunityId);
    const computed = this.computeAnalysisState(context);

    return {
      opportunityId: context.opportunity.id,
      opportunityTitle: context.opportunity.title,
      funderId: context.funder.id,
      funderName: context.funder.name,
      scoring: computed.scoring,
      coverageBreakdown: computed.coverageBreakdown,
      requirementAnalyses: computed.requirementAnalyses,
      rationale: computed.rationale,
    };
  }

  private async loadContext(opportunityId: string): Promise<LoadedAnalysisContext> {
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
    const opportunity =
      selectCanonicalOpportunity(relatedOpportunityRows) ?? requestedOpportunity;

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);

    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }

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
      programRows,
      allEvidenceRows,
      allDocumentRows,
      allBudgetRows,
      filingRows,
      grantRows,
    ] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(programs).where(eq(programs.organizationId, organization.id)),
      db.select().from(evidenceLibrary),
      db.select().from(documents),
      db.select().from(budgets),
      db.select().from(funderFilings).where(eq(funderFilings.funderId, funder.id)),
      db.select().from(funderGrantRows).where(eq(funderGrantRows.funderId, funder.id)),
    ]);

    const requirementRows = await this.normalizeStoredRequirements(
      opportunity.id,
      rawRequirementRows,
    );

    if (requirementRows.length === 0) {
      throw new Error("This opportunity has no requirement records to analyze.");
    }

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

    return {
      opportunity,
      funder,
      organization,
      requirementRows,
      programRows,
      evidenceRows,
      documentRows,
      budgetRows,
      filingRows,
      grantRows,
      sourceSummary: extractOpportunitySummary(opportunity.rationale),
    };
  }

  private async normalizeStoredRequirements(
    opportunityId: string,
    requirementRows: Array<typeof requirements.$inferSelect>,
  ) {
    if (requirementRows.length === 0) {
      return requirementRows;
    }

    const normalized = normalizeRequirementEntries(
      requirementRows.map((row) => ({
        id: row.id,
        questionText: row.questionText,
        requirementType: row.requirementType,
        wordLimit: row.wordLimit,
      })),
    );

    const rowsById = new Map(requirementRows.map((row) => [row.id, row]));
    const now = new Date().toISOString();
    const retainedIds = new Set<string>();

    for (let index = 0; index < normalized.length; index += 1) {
      const entry = normalized[index];
      if (!entry) {
        continue;
      }

      const primaryId =
        entry.sourceIds.find((id) => rowsById.has(id)) ?? requirementRows[index]?.id;

      if (!primaryId) {
        continue;
      }

      retainedIds.add(primaryId);
      const existing = rowsById.get(primaryId);

      if (
        existing &&
        (existing.questionText !== entry.questionText ||
          existing.requirementType !== (entry.requirementType ?? existing.requirementType) ||
          existing.wordLimit !== (entry.wordLimit ?? null))
      ) {
        await db
          .update(requirements)
          .set({
            updatedAt: now,
            questionText: entry.questionText,
            requirementType: entry.requirementType ?? existing.requirementType,
            wordLimit: entry.wordLimit ?? null,
          })
          .where(eq(requirements.id, primaryId));
      }
    }

    const deleteIds = requirementRows
      .filter((row) => !retainedIds.has(row.id) && !row.draftAnswerId)
      .map((row) => row.id);

    if (deleteIds.length > 0) {
      await db.delete(requirements).where(inArray(requirements.id, deleteIds));
    }

    const refreshedRows = await db
      .select()
      .from(requirements)
      .where(eq(requirements.opportunityId, opportunityId));

    return refreshedRows.filter((row) => retainedIds.has(row.id));
  }

  private computeAnalysisState(context: LoadedAnalysisContext): ComputedAnalysisState {
    const supportSources = this.buildSupportSources({
      organization: context.organization,
      programs: context.programRows,
      evidence: context.evidenceRows,
      documents: context.documentRows,
      budgets: context.budgetRows,
    });

    const requirementAnalyses = context.requirementRows.map((requirement) =>
      this.analyzeRequirement({
        requirement,
        supportSources,
        documents: context.documentRows,
        budgets: context.budgetRows,
      }),
    );

    const greenCount = requirementAnalyses.filter((record) => record.coverageStatus === "Green").length;
    const amberCount = requirementAnalyses.filter((record) => record.coverageStatus === "Amber").length;
    const redCount = requirementAnalyses.filter((record) => record.coverageStatus === "Red").length;

    const evidenceCoveragePercent =
      requirementAnalyses.length === 0
        ? 0
        : round(((greenCount + amberCount) / requirementAnalyses.length) * 100);

    const reportingBurdenScore = this.estimateReportingBurden({
      requirementAnalyses,
    });

    const effortEstimateHours = this.estimateEffortHours({
      requirementAnalyses,
      deadline: context.opportunity.deadline,
    });

    const componentScores = this.computeOpportunityComponentScores({
      opportunity: context.opportunity,
      sourceSummary: context.sourceSummary,
      requirements: context.requirementRows,
      funder: context.funder,
      organization: context.organization,
      programs: context.programRows,
      grantRows: context.grantRows,
      filingRows: context.filingRows,
      evidenceCoveragePercent,
      reportingBurdenScore,
    });

    const fitScore = round(
      componentScores.missionAlignment * 0.2 +
        componentScores.programFit * 0.16 +
        componentScores.geographyMatch * 0.1 +
        componentScores.evidenceCoverage * 0.3 +
        componentScores.deadlineFeasibility * 0.1 +
        componentScores.grantSizeFit * 0.06 +
        componentScores.smallOrgFriendly * 0.04 +
        (100 - componentScores.reportingBurden) * 0.04,
    );

    const pursueDecision = this.derivePursueDecision({
      fitScore,
      evidenceCoveragePercent,
      deadline: context.opportunity.deadline,
      redCount,
      effortEstimateHours,
    });

    const capacityFlag = this.deriveCapacityFlag({
      effortEstimateHours,
      deadline: context.opportunity.deadline,
    });
    const deadlineProximityScore = componentScores.deadlineFeasibility;
    const effortScore = effortEstimateHours;
    const priorityScore = round(
      fitScore * 0.4 +
        evidenceCoveragePercent * 0.3 +
        deadlineProximityScore * 0.2 -
        effortScore * 0.1,
    );

    const rationale = this.buildOpportunityRationale({
      existingSummary: context.sourceSummary,
      funder: context.funder,
      fitScore,
      pursueDecision,
      evidenceCoveragePercent,
      componentScores,
      requirementAnalyses,
    });

    return {
      scoring: {
        fitScore,
        pursueDecision,
        evidenceCoveragePercent,
        effortEstimateHours,
        priorityScore,
        deadlineProximityScore,
        effortScore,
        capacityFlag,
        reportingBurdenScore,
        componentScores,
      },
      coverageBreakdown: {
        green: greenCount,
        amber: amberCount,
        red: redCount,
      },
      requirementAnalyses,
      rationale,
    };
  }

  private buildSupportSources(input: {
    organization: typeof organizations.$inferSelect;
    programs: Array<typeof programs.$inferSelect>;
    evidence: Array<typeof evidenceLibrary.$inferSelect>;
    documents: Array<typeof documents.$inferSelect>;
    budgets: Array<typeof budgets.$inferSelect>;
  }) {
    const sources: SupportSource[] = [];

    sources.push({
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
      tokens: tokenize(
        [
          input.organization.legalName,
          input.organization.mission,
          input.organization.programSummary,
          input.organization.serviceArea,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      themes: detectThemes(
        [
          input.organization.mission,
          input.organization.programSummary,
          input.organization.serviceArea,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      reliability: 0.95,
    });

    for (const program of input.programs) {
      const text = [
        program.name,
        program.description,
        program.targetPopulation,
        program.geography,
        program.keyOutcomes,
      ]
        .filter(Boolean)
        .join(" ");

      sources.push({
        id: program.id,
        type: "program",
        title: program.name,
        text,
        tokens: tokenize(text),
        themes: detectThemes(text),
        reliability: 0.9,
      });
    }

    for (const evidence of input.evidence) {
      const text = [
        evidence.title,
        evidence.content,
        evidence.sourceDocument,
        evidence.tags,
      ]
        .filter(Boolean)
        .join(" ");

      sources.push({
        id: evidence.id,
        type: "evidence",
        title: evidence.title,
        text,
        tokens: tokenize(text),
        themes: detectThemes(text),
        reliability: evidence.reliabilityRating ?? 0.7,
      });
    }

    for (const document of input.documents) {
      const text = [document.name, document.documentType, document.owner].filter(Boolean).join(" ");
      sources.push({
        id: document.id,
        type: "document",
        title: document.name,
        text,
        tokens: tokenize(text),
        themes: new Set<SupportTheme>([
          ...detectThemes(text),
          ...(document.documentType?.toLowerCase().includes("budget") ? (["budget"] as const) : []),
          ...(document.documentType?.toLowerCase().includes("501") ||
          document.documentType?.toLowerCase().includes("board")
            ? (["eligibility"] as const)
            : []),
        ]),
        reliability: document.uploadStatus === "Ready" ? 0.9 : 0.55,
      });
    }

    for (const budget of input.budgets) {
      const text = [
        budget.name,
        budget.budgetType,
        budget.fiscalYear ? String(budget.fiscalYear) : null,
        budget.totalExpense ? String(budget.totalExpense) : null,
      ]
        .filter(Boolean)
        .join(" ");
      sources.push({
        id: budget.id,
        type: "budget",
        title: budget.name,
        text,
        tokens: tokenize(text),
        themes: new Set<SupportTheme>(["budget"]),
        reliability: 0.88,
      });
    }

    return sources;
  }

  private async syncEvidenceGapTasks(input: {
    opportunity: typeof opportunities.$inferSelect;
    now: string;
    requirementAnalyses: RequirementAnalysisRecord[];
    existingTaskRows: Array<typeof tasks.$inferSelect>;
  }) {
    const existingGapTasks = input.existingTaskRows.filter((task) =>
      normalizeText(task.description).startsWith("Evidence gap:"),
    );
    const existingTaskByRequirementId = new Map(
      existingGapTasks
        .filter((task) => Boolean(task.requirementId))
        .map((task) => [task.requirementId!, task]),
    );

    for (const requirementAnalysis of input.requirementAnalyses) {
      const existingTask = existingTaskByRequirementId.get(requirementAnalysis.requirementId);

      if (requirementAnalysis.coverageStatus === "Green") {
        if (existingTask && existingTask.status !== "Done") {
          await db
            .update(tasks)
            .set({
              updatedAt: input.now,
              status: "Done",
              description: `Evidence gap: resolved for ${requirementAnalysis.questionText}`,
            })
            .where(eq(tasks.id, existingTask.id));
        }
        continue;
      }

      const description =
        requirementAnalysis.coverageStatus === "Amber"
          ? `Evidence gap: strengthen support for ${requirementAnalysis.questionText}`
          : `Evidence gap: collect evidence for ${requirementAnalysis.questionText}`;
      const priority = requirementAnalysis.coverageStatus === "Amber" ? "Medium" : "High";

      const taskValues = {
        updatedAt: input.now,
        description,
        priority,
        assignee: input.opportunity.owner ?? null,
        dueDate: input.opportunity.deadline ?? null,
        status: "To Do",
        blockingDependency: null,
      } as const;

      if (existingTask) {
        await db.update(tasks).set(taskValues).where(eq(tasks.id, existingTask.id));
        continue;
      }

      await db.insert(tasks).values({
        id: randomUUID(),
        createdAt: input.now,
        ...taskValues,
        opportunityId: input.opportunity.id,
        requirementId: requirementAnalysis.requirementId,
      });
    }
  }

  private analyzeRequirement(input: {
    requirement: typeof requirements.$inferSelect;
    supportSources: SupportSource[];
    documents: Array<typeof documents.$inferSelect>;
    budgets: Array<typeof budgets.$inferSelect>;
  }): RequirementAnalysisRecord {
    const requirementType = input.requirement.requirementType ?? "Narrative Question";
    const kind = toRequirementKind(requirementType, input.requirement.questionText);

    if (kind === "document" || kind === "eligibility") {
      return this.analyzeDocumentRequirement(input.requirement, input.documents);
    }

    if (kind === "budget") {
      return this.analyzeBudgetRequirement(input.requirement, input.documents, input.budgets);
    }

    return this.analyzeNarrativeRequirement(input.requirement, input.supportSources);
  }

  private analyzeNarrativeRequirement(
    requirement: typeof requirements.$inferSelect,
    supportSources: SupportSource[],
  ): RequirementAnalysisRecord {
    const queryText = requirement.questionText;
    const queryTokens = tokenize(queryText);
    const queryThemes = detectThemes(queryText);
    const scoredSources = supportSources
      .filter((source) => source.type !== "document" && source.type !== "budget")
      .map((source) => ({
        source,
        score: this.scoreSupportSource(queryTokens, queryThemes, source),
      }))
      .filter((entry) => entry.score >= 0.12)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    const strongest = scoredSources[0];
    const secondStrongest = scoredSources[1];

    let coverageStatus: RequirementCoverageStatus = "Red";
    if (
      scoredSources.length >= 2 &&
      strongest &&
      secondStrongest &&
      strongest.score >= 0.24 &&
      secondStrongest.score >= 0.18
    ) {
      coverageStatus = "Green";
    } else if (strongest && strongest.score >= 0.4) {
      coverageStatus = "Green";
    } else if (strongest && strongest.score >= 0.17) {
      coverageStatus = "Amber";
    }

    const matchedSources = scoredSources.map((entry) => ({
      id: entry.source.id,
      type: entry.source.type,
      title: entry.source.title,
      score: round(entry.score, 2),
      detail: summarizeSourceDetail(entry.source.text),
    }));

    const notePrefix =
      coverageStatus === "Green"
        ? "Strong support found."
        : coverageStatus === "Amber"
          ? "Partial support found. A task will be created to strengthen this answer."
          : "Coverage gap detected. A task will be created to fill this gap.";

    return {
      requirementId: requirement.id,
      questionText: requirement.questionText,
      requirementType: requirement.requirementType ?? "Narrative Question",
      coverageStatus,
      riskLevel: estimateRiskLevel(coverageStatus),
      linkedSourceIds: matchedSources.map((source) => toSourceRef(source.type, source.id)),
      matchedSources,
      note: `${notePrefix} ${summarizeSources(matchedSources)}`,
    };
  }

  private analyzeDocumentRequirement(
    requirement: typeof requirements.$inferSelect,
    documentRows: Array<typeof documents.$inferSelect>,
  ): RequirementAnalysisRecord {
    const normalized = requirement.questionText.toLowerCase();
    const matches = documentRows.filter((document) => {
      const haystack = `${document.name} ${document.documentType}`.toLowerCase();
      if (normalized.includes("501(c)(3)") || normalized.includes("determination")) {
        return haystack.includes("501");
      }

      if (normalized.includes("board")) {
        return haystack.includes("board");
      }

      if (normalized.includes("audit")) {
        return haystack.includes("audit");
      }

      if (normalized.includes("policy")) {
        return haystack.includes("policy");
      }

      return haystack.includes("document");
    });

    const readyMatches = matches.filter((document) => document.uploadStatus === "Ready");
    const coverageStatus: RequirementCoverageStatus =
      readyMatches.length > 0 ? "Green" : matches.length > 0 ? "Amber" : "Red";

    const matchedSources = (readyMatches.length > 0 ? readyMatches : matches).map((document) => ({
      id: document.id,
      type: "document" as const,
      title: document.name,
      score: document.uploadStatus === "Ready" ? 0.95 : 0.6,
      detail: summarizeSourceDetail(
        [document.name, document.documentType, document.owner].filter(Boolean).join(" "),
      ),
    }));

    return {
      requirementId: requirement.id,
      questionText: requirement.questionText,
      requirementType: requirement.requirementType ?? "Document",
      coverageStatus,
      riskLevel: estimateRiskLevel(coverageStatus),
      linkedSourceIds: matchedSources.map((source) => toSourceRef(source.type, source.id)),
      matchedSources,
      note:
        coverageStatus === "Red"
          ? "No matching document record was found locally. A task will be created to fill this gap."
          : coverageStatus === "Amber"
            ? `Matched document support: ${summarizeSources(matchedSources)} A task will be created to strengthen this answer.`
            : `Matched document support: ${summarizeSources(matchedSources)}`,
    };
  }

  private analyzeBudgetRequirement(
    requirement: typeof requirements.$inferSelect,
    documentRows: Array<typeof documents.$inferSelect>,
    budgetRows: Array<typeof budgets.$inferSelect>,
  ): RequirementAnalysisRecord {
    const normalized = requirement.questionText.toLowerCase();
    const yearMatch = normalized.match(/fy(\d{2})|20\d{2}/i);
    const expectedYear = yearMatch?.[0]?.toLowerCase().startsWith("fy")
      ? 2000 + Number(yearMatch[0].slice(2))
      : yearMatch?.[0]
        ? Number(yearMatch[0])
        : null;

    const matchedBudgetRows = budgetRows.filter((budget) => {
      if (!expectedYear) {
        return true;
      }
      return budget.fiscalYear === expectedYear;
    });

    const matchedBudgetDocs = documentRows.filter((document) => {
      if (!document.documentType?.toLowerCase().includes("budget")) {
        return false;
      }
      if (!expectedYear) {
        return true;
      }
      return document.name.toLowerCase().includes(String(expectedYear).slice(-2));
    });

    let coverageStatus: RequirementCoverageStatus = "Red";
    if (matchedBudgetDocs.some((document) => document.uploadStatus === "Ready")) {
      coverageStatus = "Green";
    } else if (matchedBudgetRows.length > 0 || matchedBudgetDocs.length > 0) {
      coverageStatus = "Amber";
    }

    const matchedSources = [
      ...matchedBudgetDocs.map((document) => ({
        id: document.id,
        type: "document" as const,
        title: document.name,
        score: document.uploadStatus === "Ready" ? 0.95 : 0.6,
        detail: summarizeSourceDetail(
          [document.name, document.documentType, document.owner].filter(Boolean).join(" "),
        ),
      })),
      ...matchedBudgetRows.map((budget) => ({
        id: budget.id,
        type: "budget" as const,
        title: budget.name,
        score: 0.82,
        detail: summarizeSourceDetail(
          [
            budget.name,
            budget.budgetType,
            budget.fiscalYear ? String(budget.fiscalYear) : null,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      })),
    ].slice(0, 3);

    return {
      requirementId: requirement.id,
      questionText: requirement.questionText,
      requirementType: requirement.requirementType ?? "Budget",
      coverageStatus,
      riskLevel: estimateRiskLevel(coverageStatus),
      linkedSourceIds: matchedSources.map((source) => toSourceRef(source.type, source.id)),
      matchedSources,
      note:
        coverageStatus === "Red"
          ? "No budget document or budget record matched this request. A task will be created to fill this gap."
          : coverageStatus === "Amber"
            ? `Matched budget support: ${summarizeSources(matchedSources)} A task will be created to strengthen this answer.`
            : `Matched budget support: ${summarizeSources(matchedSources)}`,
    };
  }

  private scoreSupportSource(
    queryTokens: Set<string>,
    queryThemes: Set<SupportTheme>,
    source: SupportSource,
  ) {
    if (queryTokens.size === 0) {
      return 0;
    }

    const overlap = setIntersectionSize(queryTokens, source.tokens);
    let score = overlap / Math.max(4, queryTokens.size);

    const themeMatches = [...queryThemes].filter((theme) => source.themes.has(theme)).length;
    score += Math.min(0.3, themeMatches * 0.12);
    score += Math.min(0.15, source.reliability * 0.15);

    if (source.type === "program" && queryThemes.has("program")) {
      score += 0.12;
    }

    if (source.type === "organization" && (queryThemes.has("program") || queryThemes.has("eligibility"))) {
      score += 0.08;
    }

    if (source.type === "evidence" && queryThemes.has("outcomes")) {
      score += 0.06;
    }

    return Math.min(score, 1);
  }

  private computeOpportunityComponentScores(input: {
    opportunity: typeof opportunities.$inferSelect;
    sourceSummary?: string | null;
    requirements: Array<typeof requirements.$inferSelect>;
    funder: typeof funders.$inferSelect;
    organization: typeof organizations.$inferSelect;
    programs: Array<typeof programs.$inferSelect>;
    grantRows: Array<typeof funderGrantRows.$inferSelect>;
    filingRows: Array<typeof funderFilings.$inferSelect>;
    evidenceCoveragePercent: number;
    reportingBurdenScore: number;
  }) {
    const opportunityText = [
      input.opportunity.title,
      input.sourceSummary,
      ...input.requirements.map((requirement) => requirement.questionText),
    ]
      .filter(Boolean)
      .join(" ");
    const opportunityTokens = tokenize(opportunityText);
    const missionTokens = tokenize(
      [input.organization.mission, input.organization.programSummary].filter(Boolean).join(" "),
    );
    const programTokens = tokenize(
      input.programs
        .flatMap((program) => [
          program.name,
          program.description,
          program.targetPopulation,
          program.keyOutcomes,
          program.geography,
        ])
        .filter(Boolean)
        .join(" "),
    );

    const missionAlignment = clamp(
      (setIntersectionSize(opportunityTokens, missionTokens) /
        Math.max(4, opportunityTokens.size || 1)) *
        100 +
        18,
    );
    const programFit = clamp(
      (setIntersectionSize(opportunityTokens, programTokens) /
        Math.max(4, opportunityTokens.size || 1)) *
        100 +
        22,
    );

    const geographyMatch = this.computeGeographyFit({
      organization: input.organization,
      programs: input.programs,
      funder: input.funder,
      opportunity: input.opportunity,
    });

    const deadlineFeasibility = this.computeDeadlineFeasibility(input.opportunity.deadline);
    const grantSizeFit = this.computeGrantSizeFit({
      funder: input.funder,
      organization: input.organization,
      opportunity: input.opportunity,
      programs: input.programs,
    });
    const smallOrgFriendly = this.computeSmallOrgFriendly({
      funder: input.funder,
      organization: input.organization,
    });

    return {
      missionAlignment: round(missionAlignment),
      geographyMatch: round(geographyMatch),
      programFit: round(programFit),
      evidenceCoverage: round(input.evidenceCoveragePercent),
      deadlineFeasibility: round(deadlineFeasibility),
      grantSizeFit: round(grantSizeFit),
      smallOrgFriendly: round(smallOrgFriendly),
      reportingBurden: round(input.reportingBurdenScore),
    };
  }

  private computeGeographyFit(input: {
    organization: typeof organizations.$inferSelect;
    programs: Array<typeof programs.$inferSelect>;
    funder: typeof funders.$inferSelect;
    opportunity: typeof opportunities.$inferSelect;
  }) {
    const funderGeographies = new Set(
      parseCommaSeparated(input.funder.geographicFocus).map((value) => value.toLowerCase()),
    );

    if (funderGeographies.size === 0) {
      return 65;
    }

    if (funderGeographies.has("national")) {
      return 100;
    }

    const orgGeographies = new Set(
      [
        input.organization.serviceArea,
        ...input.programs.map((program) => program.geography),
      ]
        .flatMap((value) => parseCommaSeparated(value))
        .map((value) => value.toLowerCase()),
    );

    if ([...funderGeographies].some((geo) => orgGeographies.has(geo))) {
      return 92;
    }

    if (
      [...funderGeographies].some(
        (geo) =>
          (geo.includes("southeast") && orgGeographies.has("georgia")) ||
          (geo.includes("georgia") && [...orgGeographies].some((value) => value.includes("atlanta"))),
      )
    ) {
      return 84;
    }

    return 28;
  }

  private computeDeadlineFeasibility(deadline?: string | null) {
    if (!deadline) {
      return 60;
    }

    const targetDate = new Date(deadline);
    const diffMs = targetDate.getTime() - Date.now();
    const days = diffMs / (1000 * 60 * 60 * 24);

    if (Number.isNaN(days)) {
      return 60;
    }

    if (days <= 0) {
      return 0;
    }

    if (days <= 7) {
      return 25;
    }

    if (days <= 14) {
      return 45;
    }

    if (days <= 30) {
      return 70;
    }

    if (days <= 60) {
      return 85;
    }

    return 100;
  }

  private computeGrantSizeFit(input: {
    funder: typeof funders.$inferSelect;
    organization: typeof organizations.$inferSelect;
    opportunity: typeof opportunities.$inferSelect;
    programs: Array<typeof programs.$inferSelect>;
  }) {
    const referenceGrant = input.funder.medianGrant ?? input.funder.averageGrant;
    const targetRequest =
      input.opportunity.amountRequested ??
      input.programs
        .map((program) => program.programBudget)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right)[0] ??
      null;

    if (!referenceGrant || !targetRequest) {
      return 65;
    }

    const ratio = targetRequest / referenceGrant;
    if (ratio >= 0.5 && ratio <= 1.5) {
      return 95;
    }
    if (ratio >= 0.25 && ratio <= 2) {
      return 80;
    }
    if (ratio >= 0.1 && ratio <= 3) {
      return 60;
    }

    return 35;
  }

  private computeSmallOrgFriendly(input: {
    funder: typeof funders.$inferSelect;
    organization: typeof organizations.$inferSelect;
  }) {
    const referenceGrant = input.funder.medianGrant ?? input.funder.averageGrant;
    const annualBudget = input.organization.annualBudget;

    if (!referenceGrant || !annualBudget) {
      return 60;
    }

    const ratio = referenceGrant / annualBudget;
    if (ratio <= 0.25) {
      return 95;
    }
    if (ratio <= 0.5) {
      return 85;
    }
    if (ratio <= 1) {
      return 70;
    }
    if (ratio <= 2) {
      return 55;
    }

    return 40;
  }

  private estimateReportingBurden(input: {
    requirementAnalyses: RequirementAnalysisRecord[];
  }) {
    const total = input.requirementAnalyses.reduce((sum, requirementAnalysis) => {
      const normalizedType = requirementAnalysis.requirementType.toLowerCase();
      const typeCost = normalizedType.includes("document")
        ? 8
        : normalizedType.includes("budget")
          ? 10
          : 12;
      const statusCost =
        requirementAnalysis.coverageStatus === "Red"
          ? 10
          : requirementAnalysis.coverageStatus === "Amber"
            ? 5
            : 0;
      return sum + typeCost + statusCost;
    }, 0);

    return clamp(total, 0, 100);
  }

  private estimateEffortHours(input: {
    requirementAnalyses: RequirementAnalysisRecord[];
    deadline?: string | null;
  }) {
    let total = 2;
    for (const requirementAnalysis of input.requirementAnalyses) {
      total += requirementAnalysis.requirementType.toLowerCase().includes("document") ? 0.75 : 1.5;
      if (requirementAnalysis.coverageStatus === "Amber") {
        total += 1.25;
      }
      if (requirementAnalysis.coverageStatus === "Red") {
        total += 2.5;
      }
    }

    const deadlineScore = this.computeDeadlineFeasibility(input.deadline);
    if (deadlineScore <= 45) {
      total += 2;
    }

    return round(total);
  }

  private derivePursueDecision(input: {
    fitScore: number;
    evidenceCoveragePercent: number;
    deadline?: string | null;
    redCount: number;
    effortEstimateHours: number;
  }): PursueDecision {
    const deadlineScore = this.computeDeadlineFeasibility(input.deadline);
    if (deadlineScore <= 0) {
      return "Skip";
    }

    if (
      input.fitScore >= 75 &&
      input.evidenceCoveragePercent >= 60 &&
      input.redCount <= 1 &&
      input.effortEstimateHours <= 16 &&
      deadlineScore >= 40
    ) {
      return "Pursue Now";
    }

    if (input.fitScore >= 58 && input.evidenceCoveragePercent >= 35 && deadlineScore >= 20) {
      return "Revisit Later";
    }

    return "Skip";
  }

  private deriveCapacityFlag(input: {
    effortEstimateHours: number;
    deadline?: string | null;
  }) {
    const deadlineScore = this.computeDeadlineFeasibility(input.deadline);
    if (input.effortEstimateHours > 16 || deadlineScore <= 35) {
      return "High Lift";
    }

    if (input.effortEstimateHours > 10 || deadlineScore <= 55) {
      return "Tight";
    }

    return "On Track";
  }

  private buildOpportunityRationale(input: {
    existingSummary?: string | null;
    funder: typeof funders.$inferSelect;
    fitScore: number;
    pursueDecision: PursueDecision;
    evidenceCoveragePercent: number;
    componentScores: OpportunityAnalysisResult["scoring"]["componentScores"];
    requirementAnalyses: RequirementAnalysisRecord[];
  }) {
    const biggestGap = input.requirementAnalyses
      .filter((record) => record.coverageStatus !== "Green")
      .map((record) => record.questionText)
      .slice(0, 2);

    const summaryPrefix = input.existingSummary
      ? `Opportunity summary: ${normalizeText(input.existingSummary)}`
      : null;

    const fitSummary = `Fit score is ${input.fitScore}% with a '${input.pursueDecision}' recommendation. Mission alignment scored ${input.componentScores.missionAlignment}%, program fit ${input.componentScores.programFit}%, geography match ${input.componentScores.geographyMatch}%, and evidence coverage ${input.evidenceCoveragePercent}%. Deadline feasibility landed at ${input.componentScores.deadlineFeasibility}% with a reporting burden score of ${input.componentScores.reportingBurden}%.`;

    const gapSummary =
      biggestGap.length > 0
        ? `Biggest gaps still needing review: ${biggestGap.join("; ")}.`
        : "No major evidence gaps were detected in the current requirement set.";

    const funderSummary = input.funder.givingSummary
      ? `Funder context: ${normalizeText(input.funder.givingSummary)}`
      : null;

    return [summaryPrefix, fitSummary, gapSummary, funderSummary]
      .filter(Boolean)
      .join(" ");
  }
}

const toNotionTaskPriority = (value?: string | null): "Low" | "Medium" | "High" => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "high" || normalized === "critical") {
    return "High";
  }
  if (normalized === "medium") {
    return "Medium";
  }
  return "Low";
};

const toNotionTaskStatus = (
  value?: string | null,
): "To Do" | "In Progress" | "Blocked" | "Done" => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "in progress") {
    return "In Progress";
  }
  if (normalized === "blocked") {
    return "Blocked";
  }
  if (normalized === "done") {
    return "Done";
  }
  return "To Do";
};
