import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentLogs, funders, lessons, opportunities } from "../../db/schema.js";
import { normalizeScopedText, resolveOrganizationId } from "../../lib/organization-scope.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import {
  GeminiLessonFeedbackAnalyzer,
  SUPPORTED_LESSON_THEMES,
  type SupportedLessonTheme,
} from "./gemini-feedback.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type LessonTheme = SupportedLessonTheme;

type LessonRecord = typeof lessons.$inferSelect;
type OpportunityRecord = typeof opportunities.$inferSelect;
type FunderRecord = typeof funders.$inferSelect;

export type RecordLessonInput = {
  opportunityId?: string | null;
  funderId?: string | null;
  organizationId?: string | null;
  feedbackText: string;
  themes?: string[] | null;
  recommendations?: string | null;
  appliesNextCycle?: boolean | null;
  markOpportunityRejected?: boolean;
  syncToNotion?: boolean;
};

export type LessonListResult = {
  funderId: string;
  funderName: string;
  opportunityId?: string | null;
  opportunityTitle?: string | null;
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
};

export type RecordLessonResult = LessonListResult & {
  lessonId: string;
  opportunityStatus?: string | null;
  notionSync?: {
    lessonPageIds: string[];
  };
};

export type UpdateLessonInput = {
  lessonId: string;
  organizationId?: string | null;
  themes?: string[] | null;
  recommendations?: string | null;
  appliesNextCycle?: boolean | null;
  syncToNotion?: boolean;
};

