import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { eq } from "drizzle-orm";
import pdfParse from "pdf-parse";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import { resolveOrganizationId } from "../../lib/organization-scope.js";
import { funders, opportunities, requirements } from "../../db/schema.js";
import { AgentProgressService } from "../agent-progress/service.js";
import { GeminiClient } from "../gemini/client.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { PortalDiscoveryService } from "../opportunities/portal-discovery.js";
import {
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "../opportunities/opportunity-identity.js";
import {
  isHeadingOnlyRequirement,
  normalizeRequirementEntries,
  normalizeRequirementText,
} from "../opportunities/requirement-normalization.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type OpportunityIntakeInput = {
  organizationId?: string | null;
  clerkUserId?: string | null;
  url?: string;
  rawText?: string;
  syncToNotion?: boolean;
};

export type ParsedOpportunity = {
  title: string;
  funderName: string;
  deadline?: string | null;
  submissionMethod?: string | null;
  portalUrl?: string | null;
  summary?: string | null;
  requirements: Array<{
    questionText: string;
    requirementType?: string | null;
    wordLimit?: number | null;
  }>;
};

export type OpportunityIntakeResult = {
  source: {
    url?: string;
    rawTextProvided: boolean;
    extractedTextLength: number;
  };
  parsed: ParsedOpportunity;
  persisted: {
    funderId: string;
    opportunityId: string;
    requirementIds: string[];
  };
  notionSync?: {
    funderPageId: string;
    opportunityPageId: string;
    requirementPageIds: string[];
  };
};

const parsedOpportunitySchema = z.object({
  title: z.string().min(1),
  funderName: z.string().min(1),
  deadline: z.string().nullable().optional(),
  submissionMethod: z.string().nullable().optional(),
  portalUrl: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  requirements: z
    .array(
      z.object({
        questionText: z.string().min(1),
        requirementType: z.string().nullable().optional(),
        wordLimit: z.number().nullable().optional(),
      }),
    )
    .default([]),
});

export class OpportunityIntakeService {
  private readonly logger: LoggerLike;
  private readonly progressService: AgentProgressService;

