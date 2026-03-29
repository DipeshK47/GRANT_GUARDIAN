import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  draftAnswers,
  funderFilings,
  funderGrantRows,
  funders,
  lessons,
  opportunities,
  requirements,
  submissionFieldMappings,
  submissionSessions,
} from "../../db/schema.js";
import {
  computeGrantDnaAlignment,
  readStoredGrantDnaProfile,
} from "../funders/grant-dna.js";
import type { OpportunityAnalysisResult, OpportunityAnalysisService } from "./analysis.js";
import {
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "./opportunity-identity.js";
import type {
  OpportunityReviewWorkflowService,
  OpportunitySubmissionReadiness,
} from "./review-workflow.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
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

const parseJsonArray = (value?: string | null) => {
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
    return parseCommaSeparated(normalized);
  }
};

const parseDraftRevisionNotes = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null as null | { dnaSuggestions: string[] };
  }

  try {
    const parsed = JSON.parse(normalized) as { dnaSuggestions?: unknown };
    return {
      dnaSuggestions: Array.isArray(parsed.dnaSuggestions)
        ? parsed.dnaSuggestions.map((item) => normalizeText(String(item))).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
};

const parseStoredFunderInsights = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null as null | {
      issueAreaConcentration?: string[];
      topGeographies?: string[];
      repeatGranteeBiasPercent?: number | null;
      smallOrgFriendly?: {
        label?: string;
        explanation?: string;
      };
      statedVsActual?: {
        stated?: string;
        actual?: string;
      };
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
      issueAreaConcentration?: string[];
      topGeographies?: string[];
      repeatGranteeBiasPercent?: number | null;
      smallOrgFriendly?: {
        label?: string;
        explanation?: string;
      };
      statedVsActual?: {
        stated?: string;
        actual?: string;
      };
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

const formatYearRange = (years: number[]) => {
  if (years.length === 0) {
    return "available years";
  }

  const sorted = [...years].sort((left, right) => left - right);
  return sorted[0] === sorted[sorted.length - 1]
    ? String(sorted[0])
    : `${sorted[0]}-${sorted[sorted.length - 1]}`;
};

const summarizeLessons = (rows: Array<typeof lessons.$inferSelect>) => {
  const themeCounts = new Map<string, number>();
  const recommendationHighlights: string[] = [];

  for (const row of rows) {
    for (const theme of parseJsonArray(row.themes)) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }

    const recommendation = normalizeText(row.recommendations);
    if (recommendation && !recommendationHighlights.includes(recommendation)) {
      recommendationHighlights.push(recommendation);
    }
  }

  const topThemes = [...themeCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme]) => theme);

  return {
    totalLessons: rows.length,
    reusableLessons: rows.filter((row) => Boolean(row.appliesNextCycle)).length,
    topThemes,
    recommendationHighlights: recommendationHighlights.slice(0, 3),
  };
};

const deriveCurrentCycleTopic = (
  opportunityTitle: string,
  requirementRows: Array<typeof requirements.$inferSelect>,
) => {
  const representativeQuestion = requirementRows.find((row) => normalizeText(row.questionText));
  const candidate = normalizeText(representativeQuestion?.questionText) || normalizeText(opportunityTitle);
  if (candidate.length <= 96) {
    return candidate;
  }

  return `${candidate.slice(0, 93).trimEnd()}...`;
};

const buildPriorRejectionWarning = (input: {
  funderName: string;
  opportunityTitle: string;
  requirementRows: Array<typeof requirements.$inferSelect>;
  priorLessonRows: Array<typeof lessons.$inferSelect>;
}) => {
  if (input.priorLessonRows.length === 0) {
    return null;
  }

  const summary = summarizeLessons(input.priorLessonRows);
  if (summary.topThemes.length === 0) {
    return null;
  }

  const currentCycleTopic = deriveCurrentCycleTopic(
    input.opportunityTitle,
    input.requirementRows,
  );
  return `Last time ${input.funderName} rejected you, they raised concerns about ${summary.topThemes.join(", ")}. This cycle asks about ${currentCycleTopic} — flagging for extra attention.`;
};

const topValues = (values: string[], limit = 5) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
};

const compactStrings = (values: Array<string | null | undefined>) =>
  values.map((value) => normalizeText(value)).filter(Boolean);

