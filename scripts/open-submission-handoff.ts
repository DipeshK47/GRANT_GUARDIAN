import "dotenv/config";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { chromium } from "playwright";
import { env } from "../apps/orchestrator/src/config/env.js";
import { db } from "../apps/orchestrator/src/db/client.js";
import {
  agentLogs,
  opportunities,
  organizations,
  submissionFieldMappings,
  submissionSessions,
} from "../apps/orchestrator/src/db/schema.js";
import { prepareCliRequestContext } from "../apps/orchestrator/src/lib/cli-request-context.js";
import {
  NotionMcpClient,
  isNotionAuthorizationError,
} from "../apps/orchestrator/src/services/notion/client.js";
import {
  matchPortalFieldsToMappings,
  type PlannedPortalFieldMapping,
  type PortalFieldInventoryItem,
} from "../apps/orchestrator/src/services/opportunities/submission-form-fill.js";
import { PortalSchemaProfileService } from "../apps/orchestrator/src/services/opportunities/portal-schema.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let portalUrl: string | undefined;
  let submissionSessionId: string | undefined;
  let opportunityTitle: string | undefined;
  let storageStatePath: string | undefined;
  let clerkUserId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--portal-url=")) {
      portalUrl = arg.replace("--portal-url=", "");
      continue;
    }

    if (arg === "--portal-url") {
      portalUrl = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--submission-session-id=")) {
      submissionSessionId = arg.replace("--submission-session-id=", "");
      continue;
    }

    if (arg === "--submission-session-id") {
      submissionSessionId = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--opportunity-title=")) {
      opportunityTitle = arg.replace("--opportunity-title=", "");
      continue;
    }

    if (arg === "--opportunity-title") {
      opportunityTitle = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--storage-state-path=")) {
      storageStatePath = arg.replace("--storage-state-path=", "");
      continue;
    }

    if (arg === "--storage-state-path") {
      storageStatePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--clerk-user-id=")) {
      clerkUserId = arg.replace("--clerk-user-id=", "");
      continue;
    }

    if (arg === "--clerk-user-id") {
      clerkUserId = args[index + 1];
      index += 1;
    }
  }

  return {
    portalUrl,
    submissionSessionId,
    opportunityTitle,
    storageStatePath,
    clerkUserId,
  };
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const pathExists = async (targetPath?: string) => {
  if (!targetPath) {
    return false;
  }

  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const parseFieldKey = (key: string) => {
  const [kind, indexText] = key.split(":");
  return {
    kind,
    index: Number.parseInt(indexText ?? "-1", 10),
  };
};

const loadMappings = async (submissionSessionId?: string) => {
  if (!submissionSessionId) {
    return [] as PlannedPortalFieldMapping[];
  }

  const rows = await db
    .select()
    .from(submissionFieldMappings)
    .where(eq(submissionFieldMappings.submissionSessionId, submissionSessionId));

  return rows.map((row) => ({
    id: row.id,
    requirementId: row.requirementId,
    fieldLabel: row.fieldLabel,
    fieldType: row.fieldType as PlannedPortalFieldMapping["fieldType"],
    sourceKind: row.sourceKind as PlannedPortalFieldMapping["sourceKind"],
    sourceRecordId: row.sourceRecordId,
    fillAction: row.fillAction as PlannedPortalFieldMapping["fillAction"],
    mappingStatus: row.mappingStatus as PlannedPortalFieldMapping["mappingStatus"],
    plannedValue: row.plannedValue,
    artifactTitle: row.artifactTitle,
    confidence: row.confidence ?? 0,
    needsHumanReview: row.needsHumanReview,
    notes: row.notes,
  }));
};

const collectPortalFields = async (page: import("playwright").Page) => {
  const textFields = page.locator(
    "textarea, input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])",
  );
  const uploadFields = page.locator("input[type=file]");

  const collected: PortalFieldInventoryItem[] = [];

  const collectFromLocator = async (
    locator: import("playwright").Locator,
    kind: "text" | "file",
  ) => {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const field = locator.nth(index);
      const descriptor = await field.evaluate((element) => {
        const asHtmlElement = element as HTMLElement;
        const id = asHtmlElement.getAttribute("id");
        const directLabel =
          (id ? document.querySelector(`label[for="${id}"]`) : null)?.textContent ?? "";
        const parentLabel = asHtmlElement.closest("label")?.textContent ?? "";
        const ariaLabel =
          asHtmlElement.getAttribute("aria-label") ??
          asHtmlElement.getAttribute("name") ??
          "";
        const placeholder = asHtmlElement.getAttribute("placeholder") ?? "";
        const text = [directLabel, parentLabel, ariaLabel, placeholder]
          .map((value) => value?.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ");
        return {
          label: text || `Field ${index + 1}`,
          tagName: asHtmlElement.tagName.toLowerCase(),
          type:
            asHtmlElement instanceof HTMLInputElement
              ? asHtmlElement.type
              : asHtmlElement.getAttribute("type") ?? kind,
          placeholder,
          ariaLabel,
        };
      });

      collected.push({
        key: `${kind}:${index}`,
        label: descriptor.label,
        tagName: descriptor.tagName,
        type: descriptor.type,
        placeholder: descriptor.placeholder,
        ariaLabel: descriptor.ariaLabel,
      });
    }
  };

  await collectFromLocator(textFields, "text");
  await collectFromLocator(uploadFields, "file");

  return collected;
};

const updateMappingAttempt = async (input: {
  mappingId: string;
  status: "Filled" | "Needs Review" | "Skipped" | "Paused";
  matchedPortalLabel?: string;
  confidence: number;
  notes?: string;
}) => {
  await db
    .update(submissionFieldMappings)
    .set({
      mappingStatus: input.status,
      matchedPortalLabel: input.matchedPortalLabel ?? null,
      confidence: input.confidence,
      notes: normalizeText(input.notes) || null,
      lastAttemptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(submissionFieldMappings.id, input.mappingId));
};

const summarizeValue = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 90) {
    return normalized;
  }

  return `${normalized.slice(0, 87).trimEnd()}...`;
};

