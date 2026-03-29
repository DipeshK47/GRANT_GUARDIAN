import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Schema } from "@google/genai";
import { desc, eq } from "drizzle-orm";
import pdfParse from "pdf-parse";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  funderFilings,
  funderGrantRows,
  funders,
  sourceSnapshots,
} from "../../db/schema.js";
import { AgentProgressService } from "../agent-progress/service.js";
import { GeminiClient } from "../gemini/client.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type FilingParseStatus = "Queued" | "Parsed" | "Partial" | "Failed";

export type FunderFilingParseInput = {
  funderId: string;
  taxYear?: number;
  limit?: number;
  syncToNotion?: boolean;
  force?: boolean;
};

export type FunderFilingParseResult = {
  funderId: string;
  funderName: string;
  processedFilings: Array<{
    filingId: string;
    taxYear: number;
    parsedStatus: FilingParseStatus;
    rowsExtracted: number;
    grantCount: number | null;
    totalGrants: number | null;
    extractionMethod: string | null;
    pdfSnapshotPath: string | null;
    extractionSnapshotPath: string | null;
    error?: string;
  }>;
  aggregate: {
    parsedFilingCount: number;
    extractedGrantRows: number;
    averageGrant: number | null;
    medianGrant: number | null;
    grantRange: string | null;
    topGeographies: string[];
    topCategories: string[];
    givingSummary: string;
  };
  notionSync?: {
    funderPageId: string;
    filingPageIds: string[];
  };
};

const extractedGrantRowSchema = z.object({
  recipientName: z.string().min(1),
  recipientCity: z.string().nullable().optional(),
  recipientState: z.string().nullable().optional(),
  recipientEin: z.string().nullable().optional(),
  grantAmount: z.number().nullable().optional(),
  purpose: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const extractedFilingSchema = z.object({
  taxYear: z.number().nullable().optional(),
  filingGrantCount: z.number().nullable().optional(),
  filingTotalGrants: z.number().nullable().optional(),
  extractionConfidence: z.number().min(0).max(1).nullable().optional(),
  extractionNotes: z.string().nullable().optional(),
  grantRows: z.array(extractedGrantRowSchema).default([]),
});

const filingExtractionResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["grantRows"],
  propertyOrdering: [
    "taxYear",
    "filingGrantCount",
    "filingTotalGrants",
    "extractionConfidence",
    "extractionNotes",
    "grantRows",
  ],
  properties: {
    taxYear: {
      type: Type.NUMBER,
      nullable: true,
      description: "Tax year for the filing if visible in the document.",
    },
    filingGrantCount: {
      type: Type.NUMBER,
      nullable: true,
      description: "Total number of grant rows visible in the filing.",
    },
    filingTotalGrants: {
      type: Type.NUMBER,
      nullable: true,
      description: "Total amount of grants paid during the filing year.",
    },
    extractionConfidence: {
      type: Type.NUMBER,
      nullable: true,
      description: "Confidence score between 0 and 1.",
    },
    extractionNotes: {
      type: Type.STRING,
      nullable: true,
      description: "Short explanation of any ambiguity or limitations.",
    },
    grantRows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["recipientName"],
        propertyOrdering: [
          "recipientName",
          "recipientCity",
          "recipientState",
          "recipientEin",
          "grantAmount",
          "purpose",
          "rawText",
          "confidence",
        ],
        properties: {
          recipientName: {
            type: Type.STRING,
            description: "Grant recipient organization or entity name.",
          },
          recipientCity: {
            type: Type.STRING,
            nullable: true,
          },
          recipientState: {
            type: Type.STRING,
            nullable: true,
          },
          recipientEin: {
            type: Type.STRING,
            nullable: true,
          },
          grantAmount: {
            type: Type.NUMBER,
            nullable: true,
          },
          purpose: {
            type: Type.STRING,
            nullable: true,
          },
          rawText: {
            type: Type.STRING,
            nullable: true,
            description: "Optional raw row text fragment from the filing.",
          },
          confidence: {
            type: Type.NUMBER,
            nullable: true,
          },
        },
      },
    },
  },
};

export class FunderFilingParsingService {
  private readonly logger: LoggerLike;
  private readonly progressService: AgentProgressService;