const deriveHandoffChecklistState = (mappingStatus?: string | null) => {
  const normalized = normalizeText(mappingStatus);
  if (normalized === "Filled") {
    return "filled" as const;
  }
  if (normalized === "Paused" || normalized === "Needs Review") {
    return "paused" as const;
  }
  return "not_reached" as const;
};

const deriveHandoffLogTone = (line: string) => {
  const normalized = normalizeText(line).toLowerCase();
  if (normalized.startsWith("filled:")) {
    return "filled" as const;
  }
  if (normalized.startsWith("paused at:")) {
    return "paused" as const;
  }
  return "info" as const;
};

const computeRepeatGranteeBiasPercent = (rows: Array<typeof funderGrantRows.$inferSelect>) => {
  if (rows.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    const recipientKey = normalizeText(row.recipientEin || row.recipientName).toLowerCase();
    if (!recipientKey) {
      continue;
    }

    counts.set(recipientKey, (counts.get(recipientKey) ?? 0) + 1);
  }

  const repeatRowCount = rows.filter((row) => {
    const recipientKey = normalizeText(row.recipientEin || row.recipientName).toLowerCase();
    return recipientKey ? (counts.get(recipientKey) ?? 0) > 1 : false;
  }).length;

  return Math.round((repeatRowCount / rows.length) * 100);
};