  constructor(
    private readonly config: AppEnv,
    private readonly geminiClient: GeminiClient,
    private readonly portalDiscoveryService?: PortalDiscoveryService,
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

  async run(input: OpportunityIntakeInput): Promise<OpportunityIntakeResult> {
    if (!input.url && !input.rawText) {
      throw new Error("Opportunity intake requires either a URL or raw text.");
    }

    const runId = randomUUID();
    await this.progressService.record({
      runId,
      agentName: "Intake Agent",
      actionDescription: "Started opportunity intake",
      progressLine: "⏳ Parsing opportunity source",
      summary: "Reading the opportunity source and extracting the grant requirements.",
      sourceUrl: input.url ?? null,
      followUpRequired: false,
      syncToNotion: input.syncToNotion,
    });

    const extractedText = input.rawText
      ? this.normalizeText(input.rawText)
      : await this.fetchSourceText(input.url!);

    const parsed = await this.parseOpportunity({
      url: input.url,
      extractedText,
    });
    const discoveredPortal = await this.portalDiscoveryService?.inspect({
      sourceUrl: input.url,
      rawText: input.rawText ?? extractedText,
    });
    const effectivePortalUrl = discoveredPortal?.discoveredPortalUrl ?? parsed.portalUrl ?? input.url ?? null;
    const effectiveSubmissionMethod =
      discoveredPortal?.submissionMethod ??
      parsed.submissionMethod ??
      this.inferSubmissionMethod(extractedText, effectivePortalUrl ?? input.url);
    const effectiveParsed: ParsedOpportunity = {
      ...parsed,
      submissionMethod: effectiveSubmissionMethod,
      portalUrl: effectivePortalUrl,
    };

    const organizationId = await resolveOrganizationId(input.organizationId, input.clerkUserId);
    const funderId = await this.ensureFunder(parsed.funderName, input.url);
    const now = new Date().toISOString();
    const existingOpportunity = await this.findExistingOpportunity({
      organizationId,
      funderId,
      title: parsed.title,
      sourceUrl: input.url ?? null,
      portalUrl: effectivePortalUrl,
    });
    const opportunityId = existingOpportunity?.id ?? randomUUID();

    if (existingOpportunity) {
      await db
        .update(opportunities)
        .set({
          organizationId,
          funderId,
          title: parsed.title,
          deadline: parsed.deadline ?? null,
          submissionMethod: effectiveSubmissionMethod ?? null,
          sourceUrl: input.url ?? existingOpportunity.sourceUrl ?? null,
          portalUrl: effectivePortalUrl,
          portalDiscoveredAt: effectivePortalUrl
            ? now
            : existingOpportunity.portalDiscoveredAt,
          rationale: parsed.summary ?? null,
          updatedAt: now,
        })
        .where(eq(opportunities.id, existingOpportunity.id));
    } else {
      await db.insert(opportunities).values({
        id: opportunityId,
        organizationId,
        funderId,
        title: parsed.title,
        deadline: parsed.deadline ?? null,
        submissionMethod: effectiveSubmissionMethod ?? null,
        sourceUrl: input.url ?? null,
        portalUrl: effectivePortalUrl,
        portalDiscoveredAt: effectivePortalUrl ? now : null,
        status: "Researching",
        rationale: parsed.summary ?? null,
      });
    }

    const existingRequirements = await db
      .select()
      .from(requirements)
      .where(eq(requirements.opportunityId, opportunityId));
    const existingRequirementByKey = new Map(
      existingRequirements.map((requirement) => [
        this.toRequirementKey(requirement.questionText, requirement.requirementType),
        requirement,
      ]),
    );
    const requirementIds: string[] = [];
    const requirementsToInsert: Array<typeof requirements.$inferInsert> = [];

    for (const requirement of parsed.requirements) {
      const requirementKey = this.toRequirementKey(
        requirement.questionText,
        requirement.requirementType,
      );
      const existingRequirement = existingRequirementByKey.get(requirementKey);

      if (existingRequirement) {
        requirementIds.push(existingRequirement.id);
        await db
          .update(requirements)
          .set({
            updatedAt: now,
            questionText: requirement.questionText,
            requirementType: requirement.requirementType ?? "Narrative Question",
            wordLimit: requirement.wordLimit ?? null,
          })
          .where(eq(requirements.id, existingRequirement.id));
        continue;
      }

      const requirementId = randomUUID();
      requirementIds.push(requirementId);
      requirementsToInsert.push({
        id: requirementId,
        opportunityId,
        questionText: requirement.questionText,
        requirementType: requirement.requirementType ?? "Narrative Question",
        wordLimit: requirement.wordLimit ?? null,
        coverageStatus: "Missing",
        approvalStatus: "Pending",
      });
    }

    if (requirementsToInsert.length > 0) {
      await db.insert(requirements).values(requirementsToInsert);
    }

    let notionSync: OpportunityIntakeResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncOpportunityIntake({
          opportunityId,
          funderName: parsed.funderName,
          funderWebsite: input.url,
          sourceUrl: input.url,
          opportunityTitle: parsed.title,
          deadline: parsed.deadline,
          submissionMethod: effectiveSubmissionMethod,
          portalUrl: effectivePortalUrl,
          requirements: parsed.requirements,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for intake result");
      }
    }

    await this.progressService.record({
      runId,
      agentName: "Intake Agent",
      actionDescription: "Parsed and stored an opportunity intake source",
      progressLine: "✅ Opportunity parsed",
      summary: `Captured '${parsed.title}' with ${parsed.requirements.length} requirement${parsed.requirements.length === 1 ? "" : "s"} ready for the next agents.`,
      sourceUrl: input.url ?? null,
      confidenceLevel: parsed.requirements.length > 0 ? 0.82 : 0.6,
      followUpRequired: parsed.requirements.length === 0,
      opportunityTitle: parsed.title,
      targetPageId: notionSync?.opportunityPageId,
      syncToNotion: input.syncToNotion,
    });

    return {
      source: {
        url: input.url,
        rawTextProvided: Boolean(input.rawText),
        extractedTextLength: extractedText.length,
      },
      parsed: effectiveParsed,
      persisted: {
        funderId,
        opportunityId,
        requirementIds,
      },
      notionSync,
    };
  }

  private async findExistingOpportunity(input: {
    organizationId?: string | null;
    funderId: string;
    title: string;
    sourceUrl?: string | null;
    portalUrl?: string | null;
  }) {
    const normalizedOrganizationId = this.normalizeText(input.organizationId);
    if (!normalizedOrganizationId) {
      return null;
    }

    const candidateRows = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.organizationId, normalizedOrganizationId));
    const relatedRows = collectRelatedOpportunityRows(candidateRows, {
      organizationId: normalizedOrganizationId,
      funderId: input.funderId,
      title: input.title,
      sourceUrl: input.sourceUrl ?? null,
      portalUrl: input.portalUrl ?? null,
    }).filter((row) => !this.normalizeText(row.funderId) || row.funderId === input.funderId);