  constructor(
    private readonly config: AppEnv,
    private readonly geminiClient: GeminiClient,
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

  async run(input: FunderFilingParseInput): Promise<FunderFilingParseResult> {
    const runId = randomUUID();
    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, input.funderId))
      .limit(1);

    if (!funder) {
      throw new Error(`No local funder record exists for id '${input.funderId}'.`);
    }

    const filings = await db
      .select()
      .from(funderFilings)
      .where(eq(funderFilings.funderId, funder.id))
      .orderBy(desc(funderFilings.taxYear));

    if (filings.length === 0) {
      throw new Error(`No filing metadata exists yet for '${funder.name}'. Run enrichment first.`);
    }

    const canonicalFilings = this.dedupeFilingsByTaxYear(filings);

    const existingRows = await db
      .select({
        filingId: funderGrantRows.filingId,
        taxYear: funderGrantRows.taxYear,
      })
      .from(funderGrantRows)
      .where(eq(funderGrantRows.funderId, funder.id));

    const parsedFilingIds = new Set(existingRows.map((row) => row.filingId));
    const parsedTaxYears = new Set(existingRows.map((row) => row.taxYear));
    const candidateFilings = canonicalFilings
      .filter((filing) => (typeof input.taxYear === "number" ? filing.taxYear === input.taxYear : true))
      .filter((filing) => this.isPdfSource(filing.sourceUrl))
      .filter((filing) => input.force || (!parsedFilingIds.has(filing.id) && !parsedTaxYears.has(filing.taxYear)));
    const desiredUsefulParses = Math.max(1, input.limit ?? 2);

    if (candidateFilings.length === 0) {
      throw new Error(
        input.taxYear
          ? `No parseable PDF filings matched tax year ${input.taxYear}.`
          : "No parseable PDF filings are available to process. Try --force or run enrichment again.",
      );
    }

    await this.progressService.record({
      runId,
      agentName: "Funder Filing Parser Agent",
      actionDescription: "Started 990 filing parsing",
      progressLine: "⏳ Pulling 990 filings...",
      summary: `Downloading and parsing up to ${desiredUsefulParses} filing${desiredUsefulParses === 1 ? "" : "s"} for ${funder.name}.`,
      sourceUrl: candidateFilings[0]?.sourceUrl ?? null,
      funderName: funder.name,
      followUpRequired: false,
      syncToNotion: input.syncToNotion,
    });

    const processedFilings: FunderFilingParseResult["processedFilings"] = [];
    let usefulParses = 0;