const computeGrantBenchmark = (rows: Array<typeof funderGrantRows.$inferSelect>) => {
  const amounts = rows
    .map((row) => row.grantAmount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (amounts.length === 0) {
    return null;
  }

  const middle = Math.floor(amounts.length / 2);
  return amounts.length % 2 === 0
    ? ((amounts[middle - 1] ?? 0) + (amounts[middle] ?? 0)) / 2
    : (amounts[middle] ?? null);
};

const classifySmallOrgFriendly = (referenceGrant: number | null) => {
  if (referenceGrant === null) {
    return {
      label: "Needs research",
      explanation:
        "Recipient-level grant sizing is still too thin to estimate how friendly this funder is to smaller nonprofits.",
    };
  }

  if (referenceGrant <= 25000) {
    return {
      label: "High",
      explanation:
        "Visible grant sizes cluster in a range that usually works for small nonprofit budgets.",
    };
  }

  if (referenceGrant <= 100000) {
    return {
      label: "Medium",
      explanation:
        "This funder appears reachable for smaller teams, but the grant size pattern is not clearly tiny-org focused.",
    };
  }

  return {
    label: "Low",
    explanation:
      "Typical visible grants are large enough that smaller organizations may need a stronger capacity case.",
  };
};

export type OpportunityWorkbenchResult = {
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  funder: {
    id: string;
    name: string;
    ein?: string | null;
    website?: string | null;
    givingSummary?: string | null;
    averageGrant?: number | null;
    medianGrant?: number | null;
    grantRange?: string | null;
    geographicFocus: string[];
    prioritySignals?: string | null;
    grantDnaTopTerms?: string | null;
    narrativeStyle?: string | null;
    toneNotes?: string | null;
    filingYears: number[];
    parsedFilingCount: number;
    visibleGrantRows: number;
    topGeographies: string[];
    topCategories: string[];
    issueAreaConcentration: string[];
    repeatGranteeBiasPercent: number | null;
    smallOrgFriendlyLabel: string;
    smallOrgFriendlyExplanation: string;
    statedVsActual: {
      stated: string;
      actual: string;
    };
    sourceLine: string;
    grantDnaTopPhrases: string[];
    framingStyles: string[];
    toneSummary: string;
    lastResearchedAt?: string | null;
  };
  analysis: OpportunityAnalysisResult | null;
  drafts: {
    total: number;
    approved: number;
    rows: Array<{
      id: string;
      requirementId: string;
      questionText: string;
      requirementType: string;
      status: string;
      draftText: string;
      wordCount: number;
      evidenceCitations: string[];
      unsupportedClaims: string[];
      dnaMatchScore: number;
      dnaSuggestions: string[];
    }>;
  };
  reviewReadiness: OpportunitySubmissionReadiness | null;
  lessonsMemory: {
    lessons: Array<{
      id: string;
      opportunityTitle?: string | null;
      feedbackText: string;
      themes: string[];
      recommendations?: string | null;
      appliesNextCycle: boolean;
      rejectionDate: string;
      createdAt: string;
      updatedAt: string;
    }>;
    memorySummary: {
      totalLessons: number;
      reusableLessons: number;
      topThemes: string[];
      recommendationHighlights: string[];
    };
    warningMessage?: string | null;
  };
  submissionHandoff: null | {
    latestSession: {
      submissionSessionId: string;
      launchStatus: string;
      launchMode: string;
      portalUrl: string;
      launchRequestedAt: string;
      launchTriggeredAt?: string | null;
      reviewerName?: string | null;
      finalSubmitAuthorized: boolean;
      waitingForHumanInput: boolean;
    };
    recentLogs: Array<{
      id: string;
      line: string;
      createdAt: string;
      tone: "filled" | "paused" | "info";
    }>;
    checklist: Array<{
      fieldLabel: string;
      state: "filled" | "paused" | "not_reached";
      detail?: string | null;
    }>;
    warning: string;
  };
};

export class OpportunityWorkbenchService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly analysisService: OpportunityAnalysisService,
    private readonly reviewWorkflowService: OpportunityReviewWorkflowService,
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
  }

  async get(opportunityId: string): Promise<OpportunityWorkbenchResult> {
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

    const scopeCondition = normalizeText(opportunity.organizationId)
      ? eq(lessons.organizationId, normalizeText(opportunity.organizationId))
      : isNull(lessons.organizationId);

    const [requirementRows, draftRows, filingRows, grantRows, lessonRows, sessionRows] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunity.id)),
      db.select().from(funderFilings).where(eq(funderFilings.funderId, funder.id)),
      db.select().from(funderGrantRows).where(eq(funderGrantRows.funderId, funder.id)),
      db
        .select()
        .from(lessons)
        .where(and(scopeCondition, eq(lessons.funderId, funder.id)))
        .orderBy(desc(lessons.updatedAt)),
      db
        .select()
        .from(submissionSessions)
        .where(eq(submissionSessions.opportunityId, opportunity.id))
        .orderBy(desc(submissionSessions.launchRequestedAt)),
    ]);

    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));
    const lessonOpportunityIds = Array.from(
      new Set(
        lessonRows
          .map((row) => normalizeText(row.opportunityId))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const lessonOpportunityRows =
      lessonOpportunityIds.length > 0
        ? await db
            .select({
              id: opportunities.id,
              title: opportunities.title,
            })
            .from(opportunities)
            .where(inArray(opportunities.id, lessonOpportunityIds))
        : [];
    const lessonOpportunityTitleById = new Map(
      lessonOpportunityRows.map((row) => [row.id, row.title]),
    );
    const priorLessonRows = lessonRows.filter((row) => row.opportunityId !== opportunity.id);
    const warningMessage = buildPriorRejectionWarning({
      funderName: funder.name,
      opportunityTitle: opportunity.title,
      requirementRows,
      priorLessonRows,
    });

    let analysis: OpportunityAnalysisResult | null = null;
    if (requirementRows.length > 0) {
      try {
        analysis = await this.analysisService.inspect({ opportunityId: opportunity.id });
      } catch (error) {
        this.logger.warn(
          {
            error,
            opportunityId: opportunity.id,
          },
          "Unable to compute persisted workbench analysis snapshot",
        );
      }
    }

    let reviewReadiness: OpportunitySubmissionReadiness | null = null;
    if (requirementRows.length > 0) {
      try {
        reviewReadiness = await this.reviewWorkflowService.getReadiness(opportunity.id);
      } catch (error) {
        this.logger.warn(
          {
            error,
            opportunityId: opportunity.id,
          },
          "Unable to compute persisted review readiness snapshot",
        );
      }
    }

    const filingYears = filingRows
      .map((row) => row.taxYear)
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => right - left);
    const storedInsights = parseStoredFunderInsights(funder.relationshipHistory);
    const grantDnaProfile = readStoredGrantDnaProfile({
      relationshipHistory: funder.relationshipHistory,
      grantDnaTopTerms: funder.grantDnaTopTerms,
      narrativeStyle: funder.narrativeStyle,
      toneNotes: funder.toneNotes,
    });
    const derivedTopGeographies = topValues(compactStrings([
      ...filingRows.flatMap((row) => parseCommaSeparated(row.topGeographies)),
      ...grantRows.flatMap((row) => [row.recipientState, row.recipientCity]),
    ]));
    const derivedTopCategories = topValues(compactStrings([
      ...filingRows.flatMap((row) => parseCommaSeparated(row.topCategories)),
      ...grantRows.map((row) => row.purpose),
    ]));
    const repeatGranteeBiasPercent =
      typeof storedInsights?.repeatGranteeBiasPercent === "number"
        ? storedInsights.repeatGranteeBiasPercent
        : computeRepeatGranteeBiasPercent(grantRows);
    const smallOrgFriendlyFallback = classifySmallOrgFriendly(
      funder.medianGrant ?? funder.averageGrant ?? computeGrantBenchmark(grantRows) ?? null,
    );
    const latestSubmissionSession = sessionRows[0] ?? null;
    const [handoffMappingRows, handoffLogRows] = latestSubmissionSession
      ? await Promise.all([
          db
            .select()
            .from(submissionFieldMappings)
            .where(eq(submissionFieldMappings.submissionSessionId, latestSubmissionSession.id))
            .orderBy(desc(submissionFieldMappings.updatedAt)),
          db
            .select()
            .from(agentLogs)
            .where(eq(agentLogs.sourceUrl, `submission-session:${latestSubmissionSession.id}`))
            .orderBy(desc(agentLogs.createdAt)),
        ])
      : [[], []];
    const handoffChecklist = latestSubmissionSession
      ? [
          ...handoffMappingRows.map((mapping) => {
            const detailSegments = [
              normalizeText(mapping.matchedPortalLabel)
                ? `Matched to ${normalizeText(mapping.matchedPortalLabel)}`
                : null,
              normalizeText(mapping.notes) || null,
            ].filter(Boolean);

            return {
              fieldLabel: mapping.fieldLabel,
              state: deriveHandoffChecklistState(mapping.mappingStatus),
              detail: detailSegments.length > 0 ? detailSegments.join(" · ") : null,
            };
          }),
          ...(latestSubmissionSession.launchMode === "Browser Launch" ||
          latestSubmissionSession.launchMode === "Handoff Only"
            ? [
                {
                  fieldLabel: "Final submit button",
                  state: latestSubmissionSession.finalSubmitAuthorized
                    ? ("filled" as const)
                    : ("paused" as const),
                  detail: latestSubmissionSession.finalSubmitAuthorized
                    ? "Second human confirmation has been recorded."
                    : "Grant Guardian will never auto-submit. Review everything before clicking Submit in the portal.",
                },
              ]
            : []),
        ]
      : [];
    const waitingForHumanInput =
      Boolean(
        latestSubmissionSession &&
          (normalizeText(latestSubmissionSession.status) === "Waiting for Human Input" ||
            handoffChecklist.some((item) => item.state === "paused")),
      );

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      opportunityStatus: opportunity.status,
      funder: {
        id: funder.id,
        name: funder.name,
        ein: funder.ein,
        website: funder.website,
        givingSummary: funder.givingSummary,
        averageGrant: funder.averageGrant,
        medianGrant: funder.medianGrant,
        grantRange: funder.grantRange,
        geographicFocus: parseCommaSeparated(funder.geographicFocus),
        prioritySignals: funder.prioritySignals,
        grantDnaTopTerms: funder.grantDnaTopTerms,
        narrativeStyle: funder.narrativeStyle,
        toneNotes: funder.toneNotes,
        filingYears,
        parsedFilingCount: filingRows.filter(
          (row) => row.parsedStatus === "Parsed" || row.parsedStatus === "Partial",
        ).length,
        visibleGrantRows: grantRows.length,
        topGeographies: storedInsights?.topGeographies?.length
          ? storedInsights.topGeographies
          : derivedTopGeographies,
        topCategories: derivedTopCategories,
        issueAreaConcentration: storedInsights?.issueAreaConcentration?.length
          ? storedInsights.issueAreaConcentration
          : derivedTopCategories,
        repeatGranteeBiasPercent,
        smallOrgFriendlyLabel:
          (storedInsights?.smallOrgFriendly?.label ??
            normalizeText(funder.toneNotes?.split(":")[0])) ||
          smallOrgFriendlyFallback.label,
        smallOrgFriendlyExplanation:
          (storedInsights?.smallOrgFriendly?.explanation ??
            normalizeText(funder.toneNotes?.split(":").slice(1).join(":"))) ||
          smallOrgFriendlyFallback.explanation,
        statedVsActual: {
          stated:
            storedInsights?.statedVsActual?.stated ??
            (normalizeText(funder.prioritySignals) ||
              "Website positioning has not been captured yet for this funder."),
          actual:
            storedInsights?.statedVsActual?.actual ??
            (normalizeText(funder.givingSummary) ||
              "990-backed giving behavior has not been pulled into the workspace yet."),
        },
        sourceLine:
          storedInsights?.sourceLine ??
          `Based on ProPublica filings from ${formatYearRange(filingYears)}.`,
        grantDnaTopPhrases:
          parseGrantDnaTopTerms(storedInsights?.grantDna?.topTerms).length
            ? parseGrantDnaTopTerms(storedInsights?.grantDna?.topTerms)
            : parseCommaSeparated(funder.grantDnaTopTerms),
        framingStyles:
          storedInsights?.grantDna?.framingStyles?.length
            ? storedInsights.grantDna.framingStyles
            : parseCommaSeparated(
                normalizeText(funder.narrativeStyle).replace(/·/g, ","),
              ),
        toneSummary:
          normalizeText(storedInsights?.grantDna?.toneSummary) ||
          normalizeText(funder.toneNotes) ||
          "Grant DNA is still being assembled from the funder's public language and filings.",
        lastResearchedAt: funder.lastResearchedAt,
      },
      analysis,
      drafts: {
        total: draftRows.length,
        approved: draftRows.filter((row) => normalizeText(row.status) === "Approved").length,
        rows: draftRows.map((draft) => {
          const revisionNotes = parseDraftRevisionNotes(draft.revisionNotes);
          const alignment = computeGrantDnaAlignment({
            profile: grantDnaProfile,
            draftText: draft.draftText,
          });

          return {
            id: draft.id,
            requirementId: draft.requirementId,
            questionText: requirementById.get(draft.requirementId)?.questionText ?? "Requirement",
            requirementType:
              requirementById.get(draft.requirementId)?.requirementType ?? "Narrative Question",
            status: draft.status,
            draftText: draft.draftText,
            wordCount: draft.wordCount ?? 0,
            evidenceCitations: parseJsonArray(draft.evidenceCitations),
            unsupportedClaims: parseJsonArray(draft.unsupportedClaims),
            dnaMatchScore: draft.dnaMatchScore ?? alignment.score,
            dnaSuggestions: revisionNotes?.dnaSuggestions?.length
              ? revisionNotes.dnaSuggestions
              : alignment.suggestions,
          };
        }),
      },
      reviewReadiness,
      lessonsMemory: {
        lessons: lessonRows.map((row) => ({
          id: row.id,
          opportunityTitle: row.opportunityId
            ? lessonOpportunityTitleById.get(row.opportunityId) ?? null
            : null,
          feedbackText: row.feedbackText,
          themes: parseJsonArray(row.themes),
          recommendations: row.recommendations,
          appliesNextCycle: Boolean(row.appliesNextCycle),
          rejectionDate: row.createdAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        memorySummary: summarizeLessons(lessonRows),
        warningMessage,
      },
      submissionHandoff: latestSubmissionSession
        ? {
            latestSession: {
              submissionSessionId: latestSubmissionSession.id,
              launchStatus: latestSubmissionSession.status,
              launchMode: latestSubmissionSession.launchMode,
              portalUrl: latestSubmissionSession.portalUrl,
              launchRequestedAt: latestSubmissionSession.launchRequestedAt,
              launchTriggeredAt: latestSubmissionSession.launchTriggeredAt,
              reviewerName: latestSubmissionSession.reviewerName,
              finalSubmitAuthorized: latestSubmissionSession.finalSubmitAuthorized,
              waitingForHumanInput,
            },
            recentLogs: handoffLogRows.slice(0, 10).map((row) => ({
              id: row.id,
              line: normalizeText(row.outputSummary) || normalizeText(row.actionDescription),
              createdAt: row.createdAt,
              tone: deriveHandoffLogTone(
                normalizeText(row.outputSummary) || normalizeText(row.actionDescription),
              ),
            })),
            checklist: handoffChecklist,
            warning:
              "Grant Guardian will never auto-submit. Review everything before clicking Submit in the portal.",
          }
        : null,
    };
  }
}
