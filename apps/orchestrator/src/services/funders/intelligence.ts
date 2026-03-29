import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  funderFilings,
  funderGrantRows,
  funders,
  opportunities,
  requirements,
  sourceSnapshots,
} from "../../db/schema.js";
import { AgentProgressService } from "../agent-progress/service.js";
import type { NotionMcpClient } from "../notion/client.js";
import { buildGrantDnaProfile } from "./grant-dna.js";
import {
  ProPublicaClient,
  type ProPublicaFiling,
  type ProPublicaOrganizationResponse,
  type ProPublicaOrganizationSummary,
} from "../propublica/client.js";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

export type FunderIntelligenceInput = {
  funderId?: string;
  name?: string;
  ein?: string;
  website?: string;
  syncToNotion?: boolean;
};

type DerivedFilingRecord = {
  taxYear: number;
  filingType: "990-PF" | "990" | "Other";
  parsedStatus: "Queued" | "Parsed" | "Partial" | "Failed";
  grantCount: number | null;
  totalGrants: number | null;
  sourceUrl: string;
  snapshotPath: string;
};

type DerivedMetrics = FunderIntelligenceResult["metrics"];

type DerivedOrganizationIntelligence = {
  filings: DerivedFilingRecord[];
  metrics: DerivedMetrics;
  givingSummary: string;
  lastResearchedAt: string;
};

type StoredFunderIntelligenceDetails = {
  issueAreaConcentration: string[];
  topGeographies: string[];
  repeatGranteeBiasPercent: number | null;
  grantDna: {
    topTerms: Array<{
      term: string;
      weight: number;
      occurrences: number;
    }>;
    framingStyles: string[];
    toneSummary: string;
  };
  smallOrgFriendly: {
    label: "High" | "Medium" | "Low" | "Needs research";
    explanation: string;
  };
  statedVsActual: {
    stated: string;
    actual: string;
  };
  sourceLine: string;
};

export type FunderIntelligenceResult = {
  funderId: string;
  resolvedOrganization: {
    name: string;
    ein: string;
    strein?: string;
    city?: string;
    state?: string;
    nteeCode?: string;
    subsectionCode?: string;
  };
  metrics: {
    privateFoundationFilings: number;
    latestTaxYear: number | null;
    filingYears: number[];
    annualGrantTotalsAvailable: number;
    totalAnnualGrantAmount: number | null;
    averageGrant: number | null;
    medianGrant: number | null;
    annualGrantRange: string | null;
    geographicFocus: string[];
  };
  localUpdate: {
    givingSummary: string;
    lastResearchedAt: string;
  };
  insights: StoredFunderIntelligenceDetails;
  filings: DerivedFilingRecord[];
  notionSync?: {
    funderPageId: string;
    filingPageIds: string[];
    documentPageIds?: string[];
  };
};

export class FunderIntelligenceService {
  private readonly logger: LoggerLike;
  private readonly progressService: AgentProgressService;

