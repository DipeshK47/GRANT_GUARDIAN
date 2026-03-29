import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { funderFilings, funderGrantRows, funders } from "../../db/schema.js";
import type {
  NotionFunderContrastSyncInput,
  NotionMcpClient,
} from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type FunderSnapshot = {
  funderId: string;
  funderName: string;
  givingSummary: string | null;
  averageGrant: number | null;
  medianGrant: number | null;
  geographicFocus: string[];
  grantDnaTopTerms: string[];
  filingCount: number;
  parsedFilingCount: number;
  visibleGrantRows: number;
  topGeographies: string[];
  topCategories: string[];
  largestGrant: number | null;
};

export type FunderContrastInput = {
  leftFunderId: string;
  rightFunderId: string;
  syncToNotion?: boolean;
};

export type FunderContrastResult = {
  title: string;
  left: FunderSnapshot;
  right: FunderSnapshot;
  primaryDifference: string;
  contrastSummary: string;
  recommendedMove: string;
  contrastSignals: string[];
  notionSync?: {
    contrastPageId: string;
  };
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, " ").trim() ?? "";

const parseList = (value?: string | null) =>
  normalizeText(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const formatMoney = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "unknown";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

const describeGrantSignal = (snapshot: FunderSnapshot) => {
  const parts: string[] = [];

  if (typeof snapshot.averageGrant === "number") {
    parts.push(`avg ${formatMoney(snapshot.averageGrant)}`);
  } else if (typeof snapshot.medianGrant === "number") {
    parts.push(`median ${formatMoney(snapshot.medianGrant)}`);
  } else {
    parts.push("grant size still opaque");
  }

  if (snapshot.geographicFocus.length > 0) {
    parts.push(`focus ${snapshot.geographicFocus.slice(0, 3).join("/")}`);
  } else if (snapshot.topGeographies.length > 0) {
    parts.push(`visible geos ${snapshot.topGeographies.slice(0, 3).join("/")}`);
  } else {
    parts.push("geography still unclear");
  }

  if (snapshot.topCategories.length > 0) {
    parts.push(`themes ${snapshot.topCategories.slice(0, 2).join("/")}`);
  } else if (snapshot.grantDnaTopTerms.length > 0) {
    parts.push(`DNA ${snapshot.grantDnaTopTerms.slice(0, 2).join("/")}`);
  } else {
    parts.push("themes still emerging");
  }

  return parts.join(" | ");
};

const classifyScale = (snapshot: FunderSnapshot) => {
  const size = snapshot.averageGrant ?? snapshot.medianGrant ?? snapshot.largestGrant ?? null;
  if (typeof size !== "number") {
    return "unknown";
  }
  if (size >= 100000) {
    return "large-bet";
  }
  if (size <= 25000) {
    return "small-bet";
  }
  return "mid-bet";
};

const classifyGeography = (snapshot: FunderSnapshot) => {
  const values = snapshot.geographicFocus.length > 0 ? snapshot.geographicFocus : snapshot.topGeographies;
  const lowered = values.map((value) => value.toLowerCase());
  if (lowered.some((value) => value.includes("national"))) {
    return "national";
  }
  if (values.length >= 4) {
    return "multi-region";
  }
  if (values.length > 0) {
    return "regional";
  }
  return "unknown";
};

export class FunderContrastService {
  private readonly logger: LoggerLike;

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
  }

  async run(input: FunderContrastInput): Promise<FunderContrastResult> {
    if (!input.leftFunderId || !input.rightFunderId) {
      throw new Error("Funder contrast requires both leftFunderId and rightFunderId.");
    }

    if (input.leftFunderId === input.rightFunderId) {
      throw new Error("Pick two different funders for a meaningful contrast.");
    }

    const [left, right] = await Promise.all([
      this.buildSnapshot(input.leftFunderId),
      this.buildSnapshot(input.rightFunderId),
    ]);

    const title = `990 Contrast: ${left.funderName} vs ${right.funderName}`;
    const primaryDifference = this.buildPrimaryDifference(left, right);
    const contrastSignals = this.buildContrastSignals(left, right);
    const contrastSummary = this.buildContrastSummary(left, right, primaryDifference);
    const recommendedMove = this.buildRecommendedMove(left, right);

    let notionSync: FunderContrastResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      notionSync = await this.notionClient.syncFunderContrast(
        this.toNotionSyncInput({
          title,
          left,
          right,
          primaryDifference,
          contrastSummary,
          recommendedMove,
        }),
      );
    }

    const result: FunderContrastResult = {
      title,
      left,
      right,
      primaryDifference,
      contrastSummary,
      recommendedMove,
      contrastSignals,
      notionSync,
    };

    this.logger.info(
      {
        title,
        leftFunderId: left.funderId,
        rightFunderId: right.funderId,
        notionSync,
      },
      "Funder contrast prepared",
    );

    return result;
  }

  private async buildSnapshot(funderId: string): Promise<FunderSnapshot> {
    const [funder] = await db.select().from(funders).where(eq(funders.id, funderId)).limit(1);
    if (!funder) {
      throw new Error(`No local funder record exists for id '${funderId}'.`);
    }

    const [filings, rows] = await Promise.all([
      db.select().from(funderFilings).where(eq(funderFilings.funderId, funderId)),
      db.select().from(funderGrantRows).where(eq(funderGrantRows.funderId, funderId)),
    ]);

    const topGeographies = new Map<string, number>();
    const topCategories = new Map<string, number>();

    for (const filing of filings) {
      for (const geography of parseList(filing.topGeographies)) {
        topGeographies.set(geography, (topGeographies.get(geography) ?? 0) + 1);
      }
      for (const category of parseList(filing.topCategories)) {
        topCategories.set(category, (topCategories.get(category) ?? 0) + 1);
      }
    }

    return {
      funderId: funder.id,
      funderName: funder.name,
      givingSummary: funder.givingSummary ?? null,
      averageGrant: funder.averageGrant ?? null,
      medianGrant: funder.medianGrant ?? null,
      geographicFocus: parseList(funder.geographicFocus),
      grantDnaTopTerms: parseList(funder.grantDnaTopTerms),
      filingCount: filings.length,
      parsedFilingCount: filings.filter((filing) => filing.parsedStatus === "Parsed").length,
      visibleGrantRows: rows.length,
      topGeographies: this.topEntries(topGeographies),
      topCategories: this.topEntries(topCategories),
      largestGrant:
        rows.reduce<number | null>((largest, row) => {
          if (typeof row.grantAmount !== "number") {
            return largest;
          }
          if (largest === null || row.grantAmount > largest) {
            return row.grantAmount;
          }
          return largest;
        }, null) ?? null,
    };
  }

  private buildPrimaryDifference(left: FunderSnapshot, right: FunderSnapshot) {
    const leftScale = classifyScale(left);
    const rightScale = classifyScale(right);
    if (leftScale !== rightScale && leftScale !== "unknown" && rightScale !== "unknown") {
      return `${left.funderName} shows ${leftScale.replace("-", " ")} behavior while ${right.funderName} shows ${rightScale.replace("-", " ")} behavior.`;
    }

    const leftGeography = classifyGeography(left);
    const rightGeography = classifyGeography(right);
    if (
      leftGeography !== rightGeography &&
      leftGeography !== "unknown" &&
      rightGeography !== "unknown"
    ) {
      return `${left.funderName} looks ${leftGeography.replace("-", " ")} while ${right.funderName} looks ${rightGeography.replace("-", " ")}.`;
    }

    if (left.visibleGrantRows !== right.visibleGrantRows) {
      return `${left.funderName} exposes ${left.visibleGrantRows} visible grant row(s) while ${right.funderName} exposes ${right.visibleGrantRows}, so the evidence depth is very different.`;
    }

    return `${left.funderName} and ${right.funderName} may sound adjacent, but their visible 990 signals suggest different grant size, geography, and evidence expectations.`;
  }

  private buildContrastSignals(left: FunderSnapshot, right: FunderSnapshot) {
    return [
      `${left.funderName}: ${describeGrantSignal(left)}.`,
      `${right.funderName}: ${describeGrantSignal(right)}.`,
      this.buildVisibilitySignal(left, right),
      this.buildThemeSignal(left, right),
    ];
  }

  private buildVisibilitySignal(left: FunderSnapshot, right: FunderSnapshot) {
    const leftSignal =
      left.visibleGrantRows > 0
        ? `${left.visibleGrantRows} visible grant row(s)`
        : `${left.filingCount} filing(s), but no extracted rows yet`;
    const rightSignal =
      right.visibleGrantRows > 0
        ? `${right.visibleGrantRows} visible grant row(s)`
        : `${right.filingCount} filing(s), but no extracted rows yet`;

    return `Evidence depth: ${left.funderName} shows ${leftSignal}; ${right.funderName} shows ${rightSignal}.`;
  }

  private buildThemeSignal(left: FunderSnapshot, right: FunderSnapshot) {
    const leftThemes = left.topCategories.length > 0 ? left.topCategories : left.grantDnaTopTerms;
    const rightThemes =
      right.topCategories.length > 0 ? right.topCategories : right.grantDnaTopTerms;

    if (leftThemes.length === 0 && rightThemes.length === 0) {
      return `Theme contrast: both funders still need richer category extraction, so the safer read comes from grant size and geography.`;
    }

    return `Theme contrast: ${left.funderName} leans ${leftThemes.slice(0, 3).join(", ") || "unclear themes"}, while ${right.funderName} leans ${rightThemes.slice(0, 3).join(", ") || "unclear themes"}.`;
  }

  private buildContrastSummary(
    left: FunderSnapshot,
    right: FunderSnapshot,
    primaryDifference: string,
  ) {
    const leftSummary = normalizeText(left.givingSummary) || `${left.funderName} still needs a clearer giving summary.`;
    const rightSummary =
      normalizeText(right.givingSummary) || `${right.funderName} still needs a clearer giving summary.`;

    return `${primaryDifference} ${leftSummary} ${rightSummary}`;
  }

  private buildRecommendedMove(left: FunderSnapshot, right: FunderSnapshot) {
    const leftScale = classifyScale(left);
    const rightScale = classifyScale(right);

    if (leftScale !== rightScale && leftScale !== "unknown" && rightScale !== "unknown") {
      return "Do not reuse the same ask, budget framing, and evidence posture across both funders. Adjust scope and proof style to match each funder's visible grant size behavior.";
    }

    if (classifyGeography(left) !== classifyGeography(right)) {
      return "Tailor the geography story separately. One funder appears broader in footprint, while the other looks more regional or place-based.";
    }

    return "Use this contrast as a pre-drafting checkpoint so the team does not assume similar-sounding funders want the same proposal shape.";
  }

  private toNotionSyncInput(input: {
    title: string;
    left: FunderSnapshot;
    right: FunderSnapshot;
    primaryDifference: string;
    contrastSummary: string;
    recommendedMove: string;
  }): NotionFunderContrastSyncInput {
    return {
      title: input.title,
      leftFunder: input.left.funderName,
      rightFunder: input.right.funderName,
      leftGrantSignal: describeGrantSignal(input.left),
      rightGrantSignal: describeGrantSignal(input.right),
      primaryDifference: input.primaryDifference,
      contrastSummary: input.contrastSummary,
      recommendedMove: input.recommendedMove,
    };
  }

  private topEntries(map: Map<string, number>) {
    return [...map.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value]) => value);
  }
}
