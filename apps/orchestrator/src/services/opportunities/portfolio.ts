import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { funders, opportunities } from "../../db/schema.js";
import { resolveOrganizationId } from "../../lib/organization-scope.js";
import { dedupeOpportunities } from "./opportunity-identity.js";
import type { NotionMcpClient } from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type PortfolioClassification = "Pursue Now" | "Revisit Later" | "Skip";

type OpportunityRow = typeof opportunities.$inferSelect;
type FunderRow = typeof funders.$inferSelect;

export type PortfolioOpportunityRecord = {
  id: string;
  organizationId?: string | null;
  funderId: string;
  funderName: string;
  title: string;
  status: string;
  deadline?: string | null;
  fitScore: number;
  evidenceCoveragePercent: number;
  effortEstimateHours: number;
  reportingBurdenScore: number;
  deadlineProximityScore: number;
  priorityScore: number;
  classification: PortfolioClassification;
  pursueDecision: PortfolioClassification;
  recommendedHoursThisWeek: number;
  analysisReady: boolean;
  nextMove: string;
};

export type PortfolioSnapshot = {
  organizationId: string | null;
  generatedAt: string;
  monthlyStaffHours: number;
  weeklyStaffHours: number;
  rankedOpportunities: PortfolioOpportunityRecord[];
  summary: {
    totalActive: number;
    pursueNow: number;
    revisitLater: number;
    skip: number;
    analysisNeeded: number;
  };
  staffingRecommendation: {
    availableHoursThisWeek: number;
    allocatedHoursThisWeek: number;
    remainingHoursThisWeek: number;
    recommendations: Array<{
      opportunityId: string;
      opportunityTitle: string;
      hours: number;
      classification: PortfolioClassification;
    }>;
    summary: string;
  };
  notionSync?: {
    pursueThisWeekPageId: string;
  };
};

const ACTIVE_EXCLUDED_STATUSES = new Set(["Submitted", "Awarded", "Rejected"]);

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const round = (value: number, precision = 1) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const toClassification = (value?: string | null): PortfolioClassification | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("pursue")) {
    return "Pursue Now";
  }
  if (normalized.includes("revisit")) {
    return "Revisit Later";
  }
  if (normalized.includes("skip")) {
    return "Skip";
  }

  return null;
};

const computeDeadlineProximityScore = (deadline?: string | null) => {
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
};

const deriveClassification = (input: {
  storedDecision?: string | null;
  fitScore: number;
  evidenceCoveragePercent: number;
  deadlineProximityScore: number;
  effortEstimateHours: number;
  analysisReady: boolean;
}): PortfolioClassification => {
  const stored = toClassification(input.storedDecision);
  if (stored) {
    return stored;
  }

  if (!input.analysisReady) {
    return "Revisit Later";
  }

  if (
    input.fitScore >= 75 &&
    input.evidenceCoveragePercent >= 60 &&
    input.deadlineProximityScore >= 40 &&
    input.effortEstimateHours <= 16
  ) {
    return "Pursue Now";
  }

  if (
    input.fitScore >= 58 &&
    input.evidenceCoveragePercent >= 35 &&
    input.deadlineProximityScore >= 20
  ) {
    return "Revisit Later";
  }

  return "Skip";
};

const buildNextMove = (input: {
  analysisReady: boolean;
  classification: PortfolioClassification;
  evidenceCoveragePercent: number;
}) => {
  if (!input.analysisReady) {
    return "Run analysis to compute a real fit score and evidence map.";
  }
  if (input.classification === "Pursue Now" && input.evidenceCoveragePercent < 60) {
    return "Close the remaining evidence gaps, then move straight into drafting.";
  }
  if (input.classification === "Pursue Now") {
    return "Prioritize this one now and move into drafting plus review.";
  }
  if (input.classification === "Revisit Later") {
    return "Keep this warm, then return after higher-confidence grants are moving.";
  }

  return "Deprioritize for now unless new evidence or funder intel changes the fit.";
};