  constructor(
    private readonly config: AppEnv,
    private readonly proPublicaClient: ProPublicaClient,
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

  async run(input: FunderIntelligenceInput): Promise<FunderIntelligenceResult> {
    const runId = randomUUID();
    const localFunder = await this.resolveLocalFunder(input);
    const queryName =
      input.name?.trim() || (input.funderId ? localFunder?.name?.trim() || null : null);
    const queryEin = input.ein?.trim() || null;

    if (!queryName && !queryEin) {
      throw new Error("Funder intelligence requires a funderId, name, or EIN.");
    }

    this.logger.info(
      {
        requestedFunderId: input.funderId ?? null,
        queryName,
        queryEin,
      },
      "Funder intelligence started",
    );

    await this.progressService.record({
      runId,
      agentName: "Funder Intelligence Agent",
      actionDescription: "Started funder enrichment",
      progressLine: "⏳ Resolving funder profile",
      summary: "Looking up the funder in ProPublica and collecting filing metadata.",
      sourceUrl: queryEin ? this.proPublicaClient.buildOrganizationUrl(queryEin) : null,
      funderName: queryName ?? localFunder?.name ?? null,
      followUpRequired: false,
      syncToNotion: input.syncToNotion,
    });

    let resolvedOrganization: ProPublicaOrganizationSummary | null = null;
    let resolvedEin = queryEin ? this.proPublicaClient.normalizeEin(queryEin) : null;
    let organizationResponse: ProPublicaOrganizationResponse | null = null;

    try {
      if (queryEin) {
        organizationResponse = await this.proPublicaClient.fetchOrganization(queryEin);
        resolvedOrganization = organizationResponse.organization;
      } else if (queryName) {
        const searchResponse = await this.proPublicaClient.searchOrganizations(queryName);
        await this.writeSnapshot(
          "propublica-search",
          queryName,
          this.proPublicaClient.buildOrganizationSearchUrl(queryName),
          searchResponse,
        );
        resolvedOrganization = this.pickBestOrganizationMatch(
          queryName,
          searchResponse.organizations,
        );

        if (!resolvedOrganization) {
          throw new Error(`No ProPublica organization match was found for '${queryName}'.`);
        }
      }

      resolvedEin = this.proPublicaClient.normalizeEin(
        queryEin || resolvedOrganization!.ein,
      );
      organizationResponse = await this.proPublicaClient.fetchOrganization(resolvedEin);
    } catch (error) {
      if (this.isRecoverableProPublicaError(error)) {
        this.logger.warn(
          {
            error,
            requestedFunderId: input.funderId ?? null,
            queryName,
            queryEin,
          },
          "ProPublica did not return a usable funder match; continuing with fallback intelligence",
        );
        return await this.buildFallbackResult({
          input,
          localFunder,
          queryName,
          queryEin,
        });
      }

      throw error;
    }

    const organizationSnapshotPath = await this.writeSnapshot(
      "propublica-organization",
      organizationResponse!.organization.name,
      this.proPublicaClient.buildOrganizationUrl(resolvedEin),
      organizationResponse,
    );

    const derived = this.deriveOrganizationIntelligence(
      organizationResponse!,
      organizationSnapshotPath,
    );
    const requestedWebsite = input.website ?? localFunder?.website ?? null;
    const websiteStatement = await this.fetchWebsiteStatement(requestedWebsite);
    const funderId = await this.persistLocalFunder({
      localFunderId: localFunder?.id,
      requestedWebsite,
      response: organizationResponse,
      derived,
      websiteStatement,
    });
    await this.persistFilingRecords(funderId, derived.filings);
    const [currentFilings, currentGrantRows] = await Promise.all([
      db.select().from(funderFilings).where(eq(funderFilings.funderId, funderId)),
      db.select().from(funderGrantRows).where(eq(funderGrantRows.funderId, funderId)),
    ]);
    const rfpTexts = await this.collectFunderRfpTexts(funderId);
    const grantStats = this.summarizeGrantAmounts({
      grantRows: currentGrantRows,
      fallbackAverageGrant: derived.metrics.averageGrant,
      fallbackMedianGrant: derived.metrics.medianGrant,
      fallbackGrantRange: derived.metrics.annualGrantRange,
    });
    const effectiveMetrics = {
      ...derived.metrics,
      averageGrant: grantStats.averageGrant,
      medianGrant: grantStats.medianGrant ?? null,
      annualGrantRange: grantStats.grantRange,
    };
    const insights = this.buildStoredFunderInsights({
      derived: {
        ...derived,
        metrics: effectiveMetrics,
      },
      filingRows: currentFilings,
      grantRows: currentGrantRows,
      websiteStatement,
      rfpTexts,
    });
    await this.persistFunderInsightDetails({
      funderId,
      insights,
      topGeographies:
        insights.topGeographies.length > 0
          ? insights.topGeographies
          : derived.metrics.geographicFocus,
      averageGrant: grantStats.averageGrant,
      medianGrant: grantStats.medianGrant ?? null,
      grantRange: grantStats.grantRange,
      websiteStatement,
    });

    let notionSync: FunderIntelligenceResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      notionSync = await this.notionClient.syncFunderIntelligence({
        funderName: organizationResponse!.organization.name,
        ein: organizationResponse!.organization.strein ?? resolvedEin,
        website: requestedWebsite,
        issueAreas: insights.issueAreaConcentration,
        givingSummary: this.buildNotionGivingSummary({
          givingSummary: derived.givingSummary,
          insights,
        }),
        averageGrant: grantStats.averageGrant,
        medianGrant: grantStats.medianGrant,
        geographicFocus:
          insights.topGeographies.length > 0
            ? insights.topGeographies
            : derived.metrics.geographicFocus,
        grantDnaTopTerms:
          insights.grantDna.topTerms.map((term) => term.term).join(", ") ||
          "Grant DNA is still thin and needs more source text",
        framingStyle: insights.grantDna.framingStyles.join(" · ") || null,
        toneSummary: insights.grantDna.toneSummary,
        notes: websiteStatement ?? null,
        smallOrgFriendly: this.toNotionSmallOrgFriendly(insights.smallOrgFriendly.label),
        filings: derived.filings.map((filing) => ({
          taxYear: filing.taxYear,
          filingType: filing.filingType,
          parsedStatus: filing.parsedStatus,
          grantCount: filing.grantCount,
          totalGrants: filing.totalGrants,
          sourceUrl: filing.sourceUrl,
        })),
      });
    }

    await this.progressService.record({
      runId,
      agentName: "Funder Intelligence Agent",
      actionDescription: "Resolved a funder in ProPublica and stored filing intelligence",
      progressLine: "✅ Funder resolved",
      summary: `Matched ${organizationResponse.organization.name} and queued ${derived.metrics.privateFoundationFilings} filing${derived.metrics.privateFoundationFilings === 1 ? "" : "s"} for deeper 990 analysis.`,
      sourceUrl: this.proPublicaClient.buildOrganizationUrl(resolvedEin),
      confidenceLevel: derived.metrics.privateFoundationFilings > 0 ? 0.88 : 0.72,
      followUpRequired: derived.metrics.privateFoundationFilings === 0,
      funderName: organizationResponse!.organization.name,
      targetPageId: notionSync?.funderPageId,
      syncToNotion: input.syncToNotion,
    });

    this.logger.info(
      {
        funderId,
        funderName: organizationResponse!.organization.name,
        latestTaxYear: derived.metrics.latestTaxYear,
        privateFoundationFilings: derived.metrics.privateFoundationFilings,
      },
      "Funder intelligence completed",
    );

    return {
      funderId,
      resolvedOrganization: {
        name: organizationResponse!.organization.name,
        ein: resolvedEin,
        strein: organizationResponse!.organization.strein,
        city: this.toOptionalString(organizationResponse!.organization.city) ?? undefined,
        state: this.toOptionalString(organizationResponse!.organization.state) ?? undefined,
        nteeCode:
          this.toOptionalString(organizationResponse!.organization.ntee_code) ?? undefined,
        subsectionCode:
          this.toOptionalString(organizationResponse!.organization.subseccd) ?? undefined,
      },
      metrics: effectiveMetrics,
      localUpdate: {
        givingSummary: derived.givingSummary,
        lastResearchedAt: derived.lastResearchedAt,
      },
      insights,
      filings: derived.filings,
      notionSync,
    };
  }

