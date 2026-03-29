import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import { agentLogs, opportunities } from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type SupportedSubmissionMethod = "Submittable" | "Email" | "Portal" | "Other";

export type PortalReadinessLevel = "Ready" | "Needs Review" | "Blocked";
export type PortalReadinessKind =
  | "missing"
  | "placeholder"
  | "submittable-application"
  | "submittable-landing"
  | "submittable-login"
  | "generic-portal"
  | "email"
  | "other";

export type PortalProbeResult = {
  attempted: boolean;
  reachable: boolean;
  httpStatus?: number;
  finalUrl?: string | null;
  pageTitle?: string | null;
  errorMessage?: string | null;
};

export type PortalReadinessResult = {
  normalizedPortalUrl?: string | null;
  preferredBrowserUrl?: string | null;
  submissionMethod?: SupportedSubmissionMethod | null;
  level: PortalReadinessLevel;
  kind: PortalReadinessKind;
  likelyLiveOpportunity: boolean;
  blockers: string[];
  warnings: string[];
  recommendedActions: string[];
  probe?: PortalProbeResult;
};

export type PortalDiscoveryInput = {
  opportunityId?: string;
  sourceUrl?: string;
  rawText?: string;
  syncToNotion?: boolean;
};

export type PortalDiscoveryCandidate = {
  url: string;
  label?: string;
  source: "source-url" | "page-link" | "page-form" | "redirect" | "raw-text";
  score: number;
  host: string;
  method: SupportedSubmissionMethod;
};

export type PortalDiscoveryInspection = {
  sourceUrl?: string | null;
  discoveredPortalUrl?: string | null;
  submissionMethod?: SupportedSubmissionMethod | null;
  candidates: PortalDiscoveryCandidate[];
  notes: string[];
  portalReadiness: PortalReadinessResult;
};

export type PortalDiscoveryResult = PortalDiscoveryInspection & {
  opportunityId?: string;
  opportunityTitle?: string;
  persisted?: {
    opportunityId: string;
    sourceUrl?: string | null;
    portalUrl?: string | null;
    submissionMethod?: string | null;
    portalDiscoveredAt?: string | null;
  };
  notionSync?: {
    opportunityPageId: string;
  };
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const lower = (value?: string | null) => normalizeText(value).toLowerCase();

const isPlaceholderPortalUrl = (value?: string | null) => {
  const normalized = lower(value);
  return (
    normalized.includes("example.submittable.com") ||
    normalized.includes("example.com/submit") ||
    normalized === "https://example.com" ||
    normalized === "http://example.com"
  );
};

const normalizePortalTargetUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.toLowerCase().startsWith("mailto:")) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    const returnUrl =
      parsed.searchParams.get("returnUrl") ?? parsed.searchParams.get("ReturnUrl");

    if (/submittable\.com$/i.test(parsed.host) && returnUrl) {
      const resolvedReturnUrl = new URL(returnUrl, parsed.origin);
      if (/^\/submit(?:\/|$)/i.test(resolvedReturnUrl.pathname)) {
        parsed.pathname = resolvedReturnUrl.pathname;
        parsed.search = resolvedReturnUrl.search;
        parsed.hash = "";
      }
    }

    if (/^(#)?(container|main|main-content|content)$/i.test(parsed.hash.replace(/^#/, ""))) {
      parsed.hash = "";
    }

    return parsed.toString();
  } catch {
    return normalized;
  }
};

const isDirectEmailUrl = (value: string) => value.toLowerCase().startsWith("mailto:");