    for (const filing of candidateFilings) {
      try {
        const pdfSnapshot = await this.downloadFilingPdf(
          funder.name,
          filing.taxYear,
          filing.sourceUrl,
        );
        const extractedText = await this.extractPdfText(pdfSnapshot.buffer);
        const extraction = await this.extractGrantRows({
          funderName: funder.name,
          taxYear: filing.taxYear,
          pdfBuffer: pdfSnapshot.buffer,
          extractedText,
        });

        const topGeographies = this.computeTopGeographies(extraction.grantRows);
        const topCategories = this.computeTopCategories(extraction.grantRows);
        const rowsTotal = this.sumGrantAmounts(extraction.grantRows);
        const filingGrantCount =
          extraction.filingGrantCount ??
          (extraction.grantRows.length > 0 ? extraction.grantRows.length : null);
        const filingTotalGrants =
          extraction.filingTotalGrants ??
          (rowsTotal > 0 ? rowsTotal : null);
        const parsedStatus: FilingParseStatus =
          extraction.grantRows.length > 0
            ? "Parsed"
            : filingGrantCount !== null || filingTotalGrants !== null
              ? "Partial"
              : "Failed";

        const extractionSnapshotPath = await this.writeJsonSnapshot(
          "propublica-filing-grants",
          funder.name,
          filing.taxYear,
          {
            taxYear: filing.taxYear,
            sourceUrl: filing.sourceUrl,
            extractedTextPreview: extractedText.slice(0, 4000),
            extraction,
            topGeographies,
            topCategories,
          },
        );

        await db.delete(funderGrantRows).where(eq(funderGrantRows.filingId, filing.id));

        if (extraction.grantRows.length > 0) {
          await db.insert(funderGrantRows).values(
            extraction.grantRows.map((row) => ({
              id: randomUUID(),
              funderId: funder.id,
              filingId: filing.id,
              taxYear: filing.taxYear,
              recipientName: row.recipientName,
              recipientCity: row.recipientCity ?? null,
              recipientState: row.recipientState ?? null,
              recipientEin: row.recipientEin ?? null,
              grantAmount: row.grantAmount ?? null,
              purpose: row.purpose ?? null,
              rawText: row.rawText ?? null,
              extractionMethod: extraction.extractionMethod,
              confidence: row.confidence ?? extraction.extractionConfidence ?? null,
            })),
          );
        }

        await db
          .update(funderFilings)
          .set({
            parsedStatus,
            grantsCount: filingGrantCount,
            grantsTotalAmount: filingTotalGrants,
            topGeographies: topGeographies.join(", "),
            topCategories: topCategories.join(", "),
            snapshotPath: extractionSnapshotPath,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(funderFilings.id, filing.id));

        processedFilings.push({
          filingId: filing.id,
          taxYear: filing.taxYear,
          parsedStatus,
          rowsExtracted: extraction.grantRows.length,
          grantCount: filingGrantCount,
          totalGrants: filingTotalGrants,
          extractionMethod: extraction.extractionMethod,
          pdfSnapshotPath: pdfSnapshot.filePath,
          extractionSnapshotPath,
        });

        if (
          extraction.grantRows.length > 0 ||
          (typeof filingGrantCount === "number" && filingGrantCount > 0) ||
          (typeof filingTotalGrants === "number" && filingTotalGrants > 0)
        ) {
          usefulParses += 1;
          if (usefulParses >= desiredUsefulParses) {
            break;
          }
        }
      } catch (error) {
        const message = this.formatErrorMessage(error);
        this.logger.warn(
          { error, taxYear: filing.taxYear, funderId: funder.id },
          "Failed to parse a funder filing",
        );

        await db
          .update(funderFilings)
          .set({
            parsedStatus: this.failedParseStatusForStoredFiling(filing),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(funderFilings.id, filing.id));

        processedFilings.push({
          filingId: filing.id,
          taxYear: filing.taxYear,
          parsedStatus: this.failedParseStatusForStoredFiling(filing),
          rowsExtracted: 0,
          grantCount: filing.grantsCount,
          totalGrants: filing.grantsTotalAmount,
          extractionMethod: null,
          pdfSnapshotPath: null,
          extractionSnapshotPath: null,
          error: message,
        });
      }
    }

    const aggregate = await this.updateFunderAggregate(funder.id, funder.name);

    let notionSync: FunderFilingParseResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        const [updatedFunder] = await db
          .select()
          .from(funders)
          .where(eq(funders.id, funder.id))
          .limit(1);
        const currentFilings = await db
          .select()
          .from(funderFilings)
          .where(eq(funderFilings.funderId, funder.id))
          .orderBy(desc(funderFilings.taxYear));

        notionSync = await this.notionClient.syncFunderIntelligence({
          funderName: updatedFunder?.name ?? funder.name,
          ein: updatedFunder?.ein ?? null,
          website: updatedFunder?.website ?? null,
          issueAreas: aggregate.topCategories,
          givingSummary: this.buildNotionGivingSummary({
            currentFunder: updatedFunder,
            givingSummary: aggregate.givingSummary,
            topCategories: aggregate.topCategories,
            repeatGranteeBiasPercent: this.computeRepeatGranteeBiasPercent(
              await db
                .select()
                .from(funderGrantRows)
                .where(eq(funderGrantRows.funderId, funder.id)),
            ),
            sourceLine: `Based on 990-PF filings from ${this.formatYearRange(
              currentFilings
                .filter((filing) => filing.parsedStatus === "Parsed" || filing.parsedStatus === "Partial")
                .map((filing) => filing.taxYear),
            )} via ProPublica.`,
          }),
          averageGrant: aggregate.averageGrant,
          medianGrant: aggregate.medianGrant,
          geographicFocus: aggregate.topGeographies,
          grantDnaTopTerms:
            aggregate.topCategories.length > 0
              ? `Top giving categories: ${aggregate.topCategories.join(", ")}`
              : "Grant-row parsing complete; category extraction limited.",
          framingStyle: updatedFunder?.narrativeStyle ?? null,
          toneSummary: updatedFunder?.toneNotes ?? null,
          notes: updatedFunder?.relationshipHistory ?? null,
          smallOrgFriendly:
            aggregate.averageGrant && aggregate.averageGrant <= 75000
              ? "Medium"
              : "Needs Review",
          filings: currentFilings.map((filing) => ({
            taxYear: filing.taxYear,
            filingType:
              filing.filingType === "990"
                ? "990"
                : filing.filingType === "Other"
                  ? "Other"
                  : "990-PF",
            parsedStatus: this.toFilingParseStatus(filing.parsedStatus),
            grantCount: filing.grantsCount,
            totalGrants: filing.grantsTotalAmount,
            sourceUrl: filing.sourceUrl,
          })),
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error, funderId: funder.id }, "Skipping Notion sync for parsed filings");
      }
    }