  private isRecoverableProPublicaError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes("ProPublica request failed: 404") ||
      error.message.includes("No ProPublica organization match was found")
    );
  }

  private async buildFallbackResult(input: {
    input: FunderIntelligenceInput;
    localFunder: typeof funders.$inferSelect | null;
    queryName: string | null;
    queryEin: string | null;
  }): Promise<FunderIntelligenceResult> {
    const funderName =
      input.localFunder?.name ??
      input.queryName ??
      "Unresolved funder";
    const funderId = input.localFunder?.id ?? randomUUID();
    const website = input.input.website ?? input.localFunder?.website ?? null;
    const websiteStatement = await this.fetchWebsiteStatement(website);
    const lastResearchedAt = new Date().toISOString();
    const rfpTexts = input.localFunder?.id
      ? await this.collectFunderRfpTexts(input.localFunder.id)
      : [];
    const metrics: FunderIntelligenceResult["metrics"] = {
      privateFoundationFilings: 0,
      latestTaxYear: null,
      filingYears: [],
      annualGrantTotalsAvailable: 0,
      totalAnnualGrantAmount: null,
      averageGrant: input.localFunder?.averageGrant ?? null,
      medianGrant: input.localFunder?.medianGrant ?? null,
      annualGrantRange: input.localFunder?.grantRange ?? null,
      geographicFocus: this.parseCommaSeparated(input.localFunder?.geographicFocus),
    };
    const insights: StoredFunderIntelligenceDetails = {
      issueAreaConcentration: [],
      topGeographies: metrics.geographicFocus,
      repeatGranteeBiasPercent: null,
      grantDna: buildGrantDnaProfile({
        websiteText: websiteStatement,
        rfpTexts,
      }),
      smallOrgFriendly: {
        label: "Needs research",
        explanation:
          "ProPublica did not return a usable filing match for this funder yet, so small-org friendliness still needs manual review.",
      },
      statedVsActual: {
        stated:
          this.toOptionalString(websiteStatement) ??
          "Website positioning has not been captured yet for this funder.",
        actual:
          "No usable ProPublica 990-PF or 990 filing match was returned for this funder yet. Grant Guardian can still score the opportunity from your mission, evidence, and deadline, but filing-backed funder intelligence is incomplete.",
      },
      sourceLine: "No 990-PF or 990 filing match was available from ProPublica for this funder yet.",
    };
    const givingSummary =
      "ProPublica did not return a usable 990-PF or 990 filing match for this funder yet. Filing-backed grant intelligence is incomplete, so this funder currently relies on local opportunity context and any website statement that could be captured.";

    if (input.localFunder?.id) {
      await db
        .update(funders)
        .set({
          website,
          givingSummary,
          averageGrant: metrics.averageGrant,
          medianGrant: metrics.medianGrant,
          grantRange: metrics.annualGrantRange,
          geographicFocus: metrics.geographicFocus.join(", ") || null,
          prioritySignals:
          this.toOptionalString(websiteStatement) ?? input.localFunder.prioritySignals ?? null,
          grantDnaTopTerms:
            insights.grantDna.topTerms.map((term) => term.term).join(", ") || null,
          narrativeStyle: insights.grantDna.framingStyles.join(" · ") || null,
          toneNotes: insights.grantDna.toneSummary,
          relationshipHistory: JSON.stringify(insights),
          lastResearchedAt,
          updatedAt: lastResearchedAt,
        })
        .where(eq(funders.id, input.localFunder.id));
    }

    let notionSync: FunderIntelligenceResult["notionSync"];
    if (input.input.syncToNotion && this.notionClient) {
      notionSync = await this.notionClient.syncFunderIntelligence({
        funderName,
        ein: input.queryEin ?? input.localFunder?.ein ?? null,
        website,
        issueAreas: insights.issueAreaConcentration,
        givingSummary: this.buildNotionGivingSummary({
          givingSummary,
          insights,
        }),
        averageGrant: metrics.averageGrant,
        medianGrant: metrics.medianGrant,
        geographicFocus: metrics.geographicFocus,
        grantDnaTopTerms:
          insights.grantDna.topTerms.map((term) => term.term).join(", ") ||
          "Grant DNA is still thin and needs more source text",
        framingStyle: insights.grantDna.framingStyles.join(" · ") || null,
        toneSummary: insights.grantDna.toneSummary,
        notes: websiteStatement ?? null,
        smallOrgFriendly: this.toNotionSmallOrgFriendly(insights.smallOrgFriendly.label),
        filings: [],
      });
    }

    return {
      funderId,
      resolvedOrganization: {
        name: funderName,
        ein: input.queryEin ?? input.localFunder?.ein ?? "",
        city: undefined,
        state: undefined,
        nteeCode: undefined,
        subsectionCode: undefined,
      },
      metrics,
      localUpdate: {
        givingSummary,
        lastResearchedAt,
      },
      insights,
      filings: [],
      notionSync,
    };
  }

  private async resolveLocalFunder(input: FunderIntelligenceInput) {
    if (input.funderId) {
      const [record] = await db
        .select()
        .from(funders)
        .where(eq(funders.id, input.funderId))
        .limit(1);

      if (!record) {
        throw new Error(`No local funder record exists for id '${input.funderId}'.`);
      }

      return record;
    }

    if (input.ein) {
      const normalizedEin = this.proPublicaClient.normalizeEin(input.ein);
      const [record] = await db
        .select()
        .from(funders)
        .where(eq(funders.ein, normalizedEin))
        .limit(1);
      if (record) {
        return record;
      }
    }

    if (input.name) {
      const [record] = await db
        .select()
        .from(funders)
        .where(eq(funders.name, input.name))
        .limit(1);
      if (record) {
        return record;
      }
    }

    return null;
  }

  private pickBestOrganizationMatch(
    query: string,
    organizations: ProPublicaOrganizationSummary[],
  ) {
    const normalizedQuery = this.normalizeForMatch(query);
    const scored = organizations
      .map((organization) => ({
        organization,
        score: this.scoreOrganizationMatch(normalizedQuery, organization),
      }))
      .sort((left, right) => right.score - left.score);

    const topMatch = scored[0];
    return topMatch && topMatch.score > 0 ? topMatch.organization : null;
  }

  private scoreOrganizationMatch(
    normalizedQuery: string,
    organization: ProPublicaOrganizationSummary,
  ) {
    const normalizedName = this.normalizeForMatch(organization.name);
    let score = 0;

    if (normalizedName === normalizedQuery) {
      score += 100;
    }

    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
      score += 60;
    }

    const queryTokens = normalizedQuery.split(" ").filter(Boolean);
    const nameTokens = new Set(normalizedName.split(" ").filter(Boolean));
    for (const token of queryTokens) {
      if (nameTokens.has(token)) {
        score += 8;
      }
    }

    if (normalizedName.includes("foundation")) {
      score += 10;
    }

    return score;
  }

  private deriveOrganizationIntelligence(
    response: ProPublicaOrganizationResponse,
    snapshotPath: string,
  ): DerivedOrganizationIntelligence {
    const filings = this.collectPreferredFilings(response, snapshotPath);
    const grantTotals = filings
      .map((filing) => filing.totalGrants)
      .filter((value): value is number => typeof value === "number" && value >= 0);
    const perGrantAverages: number[] = [];
    for (const filing of filings) {
      if (
        typeof filing.grantCount === "number" &&
        filing.grantCount > 0 &&
        typeof filing.totalGrants === "number" &&
        filing.totalGrants >= 0
      ) {
        perGrantAverages.push(filing.totalGrants / filing.grantCount);
      }
    }

    const geographicFocus = [
      this.toOptionalString(response.organization.city),
      this.toOptionalString(response.organization.state),
    ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index) as string[];

    const latestTaxYear =
      filings.length > 0 ? Math.max(...filings.map((filing) => filing.taxYear)) : null;
    const totalAnnualGrantAmount =
      grantTotals.length > 0
        ? grantTotals.reduce((sum, value) => sum + value, 0)
        : null;
    const annualGrantRange =
      grantTotals.length > 0
        ? `${this.formatCurrency(Math.min(...grantTotals))} - ${this.formatCurrency(Math.max(...grantTotals))}`
        : null;
    const givingSummary = this.buildGivingSummary({
      organization: response.organization,
      filingCount: filings.length,
      latestTaxYear,
      annualGrantRange,
      grantTotalsAvailable: grantTotals.length,
      pdfLinkedFilings: filings.filter((filing) => filing.sourceUrl.includes("http")).length,
      filingTypeLabel: this.describeFilingTypes(filings),
    });

    return {
      filings,
      metrics: {
        privateFoundationFilings: filings.length,
        latestTaxYear,
        filingYears: filings.map((filing) => filing.taxYear).sort((a, b) => b - a),
        annualGrantTotalsAvailable: grantTotals.length,
        totalAnnualGrantAmount,
        averageGrant:
          perGrantAverages.length > 0 ? this.average(perGrantAverages) : null,
        medianGrant:
          perGrantAverages.length > 0 ? this.median(perGrantAverages) : null,
        annualGrantRange,
        geographicFocus,
      },
      givingSummary,
      lastResearchedAt: new Date().toISOString(),
    };
  }

  private collectPreferredFilings(
    response: ProPublicaOrganizationResponse,
    snapshotPath: string,
  ): DerivedFilingRecord[] {
    const privateFoundationFilings = this.collectFilingsByType(
      response,
      snapshotPath,
      "990-PF",
    );
    if (privateFoundationFilings.length > 0) {
      return privateFoundationFilings;
    }

    return this.collectFilingsByType(response, snapshotPath, "990");
  }

  private collectFilingsByType(
    response: ProPublicaOrganizationResponse,
    snapshotPath: string,
    targetType: DerivedFilingRecord["filingType"],
  ): DerivedFilingRecord[] {
    const allFilings = [
      ...(response.filings_with_data ?? []),
      ...(response.filings_without_data ?? []),
    ];
    const seen = new Set<string>();
    const derived: DerivedFilingRecord[] = [];

    for (const filing of allFilings) {
      if (this.normalizeFormType(filing.formtype) !== targetType) {
        continue;
      }

      const taxYear = this.toNumber(filing.tax_prd_yr);
      if (!taxYear) {
        continue;
      }

      const dedupeKey = `${taxYear}:${filing.pdf_url ?? "none"}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const totalGrants = this.extractGrantTotal(filing);
      const grantCount = this.extractGrantCount(filing);
      const pdfUrl = this.toOptionalString(filing.pdf_url);
      if (!pdfUrl && totalGrants === null && grantCount === null) {
        continue;
      }
      const parsedStatus: DerivedFilingRecord["parsedStatus"] =
        totalGrants !== null && grantCount !== null
          ? "Parsed"
          : totalGrants !== null || grantCount !== null
            ? "Partial"
            : "Queued";

      derived.push({
        taxYear,
        filingType: targetType,
        parsedStatus,
        grantCount,
        totalGrants,
        sourceUrl:
          pdfUrl ??
          this.proPublicaClient.buildExplorerOrganizationUrl(response.organization.ein),
        snapshotPath,
      });
    }

    return derived.sort((left, right) => right.taxYear - left.taxYear);
  }

  private extractGrantTotal(filing: ProPublicaFiling) {
    const numericEntries = this.collectNumericEntries(filing);
    const exactPriority = [
      "charitabledistrib",
      "contributionsgiftsgrantspaid",
      "grantspaid",
      "grantspaidduringyear",
      "qualifyingdistributions",
      "qualifyingdistrib",
      "grantstotal",
      "grantsamountpaid",
    ];

    for (const key of exactPriority) {
      const matched = numericEntries.find(([entryKey]) => entryKey === key);
      if (matched) {
        return matched[1];
      }
    }

    const filtered = numericEntries
      .filter(([key]) => {
        if (/future|approved|payable|liab|liabil|officer|salary|compens|tax|asset/i.test(key)) {
          return false;
        }

        return /(grant|charit|qualifying)/i.test(key);
      })
      .sort(
        (left, right) => this.rankGrantTotalKey(right[0]) - this.rankGrantTotalKey(left[0]),
      );

    return filtered[0]?.[1] ?? null;
  }

  private extractGrantCount(filing: ProPublicaFiling) {
    const numericEntries = this.collectNumericEntries(filing)
      .filter(([key, value]) => {
        if (!Number.isInteger(value) || value < 0 || value > 100000) {
          return false;
        }

        return /grant.*count|count.*grant|number.*grant|grant.*number|grantscnt/i.test(key);
      })
      .sort(
        (left, right) => this.rankGrantCountKey(right[0]) - this.rankGrantCountKey(left[0]),
      );

    return numericEntries[0]?.[1] ?? null;
  }

  private collectNumericEntries(filing: ProPublicaFiling) {
    return Object.entries(filing)
      .map(([key, value]) => [key.toLowerCase(), this.toNumber(value)] as const)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number");
  }

  private rankGrantTotalKey(key: string) {
    if (/charit.*distrib|distrib.*charit/i.test(key)) {
      return 100;
    }
    if (/grant.*paid|paid.*grant/i.test(key)) {
      return 90;
    }
    if (/qualifying.*distrib/i.test(key)) {
      return 80;
    }
    if (/grant/i.test(key)) {
      return 40;
    }
    return 0;
  }

  private rankGrantCountKey(key: string) {
    if (/grant.*count|count.*grant/i.test(key)) {
      return 100;
    }
    if (/number.*grant|grant.*number/i.test(key)) {
      return 80;
    }
    return 10;
  }

  private async persistLocalFunder(input: {
    localFunderId?: string;
    requestedWebsite?: string | null;
    response: ProPublicaOrganizationResponse;
    derived: {
      metrics: FunderIntelligenceResult["metrics"];
      givingSummary: string;
      lastResearchedAt: string;
      filings: DerivedFilingRecord[];
    };
    websiteStatement?: string | null;
  }) {
    const ein = this.proPublicaClient.normalizeEin(input.response.organization.ein);
    const website = input.requestedWebsite ?? null;
    const geographicFocus = input.derived.metrics.geographicFocus.join(", ");

    if (input.localFunderId) {
      const [existing] = await db
        .select()
        .from(funders)
        .where(eq(funders.id, input.localFunderId))
        .limit(1);

      await db
        .update(funders)
        .set({
          name: input.response.organization.name,
          ein,
          website,
          givingSummary: this.pickPreferredSummary(
            existing?.givingSummary ?? null,
            input.derived.givingSummary,
            input.derived.metrics,
          ),
          averageGrant:
            input.derived.metrics.averageGrant ?? existing?.averageGrant ?? null,
          medianGrant:
            input.derived.metrics.medianGrant ?? existing?.medianGrant ?? null,
          grantRange:
            input.derived.metrics.annualGrantRange ?? existing?.grantRange ?? null,
          geographicFocus: geographicFocus || existing?.geographicFocus || null,
          prioritySignals:
            input.websiteStatement ??
            `ProPublica resolved ${input.derived.metrics.privateFoundationFilings} ${this.describeFilingTypes(input.derived.filings)} filing(s).`,
          lastResearchedAt: input.derived.lastResearchedAt,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(funders.id, input.localFunderId));

      return input.localFunderId;
    }

    const [existingByEin] = await db
      .select()
      .from(funders)
      .where(eq(funders.ein, ein))
      .limit(1);

    if (existingByEin) {
      await db
        .update(funders)
        .set({
          name: input.response.organization.name,
          website,
          givingSummary: this.pickPreferredSummary(
            existingByEin.givingSummary ?? null,
            input.derived.givingSummary,
            input.derived.metrics,
          ),
          averageGrant:
            input.derived.metrics.averageGrant ?? existingByEin.averageGrant ?? null,
          medianGrant:
            input.derived.metrics.medianGrant ?? existingByEin.medianGrant ?? null,
          grantRange:
            input.derived.metrics.annualGrantRange ?? existingByEin.grantRange ?? null,
          geographicFocus: geographicFocus || existingByEin.geographicFocus || null,
          prioritySignals:
            input.websiteStatement ??
            `ProPublica resolved ${input.derived.metrics.privateFoundationFilings} ${this.describeFilingTypes(input.derived.filings)} filing(s).`,
          lastResearchedAt: input.derived.lastResearchedAt,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(funders.id, existingByEin.id));
      return existingByEin.id;
    }

    const funderId = randomUUID();
    await db.insert(funders).values({
      id: funderId,
      name: input.response.organization.name,
      ein,
      website,
      givingSummary: input.derived.givingSummary,
      averageGrant: input.derived.metrics.averageGrant,
      medianGrant: input.derived.metrics.medianGrant,
      grantRange: input.derived.metrics.annualGrantRange,
      geographicFocus,
      prioritySignals:
        input.websiteStatement ??
        `ProPublica resolved ${input.derived.metrics.privateFoundationFilings} ${this.describeFilingTypes(input.derived.filings)} filing(s).`,
      lastResearchedAt: input.derived.lastResearchedAt,
    });

    return funderId;
  }

  private async persistFilingRecords(
    funderId: string,
    filings: DerivedFilingRecord[],
  ) {
    const existing = await db
      .select()
      .from(funderFilings)
      .where(eq(funderFilings.funderId, funderId));

    for (const filing of filings) {
      const matching = this.selectCanonicalStoredFilingRecord(
        existing.filter((record) => record.taxYear === filing.taxYear),
      );
      if (matching) {
        const preserveExisting = this.shouldPreserveExistingFiling(matching, filing);
        await db
          .update(funderFilings)
          .set({
            filingType: filing.filingType,
            sourceUrl: filing.sourceUrl,
            parsedStatus: preserveExisting
              ? this.toFilingParsedStatus(matching.parsedStatus)
              : filing.parsedStatus,
            grantsCount: preserveExisting
              ? matching.grantsCount
              : filing.grantCount ?? matching.grantsCount,
            grantsTotalAmount: preserveExisting
              ? matching.grantsTotalAmount
              : filing.totalGrants ?? matching.grantsTotalAmount,
            topGeographies: preserveExisting
              ? matching.topGeographies
              : matching.topGeographies ?? null,
            topCategories: preserveExisting
              ? matching.topCategories
              : matching.topCategories ?? null,
            snapshotPath: preserveExisting
              ? matching.snapshotPath
              : filing.snapshotPath,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(funderFilings.id, matching.id));
        continue;
      }

      await db.insert(funderFilings).values({
        id: randomUUID(),
        funderId,
        taxYear: filing.taxYear,
        filingType: filing.filingType,
        sourceUrl: filing.sourceUrl,
        parsedStatus: filing.parsedStatus,
        grantsCount: filing.grantCount,
        grantsTotalAmount: filing.totalGrants,
        snapshotPath: filing.snapshotPath,
      });
    }

    await this.cleanupDuplicateStoredFilingRecords(funderId);
  }

  private selectCanonicalStoredFilingRecord(
    rows: Array<typeof funderFilings.$inferSelect>,
  ) {
    return [...rows].sort((left, right) => {
      const statusDelta =
        this.rankParsedStatus(this.toFilingParsedStatus(right.parsedStatus)) -
        this.rankParsedStatus(this.toFilingParsedStatus(left.parsedStatus));
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const pdfDelta = Number(this.isPdfSource(right.sourceUrl)) - Number(this.isPdfSource(left.sourceUrl));
      if (pdfDelta !== 0) {
        return pdfDelta;
      }

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })[0];
  }

  private async cleanupDuplicateStoredFilingRecords(funderId: string) {
    const existing = await db
      .select()
      .from(funderFilings)
      .where(eq(funderFilings.funderId, funderId));

    const rowsByTaxYear = new Map<number, Array<typeof funderFilings.$inferSelect>>();
    for (const row of existing) {
      const current = rowsByTaxYear.get(row.taxYear) ?? [];
      current.push(row);
      rowsByTaxYear.set(row.taxYear, current);
    }

    for (const rows of rowsByTaxYear.values()) {
      if (rows.length <= 1) {
        continue;
      }

      const canonical = this.selectCanonicalStoredFilingRecord(rows);
      if (!canonical) {
        continue;
      }

      for (const duplicate of rows) {
        if (duplicate.id === canonical.id) {
          continue;
        }

        const [grantRowReference] = await db
          .select({ id: funderGrantRows.id })
          .from(funderGrantRows)
          .where(eq(funderGrantRows.filingId, duplicate.id))
          .limit(1);
        if (grantRowReference) {
          continue;
        }

        await db.delete(funderFilings).where(eq(funderFilings.id, duplicate.id));
      }
    }
  }

  private async writeSnapshot(
    sourceType: string,
    name: string,
    sourceUrl: string,
    payload: unknown,
  ) {
    const baseDir = this.resolveProjectPath(this.config.SNAPSHOT_DIR);
    const slug = this.slugify(name);
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const directory = resolve(baseDir, "propublica", slug);
    await mkdir(directory, { recursive: true });
    const filePath = resolve(directory, `${Date.now()}-${sourceType}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

    await db.insert(sourceSnapshots).values({
      id: randomUUID(),
      sourceType,
      sourceUrl,
      contentHash: hash,
      localPath: filePath,
      parsedMetadata: JSON.stringify({
        name,
        savedAt: new Date().toISOString(),
      }),
    });

    return filePath;
  }

  private buildGivingSummary(input: {
    organization: ProPublicaOrganizationSummary;
    filingCount: number;
    latestTaxYear: number | null;
    annualGrantRange: string | null;
    grantTotalsAvailable: number;
    pdfLinkedFilings: number;
    filingTypeLabel: string;
  }) {
    const orgName = input.organization.name;
    const strein =
      this.toOptionalString(input.organization.strein) ??
      this.proPublicaClient.normalizeEin(input.organization.ein);
    const place = [
      this.toOptionalString(input.organization.city),
      this.toOptionalString(input.organization.state),
    ]
      .filter(Boolean)
      .join(", ");

    const foundationLine =
      input.filingCount > 0
        ? `Found ${input.filingCount} ${input.filingTypeLabel} filing${input.filingCount === 1 ? "" : "s"}${input.latestTaxYear ? ` through tax year ${input.latestTaxYear}` : ""}.`
        : "No usable 990-PF or 990 filings were surfaced in the current ProPublica response.";

    const grantLine =
      input.grantTotalsAvailable > 0 && input.annualGrantRange
        ? `Annual charitable distributions visible in the filing metadata range from ${input.annualGrantRange}.`
        : "Detailed annual grant totals were not consistently exposed in the filing metadata, so recipient-level grant sizing still needs XML/PDF parsing.";

    const pdfLine =
      input.pdfLinkedFilings > 0
        ? `${input.pdfLinkedFilings} filing records include a linked source document for deeper parsing.`
        : "No linked filing documents were present in the response used for this run.";

    return `${orgName}${place ? ` (${place})` : ""} appears in ProPublica Nonprofit Explorer as EIN ${strein}. ${foundationLine} ${grantLine} ${pdfLine}`;
  }

  private buildStoredFunderInsights(input: {
    derived: DerivedOrganizationIntelligence;
    filingRows: Array<typeof funderFilings.$inferSelect>;
    grantRows: Array<typeof funderGrantRows.$inferSelect>;
    websiteStatement?: string | null;
    rfpTexts?: string[];
  }): StoredFunderIntelligenceDetails {
    const grantStats = this.summarizeGrantAmounts({
      grantRows: input.grantRows,
      fallbackAverageGrant: input.derived.metrics.averageGrant,
      fallbackMedianGrant: input.derived.metrics.medianGrant,
      fallbackGrantRange: input.derived.metrics.annualGrantRange,
    });
    const issueAreaConcentration = this.computeIssueAreaConcentration(
      input.filingRows,
      input.grantRows,
    );
    const topGeographies =
      this.computeTopGeographies(input.filingRows, input.grantRows).length > 0
        ? this.computeTopGeographies(input.filingRows, input.grantRows)
        : input.derived.metrics.geographicFocus;
    const actual = [
      input.derived.givingSummary,
      grantStats.averageGrant !== null || grantStats.medianGrant !== null
        ? `Visible grant sizing currently averages ${this.formatCurrency(grantStats.averageGrant ?? null)} with a median of ${this.formatCurrency(grantStats.medianGrant ?? null)}${grantStats.grantRange ? ` and a visible range of ${grantStats.grantRange}` : ""}.`
        : null,
      issueAreaConcentration.length > 0
        ? `Issue area concentration leans toward ${issueAreaConcentration.join(", ")}.`
        : null,
      typeof this.computeRepeatGranteeBiasPercent(input.grantRows) === "number"
        ? `${this.computeRepeatGranteeBiasPercent(input.grantRows)}% of visible grants went to recipients that appear more than once in the parsed grant rows.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    const filingYears = input.filingRows
      .map((row) => row.taxYear)
      .filter((value): value is number => typeof value === "number");
    const grantDna = buildGrantDnaProfile({
      websiteText: input.websiteStatement,
      rfpTexts: input.rfpTexts,
      filingPurposeTexts: input.grantRows.flatMap((row) =>
        [row.purpose, row.rawText].filter((value): value is string => Boolean(value)),
      ),
    });

    return {
      issueAreaConcentration,
      topGeographies,
      repeatGranteeBiasPercent: this.computeRepeatGranteeBiasPercent(input.grantRows),
      grantDna,
      smallOrgFriendly: this.classifySmallOrgFriendly(
        grantStats.medianGrant ?? grantStats.averageGrant ?? null,
      ),
      statedVsActual: {
        stated:
          this.toOptionalString(input.websiteStatement) ??
          "Website positioning has not been captured yet for this funder.",
        actual:
          actual ||
          "The filings do not yet expose enough recipient-level detail to summarize actual giving behavior confidently.",
      },
      sourceLine: `Based on ${this.describeFilingTypes(input.derived.filings)} filings from ${this.formatYearRange(
        filingYears.length > 0 ? filingYears : input.derived.metrics.filingYears,
      )} via ProPublica.`,
    };
  }

  private async persistFunderInsightDetails(input: {
    funderId: string;
    insights: StoredFunderIntelligenceDetails;
    topGeographies: string[];
    averageGrant: number | null;
    medianGrant: number | null;
    grantRange: string | null;
    websiteStatement?: string | null;
  }) {
    await db
      .update(funders)
      .set({
        averageGrant: input.averageGrant,
        medianGrant: input.medianGrant,
        grantRange: input.grantRange,
        geographicFocus: input.topGeographies.join(", ") || null,
        grantDnaTopTerms:
          input.insights.grantDna.topTerms.map((term) => term.term).join(", ") || null,
        narrativeStyle: input.insights.grantDna.framingStyles.join(" · ") || null,
        prioritySignals:
          this.toOptionalString(input.websiteStatement) ?? input.insights.statedVsActual.stated,
        toneNotes: input.insights.grantDna.toneSummary,
        relationshipHistory: JSON.stringify(input.insights),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(funders.id, input.funderId));
  }

  private buildNotionGivingSummary(input: {
    givingSummary: string;
    insights: StoredFunderIntelligenceDetails;
  }) {
    const lines = [
      input.givingSummary,
      `Website says: ${input.insights.statedVsActual.stated}`,
      `Filings show: ${input.insights.statedVsActual.actual}`,
      input.insights.issueAreaConcentration.length > 0
        ? `Issue area concentration: ${input.insights.issueAreaConcentration.join(", ")}`
        : null,
      typeof input.insights.repeatGranteeBiasPercent === "number"
        ? `Repeat grantee bias: ${input.insights.repeatGranteeBiasPercent}%`
        : null,
      input.insights.grantDna.framingStyles.length > 0
        ? `Framing style: ${input.insights.grantDna.framingStyles.join(" · ")}`
        : null,
      input.insights.grantDna.toneSummary,
      input.insights.sourceLine,
    ].filter(Boolean);

    return lines.join(" ");
  }

  private toNotionSmallOrgFriendly(
    label: StoredFunderIntelligenceDetails["smallOrgFriendly"]["label"],
  ): "High" | "Medium" | "Needs Review" {
    if (label === "High") {
      return "High";
    }

    if (label === "Medium") {
      return "Medium";
    }

    return "Needs Review";
  }

  private computeIssueAreaConcentration(
    filingRows: Array<typeof funderFilings.$inferSelect>,
    grantRows: Array<typeof funderGrantRows.$inferSelect>,
  ) {
    const counts = new Map<string, number>();
    const filingCategories = filingRows.flatMap((row) =>
      this.parseCommaSeparated(row.topCategories),
    );

    for (const category of filingCategories) {
      counts.set(category, (counts.get(category) ?? 0) + 2);
    }

    for (const row of grantRows) {
      for (const category of this.categorizePurposeText(
        [row.purpose, row.rawText].filter(Boolean).join(" "),
      )) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value]) => value);
  }

  private async collectFunderRfpTexts(funderId: string) {
    const funderOpportunities = await db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        rationale: opportunities.rationale,
      })
      .from(opportunities)
      .where(eq(opportunities.funderId, funderId));

    if (funderOpportunities.length === 0) {
      return [] as string[];
    }

    const opportunityIds = funderOpportunities.map((row) => row.id);
    const funderRequirements = await db
      .select({
        opportunityId: requirements.opportunityId,
        questionText: requirements.questionText,
        requirementType: requirements.requirementType,
      })
      .from(requirements)
      .where(inArray(requirements.opportunityId, opportunityIds));

    return funderOpportunities
      .map((opportunity) => {
        const requirementText = funderRequirements
          .filter((row) => row.opportunityId === opportunity.id)
          .map((row) =>
            [row.requirementType, row.questionText].filter(Boolean).join(": "),
          )
          .join(" ");

        return normalizeText(
          [opportunity.title, opportunity.rationale, requirementText].filter(Boolean).join(" "),
        );
      })
      .filter(Boolean);
  }

  private computeTopGeographies(
    filingRows: Array<typeof funderFilings.$inferSelect>,
    grantRows: Array<typeof funderGrantRows.$inferSelect>,
  ) {
    const counts = new Map<string, number>();

    for (const value of filingRows.flatMap((row) => this.parseCommaSeparated(row.topGeographies))) {
      counts.set(value, (counts.get(value) ?? 0) + 2);
    }

    for (const value of grantRows.flatMap((row) => [row.recipientState, row.recipientCity])) {
      const normalized = this.toOptionalString(value);
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value]) => value);
  }

  private computeRepeatGranteeBiasPercent(rows: Array<typeof funderGrantRows.$inferSelect>) {
    if (rows.length === 0) {
      return null;
    }

    const counts = new Map<string, number>();
    for (const row of rows) {
      const recipientKey = this.toOptionalString(row.recipientEin || row.recipientName)
        ?.toLowerCase()
        .trim();
      if (!recipientKey) {
        continue;
      }
      counts.set(recipientKey, (counts.get(recipientKey) ?? 0) + 1);
    }

    const repeatRows = rows.filter((row) => {
      const recipientKey = this.toOptionalString(row.recipientEin || row.recipientName)
        ?.toLowerCase()
        .trim();
      return recipientKey ? (counts.get(recipientKey) ?? 0) > 1 : false;
    }).length;

    return Math.round((repeatRows / rows.length) * 100);
  }

  private summarizeGrantAmounts(input: {
    grantRows: Array<typeof funderGrantRows.$inferSelect>;
    fallbackAverageGrant: number | null;
    fallbackMedianGrant: number | null;
    fallbackGrantRange: string | null;
  }) {
    const amounts = input.grantRows
      .map((row) => row.grantAmount)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => left - right);

    if (amounts.length === 0) {
      return {
        averageGrant: input.fallbackAverageGrant,
        medianGrant: input.fallbackMedianGrant,
        grantRange: input.fallbackGrantRange,
      };
    }

    const averageGrant = Math.round(
      (amounts.reduce((sum, value) => sum + value, 0) / amounts.length) * 100,
    ) / 100;
    const middle = Math.floor(amounts.length / 2);
    const medianGrant =
      amounts.length % 2 === 0
        ? Math.round((((amounts[middle - 1] ?? 0) + (amounts[middle] ?? 0)) / 2) * 100) / 100
        : (amounts[middle] ?? null);

    return {
      averageGrant,
      medianGrant,
      grantRange: `${this.formatCurrency(amounts[0] ?? null)} - ${this.formatCurrency(amounts[amounts.length - 1] ?? null)}`,
    };
  }

  private classifySmallOrgFriendly(referenceGrant: number | null) {
    if (referenceGrant === null) {
      return {
        label: "Needs research" as const,
        explanation:
          "Recipient-level grant sizing is still too thin to estimate how friendly this funder is to smaller nonprofits.",
      };
    }

    if (referenceGrant <= 25000) {
      return {
        label: "High" as const,
        explanation:
          "Visible grant sizes cluster in a range that usually works for small nonprofit budgets.",
      };
    }

    if (referenceGrant <= 100000) {
      return {
        label: "Medium" as const,
        explanation:
          "This funder appears reachable for smaller teams, but the grant size pattern is not clearly tiny-org focused.",
      };
    }

    return {
      label: "Low" as const,
      explanation:
        "Typical visible grants are large enough that smaller organizations may need a stronger capacity case.",
    };
  }

  private async fetchWebsiteStatement(website?: string | null) {
    const target = this.toOptionalString(website);
    if (!target) {
      return null;
    }

    try {
      const normalizedUrl = /^[a-z]+:\/\//i.test(target) ? target : `https://${target}`;
      const response = await fetch(normalizedUrl, {
        headers: {
          "User-Agent": this.config.USER_AGENT,
        },
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) {
        return null;
      }

      const html = await response.text();
      return this.extractWebsiteStatement(html);
    } catch (error) {
      this.logger.warn({ error, website }, "Unable to fetch website statement for funder intelligence");
      return null;
    }
  }

  private extractWebsiteStatement(html: string) {
    const $ = load(html);
    const candidates = [
      $('meta[name="description"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $("main h1").first().text(),
      $("main p")
        .slice(0, 3)
        .map((_, element) => $(element).text())
        .get()
        .join(" "),
      $("body p")
        .slice(0, 3)
        .map((_, element) => $(element).text())
        .get()
        .join(" "),
    ]
      .map((value) => this.toOptionalString(value))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => !/cookie|privacy policy|terms of use/i.test(value));

    const unique = [...new Set(candidates)];
    const summary = unique.join(" ");
    if (!summary) {
      return null;
    }

    return summary.length > 320 ? `${summary.slice(0, 317).trimEnd()}...` : summary;
  }

  private parseCommaSeparated(value?: string | null) {
    return (value ?? "")
      .split(/[,;|]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private categorizePurposeText(value: string) {
    const normalized = value.toLowerCase();
    const categories: string[] = [];

    const rules: Array<[string, RegExp]> = [
      ["Youth Development", /\byouth|children|teen|student|after[- ]school|literacy\b/i],
      ["Education", /\beducation|school|learning|scholarship|college|classroom\b/i],
      ["Health", /\bhealth|mental health|clinic|medical|wellness\b/i],
      ["Housing", /\bhousing|shelter|homeless\b/i],
      ["Food Security", /\bfood|hunger|meal|nutrition\b/i],
      ["Arts & Culture", /\bart|music|culture|museum|theater\b/i],
      ["Faith-Based Giving", /\bchurch|ministry|faith|synagogue|mosque\b/i],
      ["Capital / Facilities", /\bbuilding|capital|facility|renovation|equipment\b/i],
      ["Operating Support", /\bgeneral support|operating|operations|program support\b/i],
    ];

    for (const [label, pattern] of rules) {
      if (pattern.test(normalized)) {
        categories.push(label);
      }
    }

    return categories.length > 0 ? categories : ["Uncategorized"];
  }

  private formatYearRange(years: number[]) {
    if (years.length === 0) {
      return "available years";
    }

    const sorted = [...years].sort((left, right) => left - right);
    return sorted[0] === sorted[sorted.length - 1]
      ? String(sorted[0])
      : `${sorted[0]}-${sorted[sorted.length - 1]}`;
  }

  private describeFilingTypes(
    filings: Array<{
      filingType: DerivedFilingRecord["filingType"];
    }>,
  ) {
    const types = [...new Set(filings.map((filing) => filing.filingType).filter(Boolean))];
    if (types.length === 0) {
      return "ProPublica";
    }

    return types.join("/");
  }

  private normalizeForMatch(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeFormType(value: unknown) {
    if (value === 2 || value === "2") {
      return "990-PF";
    }
    if (value === 0 || value === "0") {
      return "990";
    }
    return "Other";
  }

  private toNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.replace(/,/g, "").trim();
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private toOptionalString(value: unknown) {
    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private average(values: number[]) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private pickPreferredSummary(
    existingSummary: string | null,
    derivedSummary: string,
    metrics: DerivedMetrics,
  ) {
    if (
      existingSummary &&
      metrics.annualGrantTotalsAvailable === 0 &&
      (metrics.averageGrant === null || metrics.medianGrant === null)
    ) {
      return existingSummary;
    }

    return derivedSummary;
  }

  private shouldPreserveExistingFiling(
    existing: typeof funderFilings.$inferSelect,
    incoming: DerivedFilingRecord,
  ) {
    return (
      this.rankParsedStatus(this.toFilingParsedStatus(existing.parsedStatus)) >
      this.rankParsedStatus(incoming.parsedStatus)
    );
  }

  private toFilingParsedStatus(value: string | null): DerivedFilingRecord["parsedStatus"] {
    if (value === "Parsed" || value === "Partial" || value === "Failed") {
      return value;
    }

    return "Queued";
  }

  private rankParsedStatus(status: DerivedFilingRecord["parsedStatus"]) {
    switch (status) {
      case "Parsed":
        return 4;
      case "Partial":
        return 3;
      case "Failed":
        return 2;
      case "Queued":
      default:
        return 1;
    }
  }

  private isPdfSource(sourceUrl?: string | null) {
    const normalized = (sourceUrl ?? "").toLowerCase();
    return normalized.includes("download-filing") || normalized.includes(".pdf");
  }

  private median(values: number[]) {
    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
    }
    return sorted[midpoint]!;
  }

  private formatCurrency(value: number | null) {
    if (value === null || !Number.isFinite(value)) {
      return "Not available";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  private slugify(value: string) {
    return this.normalizeForMatch(value).replace(/\s+/g, "-").slice(0, 80) || "snapshot";
  }

  private resolveProjectPath(relativeOrAbsolute: string) {
    return relativeOrAbsolute.startsWith(".")
      ? resolve(PROJECT_ROOT, relativeOrAbsolute)
      : relativeOrAbsolute;
  }
}