const buildStaffingSummary = (input: {
  availableHoursThisWeek: number;
  recommendations: PortfolioSnapshot["staffingRecommendation"]["recommendations"];
}) => {
  if (input.recommendations.length === 0) {
    return `You have ${input.availableHoursThisWeek} hour${input.availableHoursThisWeek === 1 ? "" : "s"} available this week. No active opportunity is strong enough yet to claim that time.`;
  }

  const parts = input.recommendations.map(
    (recommendation) =>
      `${recommendation.hours} hour${recommendation.hours === 1 ? "" : "s"} on ${recommendation.opportunityTitle}`,
  );

  return `You have ${input.availableHoursThisWeek} hour${input.availableHoursThisWeek === 1 ? "" : "s"} available this week. We recommend spending ${parts.join(", ")}.`;
};

export class PortfolioOptimizerService {
  private readonly notionClient?: NotionMcpClient;
  private readonly logger: LoggerLike;

  constructor(notionClient?: NotionMcpClient, logger?: Partial<LoggerLike>) {
    this.notionClient = notionClient;
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

  async run(input?: {
    organizationId?: string | null;
    clerkUserId?: string | null;
    monthlyStaffHours?: number | null;
    syncToNotion?: boolean;
  }): Promise<PortfolioSnapshot> {
    const organizationId = await resolveOrganizationId(
      input?.organizationId,
      input?.clerkUserId,
    );
    const monthlyStaffHours =
      typeof input?.monthlyStaffHours === "number" && Number.isFinite(input.monthlyStaffHours)
        ? Math.max(0, input.monthlyStaffHours)
        : 80;
    const weeklyStaffHours = round(monthlyStaffHours / 4.33);

    const rows = organizationId
      ? await db.select().from(opportunities).where(eq(opportunities.organizationId, organizationId))
      : await db.select().from(opportunities);
    const activeRows = dedupeOpportunities(rows).filter(
      (row) => !ACTIVE_EXCLUDED_STATUSES.has(normalizeText(row.status)),
    );

    const funderIds = [...new Set(activeRows.map((row) => row.funderId).filter(Boolean))];
    const funderRows = funderIds.length
      ? await db.select().from(funders).where(inArray(funders.id, funderIds))
      : [];
    const funderMap = new Map<string, FunderRow>(funderRows.map((row) => [row.id, row]));

    const rankedWithoutHours = activeRows
      .map((row) => this.toPortfolioOpportunityRecord(row, funderMap.get(row.funderId)))
      .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) {
          return right.priorityScore - left.priorityScore;
        }

        const leftDeadline = left.deadline ? Date.parse(left.deadline) : Number.POSITIVE_INFINITY;
        const rightDeadline = right.deadline ? Date.parse(right.deadline) : Number.POSITIVE_INFINITY;
        if (leftDeadline !== rightDeadline) {
          return leftDeadline - rightDeadline;
        }

        return left.title.localeCompare(right.title);
      });

    const staffingRecommendation = this.buildStaffingRecommendation({
      rankedOpportunities: rankedWithoutHours,
      weeklyStaffHours,
    });

    const rankedOpportunities = rankedWithoutHours.map((record) => ({
      ...record,
      recommendedHoursThisWeek:
        staffingRecommendation.recommendations.find(
          (recommendation) => recommendation.opportunityId === record.id,
        )?.hours ?? 0,
    }));

    let notionSync: PortfolioSnapshot["notionSync"];
    if (input?.syncToNotion && this.notionClient) {
      notionSync = await this.notionClient.syncPortfolioOptimizer({
        monthlyStaffHours,
        weeklyStaffHours,
        rankedOpportunities,
        staffingRecommendation,
      });
    }

    const snapshot: PortfolioSnapshot = {
      organizationId,
      generatedAt: new Date().toISOString(),
      monthlyStaffHours,
      weeklyStaffHours,
      rankedOpportunities,
      summary: {
        totalActive: rankedOpportunities.length,
        pursueNow: rankedOpportunities.filter(
          (record) => record.classification === "Pursue Now",
        ).length,
        revisitLater: rankedOpportunities.filter(
          (record) => record.classification === "Revisit Later",
        ).length,
        skip: rankedOpportunities.filter((record) => record.classification === "Skip").length,
        analysisNeeded: rankedOpportunities.filter((record) => !record.analysisReady).length,
      },
      staffingRecommendation,
      notionSync,
    };

    this.logger.info(
      {
        organizationId,
        totalActive: snapshot.summary.totalActive,
        monthlyStaffHours,
        weeklyStaffHours,
        syncToNotion: Boolean(notionSync),
      },
      "Portfolio optimizer prepared ranking",
    );

    return snapshot;
  }

  private toPortfolioOpportunityRecord(row: OpportunityRow, funder?: FunderRow): PortfolioOpportunityRecord {
    const fitScore = clamp(typeof row.fitScore === "number" ? row.fitScore : 0);
    const evidenceCoveragePercent = clamp(
      typeof row.evidenceCoveragePercent === "number" ? row.evidenceCoveragePercent : 0,
    );
    const effortEstimateHours =
      typeof row.effortEstimateHours === "number" && Number.isFinite(row.effortEstimateHours)
        ? Math.max(0, row.effortEstimateHours)
        : 12;
    const reportingBurdenScore = clamp(
      typeof row.reportingBurdenScore === "number" ? row.reportingBurdenScore : 0,
    );
    const deadlineProximityScore = computeDeadlineProximityScore(row.deadline);
    const analysisReady =
      typeof row.fitScore === "number" &&
      typeof row.evidenceCoveragePercent === "number" &&
      typeof row.effortEstimateHours === "number";
    const priorityScore = analysisReady
      ? round(
          fitScore * 0.4 +
            evidenceCoveragePercent * 0.3 +
            deadlineProximityScore * 0.2 -
            effortEstimateHours * 0.1,
        )
      : 0;
    const classification = deriveClassification({
      storedDecision: row.pursueDecision,
      fitScore,
      evidenceCoveragePercent,
      deadlineProximityScore,
      effortEstimateHours,
      analysisReady,
    });

    return {
      id: row.id,
      organizationId: row.organizationId,
      funderId: row.funderId,
      funderName: normalizeText(funder?.name) || "Unknown funder",
      title: row.title,
      status: row.status,
      deadline: row.deadline,
      fitScore,
      evidenceCoveragePercent,
      effortEstimateHours,
      reportingBurdenScore,
      deadlineProximityScore,
      priorityScore,
      classification,
      pursueDecision: classification,
      recommendedHoursThisWeek: 0,
      analysisReady,
      nextMove: buildNextMove({
        analysisReady,
        classification,
        evidenceCoveragePercent,
      }),
    };
  }

  private buildStaffingRecommendation(input: {
    rankedOpportunities: PortfolioOpportunityRecord[];
    weeklyStaffHours: number;
  }): PortfolioSnapshot["staffingRecommendation"] {
    let remaining = input.weeklyStaffHours;
    const recommendations: PortfolioSnapshot["staffingRecommendation"]["recommendations"] = [];

    for (const opportunity of input.rankedOpportunities) {
      if (remaining <= 0) {
        break;
      }

      if (!opportunity.analysisReady || opportunity.classification === "Skip") {
        continue;
      }

      const targetHours =
        opportunity.classification === "Pursue Now"
          ? opportunity.effortEstimateHours
          : Math.min(opportunity.effortEstimateHours, 4);
      const assignedHours = round(Math.min(targetHours, remaining));

      if (assignedHours <= 0) {
        continue;
      }

      recommendations.push({
        opportunityId: opportunity.id,
        opportunityTitle: opportunity.title,
        hours: assignedHours,
        classification: opportunity.classification,
      });
      remaining = round(Math.max(0, remaining - assignedHours));
    }

    return {
      availableHoursThisWeek: input.weeklyStaffHours,
      allocatedHoursThisWeek: round(
        recommendations.reduce((sum, recommendation) => sum + recommendation.hours, 0),
      ),
      remainingHoursThisWeek: remaining,
      recommendations,
      summary: buildStaffingSummary({
        availableHoursThisWeek: input.weeklyStaffHours,
        recommendations,
      }),
    };
  }
}