    await this.progressService.record({
      runId,
      agentName: "Funder Filing Parser Agent",
      actionDescription: "Parsed 990-PF filing documents into recipient-level grant rows",
      progressLine: "✅ 990 filings parsed",
      summary: `Processed ${processedFilings.length} filing${processedFilings.length === 1 ? "" : "s"} for ${funder.name} and extracted ${aggregate.extractedGrantRows} recipient grant row${aggregate.extractedGrantRows === 1 ? "" : "s"}.`,
      sourceUrl: candidateFilings[0]?.sourceUrl ?? null,
      confidenceLevel:
        processedFilings.some((filing) => filing.rowsExtracted > 0) ? 0.84 : 0.52,
      followUpRequired: aggregate.extractedGrantRows === 0,
      funderName: funder.name,
      targetPageId: notionSync?.funderPageId,
      syncToNotion: input.syncToNotion,
    });

    return {
      funderId: funder.id,
      funderName: funder.name,
      processedFilings,
      aggregate,
      notionSync,
    };
  }

  private async extractGrantRows(input: {
    funderName: string;
    taxYear: number;
    pdfBuffer: Buffer;
    extractedText: string;
  }) {
    const textCandidate = this.normalizeWhitespace(input.extractedText);
    if (this.isUsefulExtractedText(textCandidate)) {
      try {
        const extractedFromText = await this.extractGrantRowsFromText(
          input.funderName,
          input.taxYear,
          textCandidate,
        );
        if (extractedFromText.grantRows.length > 0) {
          return extractedFromText;
        }
      } catch (error) {
        this.logger.warn(
          { error, taxYear: input.taxYear },
          "Gemini text-only filing extraction failed, falling back to PDF input",
        );
      }
    }

    return this.extractGrantRowsFromPdf(input.funderName, input.taxYear, input.pdfBuffer);
  }

  private async extractGrantRowsFromText(
    funderName: string,
    taxYear: number,
    extractedText: string,
  ) {
    const response = await this.geminiClient.generateStructuredJson<unknown>({
      prompt: this.buildGrantExtractionPrompt({
        funderName,
        taxYear,
        sourceKind: "plain text extracted from a 990-PF filing",
        body: extractedText.slice(0, 120000),
      }),
      responseSchema: filingExtractionResponseSchema,
      maxOutputTokens: 8192,
    });

    const parsed = extractedFilingSchema.parse(response);
    return this.normalizeExtractionPayload(parsed, "gemini-text");
  }

  private async extractGrantRowsFromPdf(
    funderName: string,
    taxYear: number,
    pdfBuffer: Buffer,
  ) {
    const response = await this.geminiClient.generateStructuredJson<unknown>({
      prompt: this.buildGrantExtractionPrompt({
        funderName,
        taxYear,
        sourceKind: "a PDF 990-PF filing document",
      }),
      inlineFiles: [
        {
          data: pdfBuffer,
          mimeType: "application/pdf",
        },
      ],
      responseSchema: filingExtractionResponseSchema,
      maxOutputTokens: 8192,
    });

    const parsed = extractedFilingSchema.parse(response);
    return this.normalizeExtractionPayload(parsed, "gemini-pdf");
  }

  private normalizeExtractionPayload(
    payload: z.infer<typeof extractedFilingSchema>,
    extractionMethod: string,
  ) {
    return {
      taxYear: payload.taxYear ?? null,
      filingGrantCount:
        typeof payload.filingGrantCount === "number"
          ? Math.max(0, Math.round(payload.filingGrantCount))
          : null,
      filingTotalGrants:
        typeof payload.filingTotalGrants === "number" && Number.isFinite(payload.filingTotalGrants)
          ? payload.filingTotalGrants
          : null,
      extractionConfidence:
        typeof payload.extractionConfidence === "number"
          ? Math.min(1, Math.max(0, payload.extractionConfidence))
          : null,
      extractionNotes: payload.extractionNotes?.trim() || null,
      extractionMethod,
      grantRows: payload.grantRows
        .map((row) => ({
          recipientName: row.recipientName.trim(),
          recipientCity: row.recipientCity?.trim() || null,
          recipientState: row.recipientState?.trim() || null,
          recipientEin: row.recipientEin?.replace(/\D/g, "") || null,
          grantAmount:
            typeof row.grantAmount === "number" && Number.isFinite(row.grantAmount)
              ? row.grantAmount
              : null,
          purpose: row.purpose?.trim() || null,
          rawText: row.rawText?.trim() || null,
          confidence:
            typeof row.confidence === "number"
              ? Math.min(1, Math.max(0, row.confidence))
              : null,
        }))
        .filter((row) => row.recipientName.length > 0),
    };
  }

  private async updateFunderAggregate(funderId: string, funderName: string) {
    const [currentFunder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, funderId))
      .limit(1);
    const rows = await db
      .select()
      .from(funderGrantRows)
      .where(eq(funderGrantRows.funderId, funderId));
    const currentFilings = await db
      .select()
      .from(funderFilings)
      .where(eq(funderFilings.funderId, funderId))
      .orderBy(desc(funderFilings.taxYear));

    const amounts = rows
      .map((row) => row.grantAmount)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const topGeographies = this.computeTopGeographies(rows);
    const topCategories = this.computeTopCategories(rows);
    const repeatGranteeBiasPercent = this.computeRepeatGranteeBiasPercent(rows);
    const parsedFilingCount = new Set(rows.map((row) => row.filingId)).size;
    const extractedGrantRows = rows.length;
    const parsedTaxYears = currentFilings
      .filter((filing) => filing.parsedStatus === "Parsed" || filing.parsedStatus === "Partial")
      .map((filing) => filing.taxYear);
    const averageGrant =
      amounts.length > 0 ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : null;
    const medianGrant = amounts.length > 0 ? this.median(amounts) : null;
    const grantRange =
      amounts.length > 0
        ? `${this.formatCurrency(Math.min(...amounts))} - ${this.formatCurrency(Math.max(...amounts))}`
        : null;
    const latestTaxYear =
      parsedTaxYears.length > 0 ? Math.max(...parsedTaxYears) : null;
    const givingSummary = this.buildParsedGivingSummary({
      funderName,
      latestTaxYear,
      parsedFilingCount,
      extractedGrantRows,
      averageGrant,
      medianGrant,
      grantRange,
      topGeographies,
      topCategories,
    });
    const existingInsights = this.parseStoredInsights(currentFunder?.relationshipHistory);
    const smallOrgFriendly = this.classifySmallOrgFriendly(medianGrant ?? averageGrant ?? null);
    const sourceLine = `Based on 990-PF filings from ${this.formatYearRange(parsedTaxYears)} via ProPublica.`;

    await db
      .update(funders)
      .set({
        averageGrant,
        medianGrant,
        grantRange,
        geographicFocus: topGeographies.join(", "),
        givingSummary,
        grantDnaTopTerms: currentFunder?.grantDnaTopTerms ?? null,
        narrativeStyle: currentFunder?.narrativeStyle ?? null,
        prioritySignals:
          currentFunder?.prioritySignals ??
          (parsedFilingCount > 0
            ? `Parsed ${extractedGrantRows} grant row(s) across ${parsedFilingCount} filing(s).`
            : "Filing PDFs downloaded, but grant rows still need manual review."),
        toneNotes: currentFunder?.toneNotes ?? null,
        relationshipHistory: JSON.stringify({
          ...existingInsights,
          issueAreaConcentration: topCategories,
          topGeographies,
          repeatGranteeBiasPercent,
          smallOrgFriendly,
          statedVsActual: {
            stated:
              existingInsights?.statedVsActual?.stated ??
              currentFunder?.prioritySignals ??
              "Website positioning has not been captured yet for this funder.",
            actual: givingSummary,
          },
          sourceLine,
        }),
        lastResearchedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(funders.id, funderId));

    return {
      parsedFilingCount,
      extractedGrantRows,
      averageGrant,
      medianGrant,
      grantRange,
      topGeographies,
      topCategories,
      givingSummary,
    };
  }

  private buildParsedGivingSummary(input: {
    funderName: string;
    latestTaxYear: number | null;
    parsedFilingCount: number;
    extractedGrantRows: number;
    averageGrant: number | null;
    medianGrant: number | null;
    grantRange: string | null;
    topGeographies: string[];
    topCategories: string[];
  }) {
    if (input.extractedGrantRows === 0) {
      return `${input.funderName} has filing metadata in place, but recipient-level grant rows have not been extracted successfully yet. Manual review of the linked PDF filings is still recommended.`;
    }

    const geographyLine =
      input.topGeographies.length > 0
        ? `Most visible recipient geographies: ${input.topGeographies.join(", ")}.`
        : "Recipient geographies were not consistently visible in the parsed rows.";
    const categoryLine =
      input.topCategories.length > 0
        ? `Most common funding themes: ${input.topCategories.join(", ")}.`
        : "Purpose text was too sparse to derive stable category themes.";

    return `${input.funderName} now has ${input.extractedGrantRows} recipient-level grant row(s) parsed across ${input.parsedFilingCount} filing(s)${input.latestTaxYear ? ` through tax year ${input.latestTaxYear}` : ""}. Median visible grant size is ${input.medianGrant ? this.formatCurrency(input.medianGrant) : "unknown"} and the observed range is ${input.grantRange ?? "unknown"}. ${geographyLine} ${categoryLine}`;
  }

  private computeRepeatGranteeBiasPercent(rows: Array<typeof funderGrantRows.$inferSelect>) {
    if (rows.length === 0) {
      return null;
    }

    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = (row.recipientEin || row.recipientName || "").trim().toLowerCase();
      if (!key) {
        continue;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const repeatRows = rows.filter((row) => {
      const key = (row.recipientEin || row.recipientName || "").trim().toLowerCase();
      return key ? (counts.get(key) ?? 0) > 1 : false;
    }).length;

    return Math.round((repeatRows / rows.length) * 100);
  }

  private classifySmallOrgFriendly(referenceGrant: number | null) {
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
  }

  private parseStoredInsights(value?: string | null) {
    if (!value) {
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
          topTerms?: Array<{
            term: string;
            weight: number;
            occurrences: number;
          }>;
          framingStyles?: string[];
          toneSummary?: string;
        };
      };
    }

    try {
      return JSON.parse(value) as {
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
          topTerms?: Array<{
            term: string;
            weight: number;
            occurrences: number;
          }>;
          framingStyles?: string[];
          toneSummary?: string;
        };
      };
    } catch {
      return null;
    }
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

  private buildNotionGivingSummary(input: {
    currentFunder?: typeof funders.$inferSelect;
    givingSummary: string;
    topCategories: string[];
    repeatGranteeBiasPercent: number | null;
    sourceLine: string;
  }) {
    const stored = this.parseStoredInsights(input.currentFunder?.relationshipHistory);
    const lines = [
      input.givingSummary,
      stored?.statedVsActual?.stated ? `Website says: ${stored.statedVsActual.stated}` : null,
      `Filings show: ${input.givingSummary}`,
      input.topCategories.length > 0
        ? `Issue area concentration: ${input.topCategories.join(", ")}`
        : null,
      typeof input.repeatGranteeBiasPercent === "number"
        ? `Repeat grantee bias: ${input.repeatGranteeBiasPercent}%`
        : null,
      stored?.grantDna?.framingStyles?.length
        ? `Framing style: ${stored.grantDna.framingStyles.join(" · ")}`
        : null,
      stored?.grantDna?.toneSummary ?? null,
      input.sourceLine,
    ].filter(Boolean);

    return lines.join(" ");
  }

  private buildGrantExtractionPrompt(input: {
    funderName: string;
    taxYear: number;
    sourceKind: string;
    body?: string;
  }) {
    return `
You are extracting recipient-level grant intelligence from ${input.sourceKind}.

Target funder: ${input.funderName}
Target tax year: ${input.taxYear}

Return only JSON. Focus on the part of the 990-PF that lists grants, contributions, and assistance paid during the year.

Rules:
- Extract one row per recipient grant when visible.
- Use only information visible in the filing.
- grantAmount must be a number without commas or currency symbols.
- recipientState should be a 2-letter postal code when visible.
- If the filing only provides a summary total and no individual rows, return an empty grantRows array and fill filingTotalGrants if visible.
- Do not invent EINs, purposes, or locations.
- Keep extractionNotes brief.

${input.body ? `Document text:\n${input.body}` : "The PDF filing is attached as input."}
`;
  }

  private computeTopGeographies(
    rows: Array<{
      recipientCity?: string | null;
      recipientState?: string | null;
    }>,
  ) {
    const counts = new Map<string, number>();

    for (const row of rows) {
      const value = row.recipientState || row.recipientCity || null;
      if (!value) {
        continue;
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value]) => value);
  }

  private computeTopCategories(
    rows: Array<{
      purpose?: string | null;
      rawText?: string | null;
    }>,
  ) {
    const categoryCounts = new Map<string, number>();

    for (const row of rows) {
      const categories = this.categorizePurposeText(
        [row.purpose, row.rawText].filter(Boolean).join(" "),
      );
      for (const category of categories) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
    }

    return [...categoryCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value]) => value);
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

  private async downloadFilingPdf(
    funderName: string,
    taxYear: number,
    sourceUrl: string,
  ) {
    let response: Response;
    try {
      response = await fetch(sourceUrl, {
        headers: {
          "User-Agent": this.config.USER_AGENT,
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to download filing PDF from ${sourceUrl}: ${this.formatErrorMessage(error)}`,
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to download filing PDF: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = await this.writeBinarySnapshot(
      "propublica-filing-pdf",
      funderName,
      taxYear,
      sourceUrl,
      buffer,
      "pdf",
    );

    return {
      buffer,
      filePath,
    };
  }

  private async extractPdfText(buffer: Buffer) {
    let extractedText = "";

    try {
      const parsed = await pdfParse(buffer);
      extractedText = this.normalizeWhitespace(parsed.text ?? "");
    } catch (error) {
      this.logger.warn({ error }, "Unable to extract raw text from filing PDF");
    }

    if (!this.shouldUsePdfOcrFallback(extractedText)) {
      return extractedText;
    }

    try {
      const ocrText = this.normalizeWhitespace(
        await this.geminiClient.generateTextFromInlineFiles({
          prompt: `
Extract the readable text from this 990-PF filing PDF.

Rules:
- Return plain text only.
- Preserve headings, schedules, recipient rows, grant purposes, and totals when visible.
- Do not summarize or explain the filing.
`,
          inlineFiles: [
            {
              data: buffer,
              mimeType: "application/pdf",
            },
          ],
          maxOutputTokens: 12288,
        }),
      );

      if (ocrText.length > extractedText.length) {
        this.logger.info(
          {
            extractedLength: extractedText.length,
            ocrLength: ocrText.length,
          },
          "Used OCR fallback for filing PDF extraction",
        );
        return ocrText;
      }
    } catch (error) {
      this.logger.warn({ error }, "OCR fallback failed for filing PDF");
    }

    return extractedText;
  }

  private isUsefulExtractedText(value: string) {
    if (value.length < 1500) {
      return false;
    }

    if (/this return has been prepared from an image/i.test(value) && value.length < 3000) {
      return false;
    }

    return /\bgrant|contribution|assistance paid during the year|recipient\b/i.test(value);
  }

  private shouldUsePdfOcrFallback(value: string) {
    if (!value) {
      return true;
    }

    if (/this return has been prepared from an image/i.test(value)) {
      return true;
    }

    if (value.length >= 2000 && /schedule of contributions|recipient|grant|assistance paid during the year/i.test(value)) {
      return false;
    }

    const alphaNumericCount = value.replace(/[^a-z0-9]/gi, "").length;
    return value.length < 1800 || alphaNumericCount < 1000;
  }

  private sumGrantAmounts(
    rows: Array<{
      grantAmount?: number | null;
    }>,
  ) {
    return rows.reduce((sum, row) => sum + (row.grantAmount ?? 0), 0);
  }

  private median(values: number[]) {
    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
    }
    return sorted[midpoint]!;
  }

  private formatCurrency(value: number) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  private normalizeWhitespace(value: string) {
    return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  private isPdfSource(sourceUrl: string | null) {
    if (!sourceUrl) {
      return false;
    }

    return /download-filing|\.pdf(?:$|\?)/i.test(sourceUrl);
  }

  private dedupeFilingsByTaxYear(rows: Array<typeof funderFilings.$inferSelect>) {
    const rowsByTaxYear = new Map<number, Array<typeof funderFilings.$inferSelect>>();
    for (const row of rows) {
      const current = rowsByTaxYear.get(row.taxYear) ?? [];
      current.push(row);
      rowsByTaxYear.set(row.taxYear, current);
    }

    return [...rowsByTaxYear.values()]
      .map((group) =>
        [...group].sort((left, right) => {
          const statusDelta =
            this.rankParseStatus(right.parsedStatus) - this.rankParseStatus(left.parsedStatus);
          if (statusDelta !== 0) {
            return statusDelta;
          }

          const pdfDelta = Number(this.isPdfSource(right.sourceUrl)) - Number(this.isPdfSource(left.sourceUrl));
          if (pdfDelta !== 0) {
            return pdfDelta;
          }

          return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        })[0],
      )
      .filter((row): row is typeof funderFilings.$inferSelect => Boolean(row))
      .sort((left, right) => right.taxYear - left.taxYear);
  }

  private failedParseStatusForStoredFiling(filing: typeof funderFilings.$inferSelect): FilingParseStatus {
    const current = this.toFilingParseStatus(filing.parsedStatus);
    return current === "Queued" ? "Failed" : current;
  }

  private rankParseStatus(value: string | null) {
    const status = this.toFilingParseStatus(value);
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

  private toFilingParseStatus(value: string | null): FilingParseStatus {
    if (value === "Parsed" || value === "Partial" || value === "Failed") {
      return value;
    }

    return "Queued";
  }

  private async writeBinarySnapshot(
    sourceType: string,
    funderName: string,
    taxYear: number,
    sourceUrl: string,
    payload: Buffer,
    extension: string,
  ) {
    const directory = await this.ensureFilingDirectory(funderName);
    const filePath = resolve(directory, `${taxYear}-${sourceType}.${extension}`);
    await writeFile(filePath, payload);

    await db.insert(sourceSnapshots).values({
      id: randomUUID(),
      sourceType,
      sourceUrl,
      contentHash: createHash("sha256").update(payload).digest("hex"),
      localPath: filePath,
      parsedMetadata: JSON.stringify({
        funderName,
        taxYear,
        savedAt: new Date().toISOString(),
      }),
    });

    return filePath;
  }

  private async writeJsonSnapshot(
    sourceType: string,
    funderName: string,
    taxYear: number,
    payload: unknown,
  ) {
    const directory = await this.ensureFilingDirectory(funderName);
    const filePath = resolve(directory, `${taxYear}-${sourceType}.json`);
    const content = JSON.stringify(payload, null, 2);
    await writeFile(filePath, content, "utf8");

    await db.insert(sourceSnapshots).values({
      id: randomUUID(),
      sourceType,
      sourceUrl: `snapshot://${sourceType}/${taxYear}`,
      contentHash: createHash("sha256").update(content).digest("hex"),
      localPath: filePath,
      parsedMetadata: JSON.stringify({
        funderName,
        taxYear,
        savedAt: new Date().toISOString(),
      }),
    });

    return filePath;
  }

  private async ensureFilingDirectory(funderName: string) {
    const baseDir = this.resolveProjectPath(this.config.SNAPSHOT_DIR);
    const slug = this.slugify(funderName);
    const directory = resolve(baseDir, "propublica", slug, "filings");
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, "-")
      .slice(0, 80);
  }

  private resolveProjectPath(relativeOrAbsolute: string) {
    return relativeOrAbsolute.startsWith(".")
      ? resolve(PROJECT_ROOT, relativeOrAbsolute)
      : relativeOrAbsolute;
  }

  private formatErrorMessage(error: unknown) {
    if (error instanceof Error) {
      const cause =
        typeof error.cause === "object" && error.cause && "message" in error.cause
          ? String((error.cause as { message?: unknown }).message ?? "")
          : "";
      return cause ? `${error.message} (${cause})` : error.message;
    }

    return String(error);
  }
}