const isDocumentLikeUrl = (value: string) =>
  /\.(pdf|docx?|xlsx?|zip)(?:$|[?#])/i.test(value) ||
  /\/(download|uploads?|files?|docs?)\b/i.test(value);

const isLikelyPortalHost = (host: string) =>
  /submittable\.com$/i.test(host) ||
  /smapply\.(io|org)$/i.test(host) ||
  /survey(monkey)?apply/i.test(host) ||
  /foundant/i.test(host) ||
  /fluxx/i.test(host);

const toSubmissionMethod = (candidateUrl: string): SupportedSubmissionMethod => {
  if (isDirectEmailUrl(candidateUrl)) {
    return "Email";
  }

  try {
    const parsed = new URL(candidateUrl);
    if (/submittable\.com$/i.test(parsed.host)) {
      return "Submittable";
    }
    if (isLikelyPortalHost(parsed.host)) {
      return "Portal";
    }
  } catch {
    return "Other";
  }

  return "Other";
};

const toSupportedSubmissionMethod = (
  value?: string | null,
): SupportedSubmissionMethod | null => {
  const normalized = lower(value);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("submittable")) {
    return "Submittable";
  }
  if (normalized.includes("email") || normalized.startsWith("mailto:")) {
    return "Email";
  }
  if (normalized.includes("portal")) {
    return "Portal";
  }

  try {
    return toSubmissionMethod(normalized);
  } catch {
    return "Other";
  }
};

const scoreCandidate = (input: {
  url: string;
  label?: string;
  source: PortalDiscoveryCandidate["source"];
  sourceUrl?: string | null;
}) => {
  const url = normalizePortalTargetUrl(input.url) ?? normalizeText(input.url);
  const label = lower(input.label);
  if (!url) {
    return -999;
  }
  if (isDocumentLikeUrl(url)) {
    return -999;
  }
  if (url.startsWith("javascript:") || url.startsWith("#")) {
    return -999;
  }
  if (
    label &&
    (/^skip to\b/.test(label) ||
      /privacy policy|technical help|view your submissions|log ?in|login/.test(label))
  ) {
    return -999;
  }

  let score = 0;

  if (input.source === "source-url") {
    score += 10;
  }
  if (input.source === "redirect") {
    score += 18;
  }
  if (input.source === "page-link") {
    score += 14;
  }
  if (input.source === "page-form") {
    score += 22;
  }
  if (input.source === "raw-text") {
    score += 8;
  }

  const method = toSubmissionMethod(url);
  if (method === "Submittable") {
    score += 65;
  } else if (method === "Portal") {
    score += 48;
  } else if (method === "Email") {
    score += 30;
  }

  const lowerUrl = url.toLowerCase();
  if (/#(container|main|main-content|content)$/i.test(lowerUrl)) {
    return -999;
  }
  if (/\/submit\b|\/apply\b|\/application\b/.test(lowerUrl)) {
    score += 25;
  }
  if (/\/submit\/[^/?#]+/.test(lowerUrl) || /returnurl=%2fsubmit%2f/i.test(lowerUrl)) {
    score += 24;
  }
  if (/apply|apply-now|start-application|submit-application|grant-portal|online-application/.test(lowerUrl)) {
    score += 18;
  }
  if (label) {
    if (/apply|apply now|start application|submit application|apply here|application portal/.test(label)) {
      score += 22;
    }
    if (/grant|scholarship|fellowship|application/.test(label) && label.length > 20) {
      score += 12;
    }
    if (/submittable|survey monkey apply|foundant|fluxx/.test(label)) {
      score += 20;
    }
  }

  try {
    const parsed = new URL(url);
    if (input.sourceUrl) {
      const sourceHost = new URL(input.sourceUrl).host.toLowerCase();
      if (parsed.host.toLowerCase() !== sourceHost) {
        score += 6;
      }
    }
    if (isLikelyPortalHost(parsed.host)) {
      score += 10;
    }
  } catch {
    // Ignore malformed URLs after normalization.
  }

  return score;
};

export const assessPortalReadiness = (input: {
  portalUrl?: string | null;
  submissionMethod?: SupportedSubmissionMethod | string | null;
  sourceUrl?: string | null;
  probe?: PortalProbeResult;
}): PortalReadinessResult => {
  const normalizedPortalUrl = normalizePortalTargetUrl(input.portalUrl);
  const submissionMethod =
    toSupportedSubmissionMethod(input.submissionMethod) ??
    (normalizedPortalUrl ? toSubmissionMethod(normalizedPortalUrl) : null);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendedActions: string[] = [];
  let level: PortalReadinessLevel = "Ready";
  let kind: PortalReadinessKind = "other";
  let likelyLiveOpportunity = false;

  if (!normalizedPortalUrl) {
    return {
      normalizedPortalUrl: null,
      preferredBrowserUrl: null,
      submissionMethod,
      level: "Blocked",
      kind: "missing",
      likelyLiveOpportunity: false,
      blockers: ["No portal URL has been captured yet for this opportunity."],
      warnings: [],
      recommendedActions: [
        "Run portal discovery on the live opportunity page or paste the application instructions text.",
      ],
      probe: input.probe,
    };
  }

  if (isPlaceholderPortalUrl(normalizedPortalUrl)) {
    return {
      normalizedPortalUrl,
      preferredBrowserUrl: null,
      submissionMethod,
      level: "Blocked",
      kind: "placeholder",
      likelyLiveOpportunity: false,
      blockers: [
        "Portal URL is still a placeholder/demo link and is not safe for a real browser handoff.",
      ],
      warnings: [],
      recommendedActions: [
        "Replace the placeholder with a live opportunity page or a discovered application URL.",
      ],
      probe: input.probe,
    };
  }

  if (submissionMethod === "Email") {
    kind = "email";
    likelyLiveOpportunity = normalizedPortalUrl.toLowerCase().startsWith("mailto:");
    if (!likelyLiveOpportunity) {
      level = "Needs Review";
      warnings.push(
        "Submission method is email, but the saved target is not a direct mailto link yet.",
      );
      recommendedActions.push(
        "Capture the actual submission email address if the funder uses an email-only workflow.",
      );
    }
  } else {
    try {
      const parsed = new URL(normalizedPortalUrl);
      const lowerPath = parsed.pathname.toLowerCase();
      const hasActionPath = /\/(apply|submit|application|grant|portal)/.test(lowerPath);

      if (/submittable\.com$/i.test(parsed.host)) {
        if (lowerPath === "/submit" || lowerPath === "/submit/") {
          kind = "submittable-landing";
          level = "Blocked";
          blockers.push(
            "Portal URL still points to a generic Submittable landing page instead of a specific application form.",
          );
          recommendedActions.push(
            "Capture the direct Submittable application URL, usually under /submit/<id>/<slug>.",
          );
        } else if (/^\/submit\/[^/?#]+/.test(lowerPath)) {
          kind = "submittable-application";
          likelyLiveOpportunity = true;
        } else if (/^\/(login|u\/login)\b/.test(lowerPath)) {
          kind = "submittable-login";
          level = "Needs Review";
          warnings.push(
            "Portal URL still lands on a Submittable login page. It may work, but a direct application URL is safer for automation.",
          );
          recommendedActions.push(
            "Prefer the application-specific Submittable link so browser handoff opens the correct form immediately.",
          );
        } else {
          kind = "submittable-login";
          level = "Needs Review";
          warnings.push(
            "Submittable URL does not clearly point to a specific application record yet.",
          );
          recommendedActions.push(
            "Capture the direct application URL instead of a generic account or listing page.",
          );
        }
      } else if (submissionMethod === "Portal" || isLikelyPortalHost(parsed.host)) {
        kind = "generic-portal";
        likelyLiveOpportunity = hasActionPath || Boolean(parsed.search);
        if (lowerPath === "/" && !parsed.search) {
          level = "Needs Review";
          warnings.push(
            "Portal URL points to a portal home page, not clearly to a specific opportunity.",
          );
          recommendedActions.push(
            "Use the deepest opportunity-specific portal link available before launching automation.",
          );
        }
      } else {
        kind = "other";
        level = "Needs Review";
        warnings.push(
          "The saved URL does not look like a recognized grant portal yet, so launch should stay human-reviewed.",
        );
        recommendedActions.push(
          "Verify that the opportunity really submits through this URL before using browser automation.",
        );
      }
    } catch {
      level = "Blocked";
      kind = "other";
      blockers.push("Portal URL is malformed and cannot be used for a real browser handoff.");
      recommendedActions.push("Save a valid https:// application link before launch.");
    }
  }

  if (input.probe?.attempted) {
    if (!input.probe.reachable) {
      warnings.push(
        input.probe.errorMessage
          ? `Live portal probe could not confirm the page: ${input.probe.errorMessage}`
          : "Live portal probe could not confirm the page from this environment.",
      );
    }

    if ((input.probe.httpStatus ?? 0) >= 400) {
      level = "Blocked";
      blockers.push(
        `Portal URL returned HTTP ${input.probe.httpStatus} during the live probe.`,
      );
    }

    if (
      input.probe.pageTitle &&
      /\b(404|not found|page not found|error)\b/i.test(input.probe.pageTitle)
    ) {
      level = "Blocked";
      blockers.push(`Portal page title suggests the destination is broken: ${input.probe.pageTitle}`);
    }
  }

  return {
    normalizedPortalUrl,
    preferredBrowserUrl: level === "Blocked" ? null : normalizedPortalUrl,
    submissionMethod,
    level,
    kind,
    likelyLiveOpportunity,
    blockers,
    warnings,
    recommendedActions,
    probe: input.probe,
  };
};

export class PortalDiscoveryService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly config: AppEnv,
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

  async run(input: PortalDiscoveryInput): Promise<PortalDiscoveryResult> {
    const [opportunity] = input.opportunityId
      ? await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, input.opportunityId))
          .limit(1)
      : [];

    if (input.opportunityId && !opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const sourceUrl =
      this.normalizeDiscoverableSourceUrl(input.sourceUrl) ||
      this.normalizeDiscoverableSourceUrl(opportunity?.sourceUrl) ||
      this.fallbackSourceUrl(opportunity?.portalUrl);
    const inspection = await this.inspect({
      sourceUrl: sourceUrl || undefined,
      rawText: input.rawText,
    });

    let persisted: PortalDiscoveryResult["persisted"];
    let notionSync: PortalDiscoveryResult["notionSync"];

    if (opportunity) {
      const now = new Date().toISOString();
      await db
        .update(opportunities)
        .set({
          sourceUrl: inspection.sourceUrl ?? opportunity.sourceUrl ?? null,
          portalUrl:
            inspection.portalReadiness.preferredBrowserUrl ??
            inspection.discoveredPortalUrl ??
            opportunity.portalUrl ??
            null,
          submissionMethod: inspection.submissionMethod ?? opportunity.submissionMethod ?? null,
          portalDiscoveredAt:
            inspection.portalReadiness.preferredBrowserUrl || inspection.discoveredPortalUrl
              ? now
              : opportunity.portalDiscoveredAt,
          updatedAt: now,
        })
        .where(eq(opportunities.id, opportunity.id));

      persisted = {
        opportunityId: opportunity.id,
        sourceUrl: inspection.sourceUrl ?? opportunity.sourceUrl ?? null,
        portalUrl:
          inspection.portalReadiness.preferredBrowserUrl ??
          inspection.discoveredPortalUrl ??
          opportunity.portalUrl ??
          null,
        submissionMethod: inspection.submissionMethod ?? opportunity.submissionMethod ?? null,
        portalDiscoveredAt:
          inspection.portalReadiness.preferredBrowserUrl || inspection.discoveredPortalUrl
            ? now
            : opportunity.portalDiscoveredAt,
      };

      if (input.syncToNotion && this.notionClient) {
        try {
          notionSync = await this.notionClient.syncOpportunityPortalDiscovery({
            opportunityId: opportunity.id,
            opportunityTitle: opportunity.title,
            sourceUrl: persisted.sourceUrl,
            portalUrl: persisted.portalUrl,
            submissionMethod: persisted.submissionMethod,
          });
        } catch (error) {
          if (isNotionAuthorizationError(error)) {
            throw error;
          }
          this.logger.warn({ error, opportunityId: opportunity.id }, "Skipping Notion sync for portal discovery");
        }
      }
    }

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Portal Discovery Agent",
      actionDescription: "Discovered and persisted a likely grant application portal URL",
      sourceUrl: sourceUrl || null,
      confidenceLevel: inspection.discoveredPortalUrl ? 0.9 : 0.55,
      outputSummary: inspection.discoveredPortalUrl
        ? `Discovered ${inspection.submissionMethod ?? "Portal"} application URL for ${opportunity?.title ?? sourceUrl ?? "source input"}.`
        : `No confident application portal URL was discovered for ${opportunity?.title ?? sourceUrl ?? "source input"}.`,
      followUpRequired: !inspection.discoveredPortalUrl,
    });

    return {
      opportunityId: opportunity?.id,
      opportunityTitle: opportunity?.title,
      sourceUrl: inspection.sourceUrl ?? sourceUrl ?? null,
      discoveredPortalUrl: inspection.discoveredPortalUrl,
      submissionMethod: inspection.submissionMethod,
      candidates: inspection.candidates,
      notes: inspection.notes,
      portalReadiness: inspection.portalReadiness,
      persisted,
      notionSync,
    };
  }

  async assessReadiness(input: {
    opportunityId?: string;
    portalUrl?: string | null;
    submissionMethod?: SupportedSubmissionMethod | string | null;
    probe?: boolean;
  }) {
    const [opportunity] = input.opportunityId
      ? await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, input.opportunityId))
          .limit(1)
      : [];

    if (input.opportunityId && !opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const portalUrl = normalizeText(input.portalUrl) || opportunity?.portalUrl || null;
    const submissionMethod =
      toSupportedSubmissionMethod(input.submissionMethod) ??
      toSupportedSubmissionMethod(opportunity?.submissionMethod) ??
      toSupportedSubmissionMethod(portalUrl);

    const probe = input.probe ? await this.probePortalUrl(portalUrl) : undefined;
    const portalReadiness = assessPortalReadiness({
      portalUrl,
      submissionMethod,
      sourceUrl: opportunity?.sourceUrl ?? null,
      probe,
    });

    return {
      opportunityId: opportunity?.id,
      opportunityTitle: opportunity?.title,
      portalUrl,
      submissionMethod,
      portalReadiness,
    };
  }

  async inspect(input: {
    sourceUrl?: string;
    rawText?: string;
  }): Promise<PortalDiscoveryInspection> {
    const notes: string[] = [];
    const candidates = new Map<string, PortalDiscoveryCandidate>();
    const normalizedSourceUrl = this.normalizeDiscoverableSourceUrl(input.sourceUrl) || undefined;
    const normalizedRawText = normalizeText(input.rawText);

    if (normalizedSourceUrl) {
      await this.inspectSourceUrl(normalizedSourceUrl, candidates, notes);
    } else if (normalizeText(input.sourceUrl)) {
      notes.push("The stored source URL is still a placeholder, so portal discovery needs a real opportunity page or copied application text.");
    }

    if (normalizedRawText) {
      for (const rawUrl of this.extractUrlsFromText(normalizedRawText)) {
        this.pushCandidate(candidates, {
          url: rawUrl,
          source: "raw-text",
          label: "URL from provided text",
          sourceUrl: normalizedSourceUrl,
        });
      }

      for (const emailAddress of this.extractEmailsFromText(normalizedRawText)) {
        this.pushCandidate(candidates, {
          url: `mailto:${emailAddress}`,
          source: "raw-text",
          label: `Submission email ${emailAddress}`,
          sourceUrl: normalizedSourceUrl,
        });
      }
    }

    const ranked = [...candidates.values()].sort((left, right) => right.score - left.score);
    const best = ranked.find((candidate) => candidate.score >= 40) ?? null;
    const portalReadiness = assessPortalReadiness({
      portalUrl: best?.url ?? null,
      submissionMethod: best?.method ?? null,
      sourceUrl: normalizedSourceUrl ?? null,
    });

    if (!best) {
      notes.push("No confident application portal was discovered yet.");
    } else if (best.method === "Submittable") {
      notes.push("A likely Submittable application link was discovered and ranked highest.");
    } else if (best.method === "Email") {
      notes.push("The strongest submission path found was an email-based workflow, not a portal.");
    } else {
      notes.push("A likely non-Submittable portal application link was discovered.");
    }

    return {
      sourceUrl: normalizedSourceUrl ?? null,
      discoveredPortalUrl: best?.url ?? null,
      submissionMethod: best?.method ?? null,
      candidates: ranked.slice(0, 10),
      notes,
      portalReadiness,
    };
  }

  private async inspectSourceUrl(
    sourceUrl: string,
    candidates: Map<string, PortalDiscoveryCandidate>,
    notes: string[],
  ) {
    this.pushCandidate(candidates, {
      url: sourceUrl,
      source: "source-url",
      label: "Source URL",
      sourceUrl,
    });

    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": this.config.USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to discover a portal from source URL: ${response.status} ${response.statusText}`,
      );
    }

    const finalUrl = response.url;
    if (normalizeText(finalUrl) && normalizeText(finalUrl) !== normalizeText(sourceUrl)) {
      this.pushCandidate(candidates, {
        url: finalUrl,
        source: "redirect",
        label: "Final fetched URL",
        sourceUrl,
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("html")) {
      notes.push("Source URL did not return HTML, so portal discovery relied on direct URL scoring.");
      return;
    }

    const html = await response.text();
    const $ = load(html);
    $("script, style, noscript").remove();

    $("a[href]").each((_, element) => {
      const href = normalizeText($(element).attr("href"));
      const label = normalizeText($(element).text()) || normalizeText($(element).attr("aria-label"));
      if (!href) {
        return;
      }

      try {
        const resolved = new URL(href, finalUrl).toString();
        this.pushCandidate(candidates, {
          url: resolved,
          source: "page-link",
          label,
          sourceUrl: finalUrl,
        });
      } catch {
        // Ignore unparseable hrefs.
      }
    });

    $("form[action]").each((_, element) => {
      const action = normalizeText($(element).attr("action"));
      if (!action) {
        return;
      }

      try {
        const resolved = new URL(action, finalUrl).toString();
        this.pushCandidate(candidates, {
          url: resolved,
          source: "page-form",
          label: normalizeText($(element).attr("aria-label")) || "Form action",
          sourceUrl: finalUrl,
        });
      } catch {
        // Ignore unparseable form actions.
      }
    });
  }

  private pushCandidate(
    candidates: Map<string, PortalDiscoveryCandidate>,
    input: {
      url: string;
      label?: string;
      source: PortalDiscoveryCandidate["source"];
      sourceUrl?: string | null;
    },
  ) {
    const normalizedUrl = normalizeText(input.url);
    const candidateUrl = normalizePortalTargetUrl(normalizedUrl);
    if (!candidateUrl) {
      return;
    }

    const score = scoreCandidate({
      url: candidateUrl,
      label: input.label,
      source: input.source,
      sourceUrl: input.sourceUrl,
    });
    if (score < 0) {
      return;
    }

    const method = toSubmissionMethod(candidateUrl);
    const host = candidateUrl.startsWith("mailto:")
      ? candidateUrl.replace(/^mailto:/i, "")
      : new URL(candidateUrl).host.toLowerCase();

    const existing = candidates.get(candidateUrl);
    if (existing && existing.score >= score) {
      return;
    }

    candidates.set(candidateUrl, {
      url: candidateUrl,
      label: normalizeText(input.label) || undefined,
      source: input.source,
      score,
      host,
      method,
    });
  }

  private extractUrlsFromText(rawText: string) {
    return [...rawText.matchAll(/https?:\/\/[^\s)>"']+/gi)].map((match) => match[0]);
  }

  private extractEmailsFromText(rawText: string) {
    return [...rawText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(
      (match) => match[0],
    );
  }

  private fallbackSourceUrl(portalUrl?: string | null) {
    const normalizedPortalUrl = normalizeText(portalUrl);
    if (!normalizedPortalUrl) {
      return null;
    }

    if (isPlaceholderPortalUrl(normalizedPortalUrl)) {
      return null;
    }

    return normalizedPortalUrl;
  }

  private normalizeDiscoverableSourceUrl(sourceUrl?: string | null) {
    const normalizedSourceUrl = normalizeText(sourceUrl);
    if (!normalizedSourceUrl || isPlaceholderPortalUrl(normalizedSourceUrl)) {
      return null;
    }

    return normalizedSourceUrl;
  }

  private async probePortalUrl(portalUrl?: string | null): Promise<PortalProbeResult> {
    const normalizedPortalUrl = normalizePortalTargetUrl(portalUrl);
    if (!normalizedPortalUrl || normalizedPortalUrl.toLowerCase().startsWith("mailto:")) {
      return {
        attempted: false,
        reachable: false,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(normalizedPortalUrl, {
        headers: {
          "User-Agent": this.config.USER_AGENT,
        },
        redirect: "follow",
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      let pageTitle: string | null = null;
      if (contentType.includes("html")) {
        const html = await response.text();
        const $ = load(html);
        pageTitle = normalizeText($("title").first().text()) || null;
      }

      return {
        attempted: true,
        reachable: response.ok,
        httpStatus: response.status,
        finalUrl: normalizePortalTargetUrl(response.url),
        pageTitle,
      };
    } catch (error) {
      return {
        attempted: true,
        reachable: false,
        errorMessage: error instanceof Error ? error.message : "Unknown probe error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