export type UpdateLessonResult = {
  lessonId: string;
  funderId: string;
  funderName: string;
  opportunityId?: string | null;
  opportunityTitle?: string | null;
  themes: string[];
  recommendations?: string | null;
  appliesNextCycle: boolean;
  notionSync?: {
    lessonPageIds: string[];
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const parseThemes = (value?: string | null) => {
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
    return normalized
      .split(/\n|,|\|/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
};

const serializeThemes = (value?: string[] | null) => {
  const normalized = (value ?? []).map((item) => normalizeText(item)).filter(Boolean);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
};

const themeRules: Array<{ theme: LessonTheme; pattern: RegExp }> = [
  {
    theme: "Evaluation Weakness",
    pattern: /\bevaluation|methodology|benchmark|comparison data|longitudinal|rigor\b/i,
  },
  {
    theme: "Budget Mismatch",
    pattern: /\bbudget|cost|expense|financial|funding level|price\b/i,
  },
  {
    theme: "Geographic Fit",
    pattern: /\bgeograph|regional|region|statewide|county|local fit\b/i,
  },
  {
    theme: "Capacity Concerns",
    pattern: /\bcapacity|staffing|bandwidth|team size|infrastructure|scale\b/i,
  },
  {
    theme: "Outcomes Unclear",
    pattern: /\boutcome|impact|results|logic model|unclear|measurement plan\b/i,
  },
];

const recommendationByTheme: Record<LessonTheme, string> = {
  "Evaluation Weakness":
    "Strengthen the evaluation section with benchmarks, comparison data, and a clearer measurement method.",
  "Budget Mismatch":
    "Reframe the request amount and budget narrative so the cost structure matches the funder's typical award pattern.",
  "Geographic Fit":
    "Clarify the geographic footprint and why this work belongs in the funder's target region.",
  "Capacity Concerns":
    "Show delivery capacity more clearly with staffing, partners, and implementation guardrails.",
  "Outcomes Unclear":
    "Tighten the outcomes story with specific measures, targets, and a clearer results timeline.",
};

const supportedThemeSet = new Set<string>(SUPPORTED_LESSON_THEMES);

const deriveThemes = (feedbackText: string, explicitThemes?: string[] | null) => {
  const normalizedThemes = (explicitThemes ?? [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
  if (normalizedThemes.length > 0) {
    return normalizedThemes;
  }

  const derived = themeRules
    .filter((rule) => rule.pattern.test(feedbackText))
    .map((rule) => rule.theme);
  return Array.from(new Set(derived));
};

const deriveRecommendations = (themes: string[], explicitRecommendations?: string | null) => {
  const normalized = normalizeText(explicitRecommendations);
  if (normalized) {
    return normalized;
  }

  const recommendations = themes
    .map((theme) => recommendationByTheme[theme as LessonTheme])
    .filter(Boolean);
  return recommendations.length > 0 ? recommendations.join(" ") : null;
};

const normalizeThemeList = (themes: string[]) =>
  themes
    .map((theme) => normalizeText(theme))
    .filter((theme): theme is LessonTheme => supportedThemeSet.has(theme));

const buildLessonTitle = (input: {
  funderName: string;
  opportunityTitle?: string | null;
  createdAt: string;
}) => {
  const prefix = input.opportunityTitle
    ? `${input.funderName} - ${input.opportunityTitle}`
    : `${input.funderName} Lesson`;
  return `${prefix} (${input.createdAt.slice(0, 10)})`;
};

const summarizeMemory = (rows: LessonRecord[]) => {
  const themeCounts = new Map<string, number>();
  const recommendationHighlights: string[] = [];

  for (const row of rows) {
    for (const theme of parseThemes(row.themes)) {
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

export class LessonMemoryService {
  private readonly logger: LoggerLike;
  private readonly feedbackAnalyzer?: GeminiLessonFeedbackAnalyzer;

  constructor(
    private readonly notionClient?: NotionMcpClient,
    feedbackAnalyzer?: GeminiLessonFeedbackAnalyzer,
    logger?: Partial<LoggerLike>,
  ) {
    this.feedbackAnalyzer = feedbackAnalyzer;
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

  async record(input: RecordLessonInput): Promise<RecordLessonResult> {
    const feedbackText = normalizeText(input.feedbackText);
    if (!feedbackText) {
      throw new Error("Lesson recording requires feedbackText.");
    }

    const context = await this.resolveContext({
      opportunityId: input.opportunityId,
      funderId: input.funderId,
      organizationId: input.organizationId,
    });

    const analyzed = await this.analyzeFeedback({
      feedbackText,
      funderName: context.funder.name,
      opportunityTitle: context.opportunity?.title,
      explicitThemes: input.themes,
      explicitRecommendations: input.recommendations,
    });
    const themes = analyzed.themes;
    const recommendations = analyzed.recommendations;
    const appliesNextCycle = input.appliesNextCycle ?? true;
    const now = new Date().toISOString();

    const lessonId = randomUUID();
    await db.insert(lessons).values({
      id: lessonId,
      organizationId: context.organizationId,
      funderId: context.funder.id,
      opportunityId: context.opportunity?.id ?? null,
      feedbackText,
      themes: serializeThemes(themes),
      recommendations,
      appliesNextCycle,
      createdAt: now,
      updatedAt: now,
    });

    let opportunityStatus = context.opportunity?.status ?? null;
    if (context.opportunity && input.markOpportunityRejected) {
      opportunityStatus = "Rejected";
      await db
        .update(opportunities)
        .set({
          status: "Rejected",
          updatedAt: now,
        })
        .where(eq(opportunities.id, context.opportunity.id));
    }

    await db.insert(agentLogs).values({
      id: randomUUID(),
      runId: randomUUID(),
      agentName: "lesson-memory",
      actionDescription: "Recorded rejection or feedback lesson",
      confidenceLevel: 0.95,
      outputSummary: `Captured a reusable lesson for ${context.funder.name}${context.opportunity ? ` from ${context.opportunity.title}` : ""}.`,
      followUpRequired: appliesNextCycle,
      createdAt: now,
      updatedAt: now,
    });

    let notionSync: RecordLessonResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncLessonsMemory({
          lessons: [
            {
              title: buildLessonTitle({
                funderName: context.funder.name,
                opportunityTitle: context.opportunity?.title,
                createdAt: now,
              }),
              funderName: context.funder.name,
              opportunityTitle: context.opportunity?.title,
              result: input.markOpportunityRejected ? "Rejected" : null,
              feedbackText,
              themes,
              recommendations,
              appliesNextCycle,
              recordedAt: now,
              appendToFunderPage: true,
            },
          ],
        });
        if (context.opportunity && opportunityStatus === "Rejected") {
          await this.notionClient.syncOpportunityStatus({
            opportunityId: context.opportunity.id,
            opportunityTitle: context.opportunity.title,
            status: opportunityStatus,
          });
        }
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for lesson memory record");
      }
    }

    const listResult = await this.list({
      funderId: context.funder.id,
      organizationId: context.organizationId,
      opportunityId: context.opportunity?.id ?? undefined,
    });

    return {
      ...listResult,
      lessonId,
      opportunityStatus,
      notionSync,
    };
  }

  async list(input: {
    funderId?: string | null;
    opportunityId?: string | null;
    organizationId?: string | null;
    reusableOnly?: boolean;
  }): Promise<LessonListResult> {
    const context = await this.resolveContext({
      opportunityId: input.opportunityId,
      funderId: input.funderId,
      organizationId: input.organizationId,
    });
    const scopeCondition = context.organizationId
      ? eq(lessons.organizationId, context.organizationId)
      : isNull(lessons.organizationId);

    const lessonRows = input.opportunityId
      ? await db
          .select()
          .from(lessons)
          .where(
            and(
              scopeCondition,
              eq(lessons.funderId, context.funder.id),
              eq(lessons.opportunityId, context.opportunity?.id ?? ""),
            ),
          )
          .orderBy(desc(lessons.updatedAt))
      : await db
          .select()
          .from(lessons)
          .where(and(scopeCondition, eq(lessons.funderId, context.funder.id)))
          .orderBy(desc(lessons.updatedAt));

    const filteredRows = input.reusableOnly
      ? lessonRows.filter((row) => Boolean(row.appliesNextCycle))
      : lessonRows;
    const opportunityTitleById = await this.loadOpportunityTitles(filteredRows);

    return {
      funderId: context.funder.id,
      funderName: context.funder.name,
      opportunityId: context.opportunity?.id ?? null,
      opportunityTitle: context.opportunity?.title ?? null,
      lessons: filteredRows.map((row) => ({
        id: row.id,
        opportunityTitle: row.opportunityId ? opportunityTitleById.get(row.opportunityId) ?? null : null,
        feedbackText: row.feedbackText,
        themes: parseThemes(row.themes),
        recommendations: row.recommendations,
        appliesNextCycle: Boolean(row.appliesNextCycle),
        rejectionDate: row.createdAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      memorySummary: summarizeMemory(filteredRows),
    };
  }

  async update(input: UpdateLessonInput): Promise<UpdateLessonResult> {
    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, input.lessonId))
      .limit(1);
    if (!lesson) {
      throw new Error("No lesson exists for the provided lessonId.");
    }

    const requestedOrganizationId = normalizeScopedText(input.organizationId) || null;
    const storedOrganizationId = normalizeScopedText(lesson.organizationId) || null;
    if (
      requestedOrganizationId &&
      storedOrganizationId &&
      requestedOrganizationId !== storedOrganizationId
    ) {
      throw new Error("Lesson does not belong to the requested organizationId.");
    }

    const context = await this.resolveContext({
      opportunityId: lesson.opportunityId,
      funderId: lesson.funderId,
      organizationId: requestedOrganizationId ?? storedOrganizationId,
    });
    const nextThemes =
      input.themes !== undefined ? deriveThemes(lesson.feedbackText, input.themes) : parseThemes(lesson.themes);
    const nextRecommendations =
      input.recommendations !== undefined
        ? deriveRecommendations(nextThemes, input.recommendations)
        : lesson.recommendations;
    const nextAppliesNextCycle =
      input.appliesNextCycle !== undefined
        ? Boolean(input.appliesNextCycle)
        : Boolean(lesson.appliesNextCycle);
    const now = new Date().toISOString();

    await db
      .update(lessons)
      .set({
        organizationId: context.organizationId,
        themes: serializeThemes(nextThemes),
        recommendations: nextRecommendations,
        appliesNextCycle: nextAppliesNextCycle,
        updatedAt: now,
      })
      .where(eq(lessons.id, lesson.id));

    await db.insert(agentLogs).values({
      id: randomUUID(),
      runId: randomUUID(),
      agentName: "lesson-memory",
      actionDescription: "Updated lesson memory entry",
      confidenceLevel: 0.95,
      outputSummary: `Updated the reusable lesson memory for ${context.funder.name}.`,
      followUpRequired: nextAppliesNextCycle,
      createdAt: now,
      updatedAt: now,
    });

    let notionSync: UpdateLessonResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncLessonsMemory({
          lessons: [
            {
              title: buildLessonTitle({
                funderName: context.funder.name,
                opportunityTitle: context.opportunity?.title,
                createdAt: lesson.createdAt,
              }),
              funderName: context.funder.name,
              opportunityTitle: context.opportunity?.title,
              result: "Rejected",
              feedbackText: lesson.feedbackText,
              themes: nextThemes,
              recommendations: nextRecommendations,
              appliesNextCycle: nextAppliesNextCycle,
              recordedAt: lesson.createdAt,
            },
          ],
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for lesson memory update");
      }
    }

    return {
      lessonId: lesson.id,
      funderId: context.funder.id,
      funderName: context.funder.name,
      opportunityId: context.opportunity?.id ?? null,
      opportunityTitle: context.opportunity?.title ?? null,
      themes: nextThemes,
      recommendations: nextRecommendations,
      appliesNextCycle: nextAppliesNextCycle,
      notionSync,
    };
  }

  private async analyzeFeedback(input: {
    feedbackText: string;
    funderName: string;
    opportunityTitle?: string | null;
    explicitThemes?: string[] | null;
    explicitRecommendations?: string | null;
  }) {
    const explicitThemes = normalizeThemeList(input.explicitThemes ?? []);
    const explicitRecommendations = normalizeText(input.explicitRecommendations);
    if (explicitThemes.length > 0 || explicitRecommendations) {
      const themes = explicitThemes.length > 0
        ? explicitThemes
        : deriveThemes(input.feedbackText, explicitThemes);
      return {
        themes,
        recommendations: deriveRecommendations(themes, explicitRecommendations),
      };
    }

    if (this.feedbackAnalyzer?.isConfigured()) {
      try {
        const analyzed = await this.feedbackAnalyzer.analyze({
          feedbackText: input.feedbackText,
          funderName: input.funderName,
          opportunityTitle: input.opportunityTitle,
        });
        if (analyzed) {
          const themes = normalizeThemeList(analyzed.themes);
          return {
            themes,
            recommendations: deriveRecommendations(themes, analyzed.recommendations),
          };
        }
      } catch (error) {
        this.logger.warn({ error }, "Falling back to heuristic lesson theme extraction");
      }
    }

    const themes = deriveThemes(input.feedbackText, explicitThemes);
    return {
      themes,
      recommendations: deriveRecommendations(themes, explicitRecommendations),
    };
  }

  private async loadOpportunityTitles(rows: LessonRecord[]) {
    const opportunityIds = Array.from(
      new Set(
        rows
          .map((row) => normalizeText(row.opportunityId))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (opportunityIds.length === 0) {
      return new Map<string, string>();
    }

    const opportunityRows = await db
      .select({
        id: opportunities.id,
        title: opportunities.title,
      })
      .from(opportunities)
      .where(inArray(opportunities.id, opportunityIds));

    return new Map(
      opportunityRows.map((row) => [row.id, row.title]),
    );
  }

  private async resolveContext(input: {
    opportunityId?: string | null;
    funderId?: string | null;
    organizationId?: string | null;
  }): Promise<{
    opportunity: OpportunityRecord | null;
    funder: FunderRecord;
    organizationId: string | null;
  }> {
    const opportunityId = normalizeText(input.opportunityId);
    const funderId = normalizeText(input.funderId);
    const requestedOrganizationId = normalizeScopedText(input.organizationId) || null;

    let opportunity: OpportunityRecord | null = null;
    if (opportunityId) {
      const [opportunityRow] = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);
      opportunity = opportunityRow ?? null;
      if (!opportunity) {
        throw new Error("No opportunity exists for the provided opportunityId.");
      }

      const opportunityOrganizationId = normalizeScopedText(opportunity.organizationId) || null;
      if (
        requestedOrganizationId &&
        opportunityOrganizationId &&
        requestedOrganizationId !== opportunityOrganizationId
      ) {
        throw new Error("Opportunity does not belong to the requested organizationId.");
      }
      if (requestedOrganizationId && !opportunityOrganizationId) {
        throw new Error("Opportunity is not scoped to the requested organizationId.");
      }
    }

    const organizationId =
      normalizeScopedText(opportunity?.organizationId) ||
      requestedOrganizationId ||
      (opportunity ? null : await resolveOrganizationId(requestedOrganizationId));

    const resolvedFunderId = funderId || opportunity?.funderId;
    if (!resolvedFunderId) {
      throw new Error("Lesson lookup requires a funderId or opportunityId.");
    }

    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, resolvedFunderId))
      .limit(1);
    if (!funder) {
      throw new Error("No funder exists for the provided context.");
    }

    return {
      opportunity,
      funder,
      organizationId,
    };
  }
}