const detectFinalSubmitLabel = async (page: import("playwright").Page) => {
  const controls = page.locator("button, input[type=submit], [role=button]");
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const label = normalizeText(
      await controls.nth(index).evaluate((element) => {
        const htmlElement = element as HTMLElement;
        return (
          htmlElement.innerText ||
          htmlElement.textContent ||
          htmlElement.getAttribute("value") ||
          htmlElement.getAttribute("aria-label") ||
          ""
        );
      }),
    );
    if (/\bsubmit\b|\bfinal\b|\breview and submit\b|\bsend application\b/i.test(label)) {
      return label;
    }
  }

  return null;
};

const updateSessionStatus = async (submissionSessionId: string, status: string) => {
  await db
    .update(submissionSessions)
    .set({
      status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(submissionSessions.id, submissionSessionId));
};

const logBrowserAction = async (input: {
  submissionSessionId?: string;
  opportunityId?: string | null;
  opportunityTitle?: string | null;
  line: string;
  followUpRequired?: boolean;
  notionClient?: NotionMcpClient | null;
}) => {
  const summary = normalizeText(input.line);
  if (!summary || !input.submissionSessionId) {
    return;
  }

  await db.insert(agentLogs).values({
    runId: input.submissionSessionId,
    sourceUrl: `submission-session:${input.submissionSessionId}`,
    agentName: "Submission Autopilot Agent",
    actionDescription: "Recorded browser handoff action",
    confidenceLevel: 0.98,
    outputSummary: summary,
    followUpRequired: Boolean(input.followUpRequired),
  });

  if (input.notionClient && input.opportunityTitle) {
    try {
      await input.notionClient.appendOpportunityHandoffLog({
        opportunityId: input.opportunityId ?? null,
        opportunityTitle: input.opportunityTitle,
        line: summary,
      });
    } catch (error) {
      if (isNotionAuthorizationError(error)) {
        console.warn("Skipping Notion handoff log append because authorization is unavailable.");
        return;
      }
      console.warn("Skipping Notion handoff log append:", error);
    }
  }
};

const injectOverlay = async (
  page: import("playwright").Page,
  input: {
    opportunityTitle: string;
    autoFilled: string[];
    uploadReady: string[];
    manualReview: string[];
  },
) => {
  await page.evaluate((payload) => {
    const existing = document.getElementById("grant-guardian-overlay");
    existing?.remove();

    const container = document.createElement("aside");
    container.id = "grant-guardian-overlay";
    container.style.position = "fixed";
    container.style.top = "16px";
    container.style.right = "16px";
    container.style.width = "360px";
    container.style.maxHeight = "calc(100vh - 32px)";
    container.style.overflow = "auto";
    container.style.zIndex = "2147483647";
    container.style.background = "rgba(17, 24, 39, 0.96)";
    container.style.color = "#f9fafb";
    container.style.border = "1px solid rgba(255,255,255,0.12)";
    container.style.borderRadius = "16px";
    container.style.padding = "16px";
    container.style.boxShadow = "0 16px 48px rgba(0,0,0,0.35)";
    container.style.fontFamily =
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    const title = document.createElement("h2");
    title.textContent = "Grant Guardian Guided Fill";
    title.style.margin = "0 0 8px 0";
    title.style.fontSize = "20px";
    container.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.textContent = payload.opportunityTitle;
    subtitle.style.margin = "0 0 12px 0";
    subtitle.style.fontSize = "13px";
    subtitle.style.opacity = "0.8";
    container.appendChild(subtitle);

    const sections = [
      {
        heading: "Auto-filled",
        items: payload.autoFilled,
      },
      {
        heading: "Uploads ready",
        items: payload.uploadReady,
      },
      {
        heading: "Needs review",
        items: payload.manualReview,
      },
    ];

    for (const section of sections) {
      const heading = document.createElement("h3");
      heading.textContent = section.heading;
      heading.style.margin = "14px 0 6px 0";
      heading.style.fontSize = "13px";
      heading.style.textTransform = "uppercase";
      heading.style.letterSpacing = "0.08em";
      heading.style.opacity = "0.72";
      container.appendChild(heading);

      const list = document.createElement("ul");
      list.style.margin = "0";
      list.style.paddingLeft = "18px";
      list.style.fontSize = "13px";
      list.style.lineHeight = "1.5";
      const items = section.items.length > 0 ? section.items : ["None yet."];
      for (const itemText of items) {
        const item = document.createElement("li");
        item.textContent = itemText;
        list.appendChild(item);
      }
      container.appendChild(list);
    }

    const guardrail = document.createElement("p");
    guardrail.textContent =
      "Guardrail: Grant Guardian will not click Submit. Review every answer and attachment manually before any final action.";
    guardrail.style.margin = "14px 0 0 0";
    guardrail.style.paddingTop = "12px";
    guardrail.style.borderTop = "1px solid rgba(255,255,255,0.12)";
    guardrail.style.fontSize = "12px";
    guardrail.style.lineHeight = "1.5";
    guardrail.style.color = "#fca5a5";
    container.appendChild(guardrail);

    document.body.appendChild(container);
  }, input);
};

const main = async () => {
  const args = parseArgs();
  if (!args.portalUrl) {
    throw new Error("Provide --portal-url=<portal-url>.");
  }

  await prepareCliRequestContext({
    args: args.clerkUserId ? [`--clerk-user-id=${args.clerkUserId}`] : [],
    syncToNotion: Boolean(args.clerkUserId),
    logger: {
      info: (payload, message) => console.log(message ?? "info", payload),
      warn: (payload, message) => console.warn(message ?? "warn", payload),
    },
  });

  const notionClient = args.clerkUserId ? new NotionMcpClient(env) : null;
  const storageStatePresent = await pathExists(args.storageStatePath);
  const mappings = await loadMappings(args.submissionSessionId);
  const portalSchemaService = new PortalSchemaProfileService();
  const [session] = args.submissionSessionId
    ? await db
        .select()
        .from(submissionSessions)
        .where(eq(submissionSessions.id, args.submissionSessionId))
        .limit(1)
    : [];
  const [opportunity] =
    session?.opportunityId
      ? await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, session.opportunityId))
          .limit(1)
      : [];
  const [organization] =
    session?.organizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, session.organizationId))
          .limit(1)
      : [];
  const effectiveOpportunityTitle =
    args.opportunityTitle ?? normalizeText(opportunity?.title) ?? "Submission Portal";
  const logContext = {
    submissionSessionId: session?.id,
    opportunityId: opportunity?.id ?? null,
    opportunityTitle: effectiveOpportunityTitle,
    notionClient,
  };

  console.log("");
  console.log("Grant Guardian: guided submission handoff");
  console.log("-----------------------------------------");
  console.log(`Opportunity: ${effectiveOpportunityTitle}`);
  console.log(`Submission session: ${args.submissionSessionId ?? "unknown"}`);
  console.log(`Portal URL: ${args.portalUrl}`);
  console.log(
    storageStatePresent
      ? `Using saved browser session: ${args.storageStatePath}`
      : "No saved browser session found. Manual login may still be required.",
  );
  console.log(`Stored field mappings: ${mappings.length}`);
  console.log("");

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    storageState: storageStatePresent ? args.storageStatePath : undefined,
  });
  const page = await context.newPage();

  try {
    if (session?.id) {
      await updateSessionStatus(session.id, "Browser Launch Triggered");
    }
    await logBrowserAction({
      ...logContext,
      line: `Opened Submittable browser handoff for ${effectiveOpportunityTitle}.`,
    });

    await page.goto(args.portalUrl, {
      waitUntil: "domcontentloaded",
    });

    const portalFields = await collectPortalFields(page);
    const schemaCapture = await portalSchemaService.capture({
      submissionSessionId: args.submissionSessionId,
      portalUrl: args.portalUrl,
      fields: portalFields,
      captureSource: "Guided Handoff",
    });
    const profileHints = args.submissionSessionId
      ? await portalSchemaService.getProfileHintsForSession(args.submissionSessionId)
      : await portalSchemaService.getProfileHints(args.portalUrl);
    const matches = matchPortalFieldsToMappings(mappings, portalFields, profileHints.profiles);
    const textFields = page.locator(
      "textarea, input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])",
    );
    const uploadFields = page.locator("input[type=file]");

    const autoFilled: string[] = [];
    const uploadReady: string[] = [];
    const pausedForHumanInput: string[] = [];
    const notReached: string[] = [];

    for (const mapping of mappings) {
      const match = matches.find((item) => item.mappingId === mapping.id);
      if (!match || !match.portalFieldKey) {
        const notReachedLine = `Not reached: ${mapping.fieldLabel}`;
        notReached.push(`${mapping.fieldLabel}: field not reached or no confident match found yet`);
        await updateMappingAttempt({
          mappingId: mapping.id,
          status: "Skipped",
          confidence: match?.confidence ?? mapping.confidence,
          notes: "Field not reached on the current portal screen or no confident match was found yet.",
        });
        await logBrowserAction({
          ...logContext,
          line: notReachedLine,
        });
        continue;
      }

      const parsedKey = parseFieldKey(match.portalFieldKey);

      if (mapping.sourceKind === "draft_answer") {
        const pausedLine = `Paused at: ${mapping.fieldLabel} (narrative - human review required)`;
        pausedForHumanInput.push(pausedLine);
        await updateMappingAttempt({
          mappingId: mapping.id,
          status: "Paused",
          matchedPortalLabel: match.matchedPortalLabel,
          confidence: match.confidence,
          notes:
            match.notes ??
            "Narrative answer is intentionally paused for human review before any portal paste.",
        });
        await logBrowserAction({
          ...logContext,
          line: pausedLine,
          followUpRequired: true,
        });
        continue;
      }

      if (mapping.fillAction === "type" && match.shouldAutofill && mapping.plannedValue) {
        await textFields.nth(parsedKey.index).fill(mapping.plannedValue);
        const filledLine = `Filled: ${mapping.fieldLabel} -> ${summarizeValue(mapping.plannedValue)}`;
        autoFilled.push(`${mapping.fieldLabel} -> ${match.matchedPortalLabel ?? "matched field"}`);
        await updateMappingAttempt({
          mappingId: mapping.id,
          status: "Filled",
          matchedPortalLabel: match.matchedPortalLabel,
          confidence: match.confidence,
          notes: "Auto-filled by guided portal handoff.",
        });
        await logBrowserAction({
          ...logContext,
          line: filledLine,
        });
        continue;
      }

      if (mapping.fillAction === "upload" && parsedKey.kind === "file") {
        const uploadPath = normalizeText(mapping.plannedValue);
        if (uploadPath && (await pathExists(uploadPath))) {
          await uploadFields.nth(parsedKey.index).setInputFiles(uploadPath);
          const filledLine = `Filled: ${mapping.fieldLabel} -> ${summarizeValue(mapping.artifactTitle ?? uploadPath)}`;
          uploadReady.push(`${mapping.fieldLabel} -> ${mapping.artifactTitle ?? uploadPath}`);
          await updateMappingAttempt({
            mappingId: mapping.id,
            status: "Filled",
            matchedPortalLabel: match.matchedPortalLabel,
            confidence: match.confidence,
            notes: "Upload field populated automatically.",
          });
          await logBrowserAction({
            ...logContext,
            line: filledLine,
          });
          continue;
        }
      }

      const pausedLine =
        mapping.fillAction === "upload"
          ? `Paused at: ${mapping.fieldLabel} (upload still needs human file selection)`
          : `Paused at: ${mapping.fieldLabel} (human review required)`;
      pausedForHumanInput.push(pausedLine);
      await updateMappingAttempt({
        mappingId: mapping.id,
        status: "Paused",
        matchedPortalLabel: match.matchedPortalLabel,
        confidence: match.confidence,
        notes:
          match.notes ??
          (mapping.fillAction === "upload"
            ? "Upload still needs manual file selection."
            : "Suggested portal field match should be reviewed by a human."),
      });
      await logBrowserAction({
        ...logContext,
        line: pausedLine,
        followUpRequired: true,
      });
    }

    const finalSubmitLabel = await detectFinalSubmitLabel(page);
    if (finalSubmitLabel) {
      const finalSubmitLine = `Paused at: ${finalSubmitLabel} (final submit - human review required)`;
      pausedForHumanInput.push(finalSubmitLine);
      await logBrowserAction({
        ...logContext,
        line: finalSubmitLine,
        followUpRequired: true,
      });
    }

    const learningSummary = await portalSchemaService.learnFromMatches({
      submissionSessionId: args.submissionSessionId,
      portalUrl: args.portalUrl,
      fields: portalFields,
      mappings: mappings.map((mapping) => ({
        id: mapping.id,
        fieldLabel: mapping.fieldLabel,
      })),
      matches: matches.map((match) => ({
        mappingId: match.mappingId,
        portalFieldKey: match.portalFieldKey,
        confidence: match.confidence,
        fillAction: match.fillAction,
      })),
    });

    await injectOverlay(page, {
      opportunityTitle: effectiveOpportunityTitle,
      autoFilled,
      uploadReady,
      manualReview: pausedForHumanInput.length > 0 ? pausedForHumanInput : notReached,
    });

    if (session) {
      await updateSessionStatus(
        session.id,
        pausedForHumanInput.length > 0 ? "Waiting for Human Input" : "Guided Fill In Progress",
      );
    }

    console.log("Guided fill browser is open.");
    console.log(`Detected portal fields: ${portalFields.length}`);
    console.log(
      `Reusable portal profiles: ${profileHints.profileSummary.totalProfiles} known, ${profileHints.profileSummary.matchedProfiles} with learned matches`,
    );
    console.log(
      `Portal schema capture: ${schemaCapture.profileSummary.newProfiles} new profile(s), ${schemaCapture.profileSummary.updatedProfiles} refreshed`,
    );
    console.log(
      `Portal profile learning updated ${learningSummary.updatedProfiles} profile(s), reusing ${learningSummary.reusedProfiles} prior match hint(s)`,
    );
    console.log(`Auto-filled profile fields: ${autoFilled.length}`);
    console.log(`Upload fields auto-filled: ${uploadReady.length}`);
    console.log(`Fields paused for human input: ${pausedForHumanInput.length}`);
    console.log("Grant Guardian will not click Submit.");

    await logBrowserAction({
      ...logContext,
      line:
        pausedForHumanInput.length > 0
          ? "Waiting for human input. Review the paused narrative or final submit step in the open browser."
          : "Guided fill is in progress in the open browser.",
      followUpRequired: pausedForHumanInput.length > 0,
    });

    await browser.waitForEvent("disconnected");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error("");
  console.error("Failed to open the guided submission handoff browser.");
  console.error(error);
  process.exit(1);
});