    return selectCanonicalOpportunity(relatedRows) ?? null;
  }

  private toRequirementKey(questionText?: string | null, requirementType?: string | null) {
    return `${normalizeRequirementText(questionText)}::${this.normalizeText(
      requirementType ?? "Narrative Question",
    ).toLowerCase()}`;
  }

  private async ensureFunder(name: string, website?: string) {
    const [existing] = await db
      .select()
      .from(funders)
      .where(eq(funders.name, name))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const funderId = randomUUID();
    await db.insert(funders).values({
      id: funderId,
      name,
      website: website ?? null,
      givingSummary: "Added from the opportunity intake pipeline.",
    });

    return funderId;
  }

  private async fetchSourceText(url: string) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.config.USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch source URL: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return this.extractPdfTextWithOcrFallback(buffer, url);
    }

    const html = await response.text();
    const $ = load(html);
    $("script, style, noscript").remove();
    const title = $("title").text().trim();
    const bodyText = $("body").text();
    const combined = title ? `${title}\n\n${bodyText}` : bodyText;
    return this.normalizeText(combined);
  }

  private async parseOpportunity(input: {
    url?: string;
    extractedText: string;
  }): Promise<ParsedOpportunity> {
    const truncated = input.extractedText.slice(0, 16000);
    const prompt = `
You are extracting a grant opportunity into structured JSON.
Return only valid JSON.

Schema:
{
  "title": string,
  "funderName": string,
  "deadline": string | null,
  "submissionMethod": string | null,
  "portalUrl": string | null,
  "summary": string | null,
  "requirements": [
    {
      "questionText": string,
      "requirementType": string | null,
      "wordLimit": number | null
    }
  ]
}

Rules:
- Use ISO-like dates if possible: YYYY-MM-DD.
- If a field is unknown, return null.
- requirements should contain direct prompts, required documents, budgets, or eligibility statements if clearly present.
- Keep questionText concise but faithful.

Source URL: ${input.url ?? "none"}
Content:
${truncated}
`;

    try {
      const response = await this.geminiClient.generateText(prompt);
      const jsonCandidate = this.extractJsonObject(response);
      const parsed = parsedOpportunitySchema.parse(JSON.parse(jsonCandidate));
      return this.normalizeParsedOpportunity(parsed, input.url, input.extractedText);
    } catch (error) {
      this.logger.warn(
        { error },
        "Gemini opportunity extraction failed, falling back to heuristic parsing",
      );
      return this.heuristicParse(input.url, input.extractedText);
    }
  }

  private normalizeParsedOpportunity(
    parsed: z.infer<typeof parsedOpportunitySchema>,
    url: string | undefined,
    extractedText: string,
  ): ParsedOpportunity {
    const normalizedRequirements = this.postProcessRequirements(
      parsed.requirements.map((requirement) => ({
        questionText: requirement.questionText.trim(),
        requirementType: requirement.requirementType?.trim() || null,
        wordLimit:
          typeof requirement.wordLimit === "number" ? requirement.wordLimit : null,
      })),
    );

    return {
      title: parsed.title.trim(),
      funderName: parsed.funderName.trim(),
      deadline: this.normalizeDate(parsed.deadline),
      submissionMethod:
        parsed.submissionMethod?.trim() || this.inferSubmissionMethod(extractedText, url),
      portalUrl: parsed.portalUrl?.trim() || url || null,
      summary: parsed.summary?.trim() || null,
      requirements: normalizedRequirements,
    };
  }

  private heuristicParse(url: string | undefined, extractedText: string): ParsedOpportunity {
    const title = this.inferTitle(extractedText, url);
    const funderName = this.inferFunderName(extractedText, url);
    const deadline = this.extractDeadline(extractedText);
    const requirements = this.extractRequirements(extractedText);

    return {
      title,
      funderName,
      deadline,
      submissionMethod: this.inferSubmissionMethod(extractedText, url),
      portalUrl: url ?? null,
      summary: extractedText.slice(0, 400),
      requirements,
    };
  }

  private inferTitle(extractedText: string, url?: string) {
    const lines = extractedText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const firstLongLine = lines.find((line) => line.length > 12 && line.length < 140);
    return firstLongLine || url || "Untitled Opportunity";
  }

  private inferFunderName(extractedText: string, url?: string) {
    const firstLine = extractedText
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    if (firstLine) {
      const titleLineMatch = firstLine.match(
        /^(.*?)(?:\s+\d{4}\b|\s+grant\b|\s+fund\b)/i,
      );

      if (titleLineMatch?.[1]) {
        const candidate = titleLineMatch[1].trim();
        if (candidate.length > 6) {
          return candidate;
        }
      }
    }

    const funderMatch = extractedText.match(
      /(foundation|fund|trust|family foundation|community foundation)[^\n]{0,60}/i,
    );

    if (funderMatch) {
      return this.titleize(funderMatch[0].trim());
    }

    if (url) {
      return new URL(url).hostname.replace(/^www\./, "");
    }

    return "Unknown Funder";
  }

  private extractDeadline(extractedText: string) {
    const patterns = [
      /\b(?:deadline|due date|applications? due)\b[^\n:]{0,20}[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i,
      /\b(?:deadline|due date|applications? due)\b[^\n:]{0,20}[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ];

    for (const pattern of patterns) {
      const match = extractedText.match(pattern);
      if (match?.[1]) {
        return this.normalizeDate(match[1]);
      }
    }

    return null;
  }

  private extractRequirements(extractedText: string) {
    const lines = extractedText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const extractedRequirements: ParsedOpportunity["requirements"] = [];
    let activeHeading: string | null = null;

    for (const line of lines) {
      const normalized = normalizeRequirementText(line);
      if (!normalized) {
        continue;
      }

      if (isHeadingOnlyRequirement(normalized)) {
        activeHeading = normalized.replace(/[:\s]+$/g, "");
        continue;
      }

      const isRequirementLike =
        /(?:word limit|describe|explain|upload|attachment|document|budget|narrative|question|eligib|grant funds|grant uses|required|must|report|feasibility|previous)/i.test(
          normalized,
        ) ||
        normalized.endsWith("?") ||
        (Boolean(activeHeading) && normalized.length > 40);

      if (!isRequirementLike) {
        activeHeading = null;
        continue;
      }

      const questionText = activeHeading ? `${activeHeading}: ${normalized}` : normalized;
      extractedRequirements.push({
        questionText,
        requirementType: /upload|attachment|document/i.test(questionText)
          ? "Document"
          : /budget|feasibility/i.test(questionText)
            ? "Budget"
            : /eligib|grant uses|grant funds|previous/i.test(questionText)
              ? "Eligibility"
              : "Narrative Question",
        wordLimit: this.extractWordLimit(questionText),
      });

      if (!/eligible grant uses|ineligible grant uses|eligibility/i.test(activeHeading ?? "")) {
        activeHeading = null;
      }
    }

    return this.postProcessRequirements(extractedRequirements.slice(0, 20));
  }

  private postProcessRequirements(
    requirements: ParsedOpportunity["requirements"],
  ): ParsedOpportunity["requirements"] {
    return normalizeRequirementEntries(requirements).map((requirement) => ({
      questionText: requirement.questionText,
      requirementType: requirement.requirementType ?? "Narrative Question",
      wordLimit: requirement.wordLimit ?? null,
    }));
  }

  private extractWordLimit(text: string) {
    const match = text.match(/(\d{2,5})\s*(?:word|words|character|characters)/i);
    if (!match?.[1]) {
      return null;
    }

    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  private inferSubmissionMethod(extractedText: string, url?: string) {
    const lower = `${url ?? ""}\n${extractedText}`.toLowerCase();
    if (lower.includes("submittable")) {
      return "Submittable";
    }

    if (lower.includes("email")) {
      return "Email";
    }

    if (url) {
      return "Portal";
    }

    return null;
  }

  private normalizeDate(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private extractJsonObject(text: string) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model response did not contain a JSON object.");
    }

    return text.slice(start, end + 1);
  }

  private normalizeText(text?: string | null) {
    return (text ?? "")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  private async extractPdfTextWithOcrFallback(buffer: Buffer, sourceUrl?: string) {
    let extractedText = "";

    try {
      const parsedPdf = await pdfParse(buffer);
      extractedText = this.normalizeText(parsedPdf.text ?? "");
    } catch (error) {
      this.logger.warn({ error, sourceUrl }, "Unable to extract raw text from intake PDF");
    }

    if (!this.shouldUsePdfOcrFallback(extractedText)) {
      return extractedText;
    }

    try {
      const ocrText = this.normalizeText(
        await this.geminiClient.generateTextFromInlineFiles({
          prompt: `
Extract all readable text from this grant opportunity PDF.

Rules:
- Return plain text only.
- Preserve headings, deadlines, eligibility rules, application instructions, and question text when visible.
- Do not summarize, explain, or add commentary.
`,
          inlineFiles: [
            {
              data: buffer,
              mimeType: "application/pdf",
            },
          ],
          maxOutputTokens: 8192,
        }),
      );

      if (ocrText.length > extractedText.length) {
        this.logger.info(
          {
            sourceUrl,
            extractedLength: extractedText.length,
            ocrLength: ocrText.length,
          },
          "Used OCR fallback for intake PDF extraction",
        );
        return ocrText;
      }
    } catch (error) {
      this.logger.warn({ error, sourceUrl }, "OCR fallback failed for intake PDF");
    }

    return extractedText;
  }

  private shouldUsePdfOcrFallback(text: string) {
    const normalized = this.normalizeText(text);
    if (!normalized) {
      return true;
    }

    if (/prepared from an image/i.test(normalized)) {
      return true;
    }

    if (normalized.length >= 1200) {
      return false;
    }

    const alphaNumericCount = normalized.replace(/[^a-z0-9]/gi, "").length;
    return alphaNumericCount < 700;
  }

  private titleize(value: string) {
    return value
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }
}
