import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import { resolveOrganizationId } from "../../lib/organization-scope.js";
import { getCurrentClerkUserId } from "../../lib/request-context.js";
import {
  agentLogs,
  opportunities,
  submissions,
  submissionSessions,
} from "../../db/schema.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import type { PortalReadinessResult } from "./portal-discovery.js";
import {
  SubmissionFormFillService,
  type PortalFieldPlanResult,
} from "./submission-form-fill.js";
import { SubmissionPacketService } from "./submission-packet.js";
import { FileStorageService } from "../storage/file-storage.js";
import type { SubmissionAdapterPlan } from "./submission-adapters.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type LaunchStatus = "Prepared" | "Browser Launch Triggered" | "Final Submit Authorized";
type LaunchMode =
  | "Handoff Only"
  | "Browser Launch"
  | "Email Draft"
  | "Manual Handoff";

export type SubmissionAutopilotLaunchInput = {
  opportunityId: string;
  confirmLaunch?: boolean;
  launchBrowser?: boolean;
  reviewerName?: string;
  reviewerNotes?: string;
  syncToNotion?: boolean;
};

export type SubmissionAutopilotLaunchResult = {
  opportunityId: string;
  opportunityTitle: string;
  submissionRecordId: string;
  submissionSessionId: string;
  submissionMethod: "Submittable" | "Email" | "Portal" | "Other";
  portalUrl: string;
  portalReadiness: PortalReadinessResult;
  adapterPlan: SubmissionAdapterPlan;
  reviewReadiness: Awaited<
    ReturnType<SubmissionPacketService["run"]>
  >["reviewReadiness"];
  safetyGate: Awaited<ReturnType<SubmissionPacketService["run"]>>["safetyGate"];
  launchStatus: Extract<LaunchStatus, "Prepared" | "Browser Launch Triggered">;
  launchMode: LaunchMode;
  browserLaunchTriggered: boolean;
  storageStatePath: string;
  storageStatePresent: boolean;
  launchCommand: string;
  warnings: string[];
  finalSubmitGate:
    | {
        finalSubmitAuthorized: false;
        requiresSecondConfirmation: true;
        authorizeCommand: string;
        authorizeEndpoint: string;
      }
    | {
        finalSubmitAuthorized: false;
        requiresSecondConfirmation: false;
        reason: string;
      };
  fieldPlan?: PortalFieldPlanResult["mappingSummary"];
  guidedFillCommand?: string;
  emailDraft?: SubmissionAdapterPlan["emailDraft"];
  notionSync?: {
    submissionPageId: string;
  };
};

export type FinalSubmitAuthorizationInput = {
  submissionSessionId: string;
  confirmFinalSubmit?: boolean;
  reviewerName?: string;
  reviewerNotes?: string;
  syncToNotion?: boolean;
};

export type FinalSubmitAuthorizationResult = {
  submissionSessionId: string;
  submissionRecordId: string;
  opportunityId: string;
  opportunityTitle: string;
  status: "Final Submit Authorized";
  reviewerName: string;
  reviewerNotes?: string;
  finalSubmitAuthorizedAt: string;
  finalSubmitGate: {
    finalSubmitAuthorized: true;
    authorizationRecorded: true;
  };
  notionSync?: {
    submissionPageId: string;
  };
};

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const quoteArg = (value: string) => JSON.stringify(value);

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export class SubmissionAutopilotService {
  private readonly logger: LoggerLike;
  private readonly fileStorage: FileStorageService;

  constructor(
    private readonly config: AppEnv,
    private readonly submissionPacketService: SubmissionPacketService,
    private readonly submissionFormFillService: SubmissionFormFillService,
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
    this.fileStorage = new FileStorageService(config, logger);
  }

  async launch(
    input: SubmissionAutopilotLaunchInput,
  ): Promise<SubmissionAutopilotLaunchResult> {
    if (!input.confirmLaunch) {
      throw new Error(
        "Autopilot launch requires confirmLaunch=true so the browser handoff is explicitly human-approved.",
      );
    }

    const packet = await this.submissionPacketService.run({
      opportunityId: input.opportunityId,
      confirmAutopilot: true,
      syncToNotion: false,
    });

    if (!packet.adapterPlan.readyForHandoff) {
      throw new Error(
        `Submission handoff is blocked: ${packet.adapterPlan.blockers.join(" ")}`,
      );
    }

    if (input.launchBrowser && !packet.adapterPlan.supportsBrowserLaunch) {
      throw new Error(
        `${packet.adapterPlan.adapterLabel} handoff does not support browser launch.`,
      );
    }

    const targetReference =
      normalizeText(packet.adapterPlan.targetReference) ||
      normalizeText(packet.portalReadiness.preferredBrowserUrl) ||
      normalizeText(packet.portalUrl);
    if (!targetReference) {
      throw new Error(`${packet.adapterPlan.adapterLabel} handoff requires a target reference.`);
    }

    const [opportunity] = await db
      .select({
        id: opportunities.id,
        organizationId: opportunities.organizationId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, packet.opportunityId))
      .limit(1);
    const organizationId = await resolveOrganizationId(opportunity?.organizationId);
    const storageStatePath = packet.adapterPlan.supportsBrowserLaunch
      ? this.resolveStorageStatePath(organizationId)
      : "";
    const storageStatePresent = packet.adapterPlan.requiresSavedSession
      ? await pathExists(storageStatePath)
      : false;
    const warnings = [...packet.adapterPlan.warnings];
    if (packet.adapterPlan.requiresSavedSession && !storageStatePresent) {
      warnings.push(
        "No saved Submittable browser session was found. Expect a manual login before the handoff is usable.",
      );
    }

    const submissionSessionId = randomUUID();
    const clerkUserId = getCurrentClerkUserId();
    const launchMode: LaunchMode = packet.adapterPlan.supportsBrowserLaunch
      ? input.launchBrowser
        ? "Browser Launch"
        : "Handoff Only"
      : packet.adapterPlan.targetType === "email"
        ? "Email Draft"
        : "Manual Handoff";
    const launchStatus: Extract<LaunchStatus, "Prepared" | "Browser Launch Triggered"> =
      input.launchBrowser && packet.adapterPlan.supportsBrowserLaunch
        ? "Browser Launch Triggered"
        : "Prepared";
    const now = new Date().toISOString();
    const launchCommand = packet.adapterPlan.supportsBrowserLaunch
      ? this.buildLaunchCommand({
          portalUrl: targetReference,
          submissionSessionId,
          opportunityTitle: packet.opportunityTitle,
          storageStatePath,
          clerkUserId,
        })
      : this.buildNonBrowserLaunchCommand(packet.adapterPlan);

    await db.insert(submissionSessions).values({
      id: submissionSessionId,
      organizationId,
      opportunityId: packet.opportunityId,
      submissionId: packet.submissionRecordId,
      adapterKey: packet.adapterPlan.adapterKey,
      status: launchStatus,
      launchMode,
      portalUrl: targetReference,
      launchCommand,
      storageStatePath: storageStatePath || null,
      launchRequestedAt: now,
      launchTriggeredAt:
        input.launchBrowser && packet.adapterPlan.supportsBrowserLaunch ? now : null,
      reviewerName: input.reviewerName ?? "Human Reviewer",
      reviewerNotes: input.reviewerNotes ?? null,
      finalSubmitAuthorized: false,
    });

    const fieldPlan =
      packet.adapterPlan.supportsBrowserLaunch && packet.adapterPlan.supportsGuidedFill
        ? await this.submissionFormFillService.prepare({
            submissionSessionId,
            syncToNotion: false,
          })
        : undefined;

    await db
      .update(submissionSessions)
      .set({
        status: launchStatus,
        updatedAt: now,
      })
      .where(eq(submissionSessions.id, submissionSessionId));

    const portalReference = this.buildLaunchPortalReference({
      adapterPlan: packet.adapterPlan,
      packetSummary: packet.safetyGate.autopilotArmed
        ? "Explicit launch confirmation recorded."
        : "Launch confirmation recorded.",
      launchMode,
      browserLaunchTriggered:
        input.launchBrowser === true && packet.adapterPlan.supportsBrowserLaunch,
      storageStatePresent,
      fieldPlan,
    });

    await this.updateSubmissionReference(packet.submissionRecordId, portalReference);

    if (input.launchBrowser && packet.adapterPlan.supportsBrowserLaunch) {
      this.triggerBrowserHandoff({
        submissionSessionId,
        portalUrl: targetReference,
        opportunityTitle: packet.opportunityTitle,
        storageStatePath,
        clerkUserId,
      });
    }

    await db.insert(agentLogs).values({
      runId: submissionSessionId,
      agentName: "Submission Autopilot Agent",
      actionDescription: `Prepared ${packet.adapterPlan.adapterLabel.toLowerCase()} submission handoff`,
      confidenceLevel: packet.adapterPlan.readyForHandoff ? 0.96 : 0.5,
      outputSummary: `${packet.adapterPlan.adapterLabel} handoff ${input.launchBrowser && packet.adapterPlan.supportsBrowserLaunch ? "launch triggered" : "prepared"} for '${packet.opportunityTitle}'.`,
      followUpRequired: packet.adapterPlan.requiresSecondHumanConfirmation,
      sourceUrl: `submission-session:${submissionSessionId}`,
    });

    let notionSync: SubmissionAutopilotLaunchResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncSubmissionPacket({
          opportunityTitle: packet.opportunityTitle,
          method: packet.submissionMethod,
          readyStatus: packet.reviewReadiness.readyForSubmission ? "Ready" : "Preparing",
          portalUrl: targetReference,
          portalReference,
        });
        await this.notionClient.appendOpportunityHandoffLog({
          opportunityId: packet.opportunityId,
          opportunityTitle: packet.opportunityTitle,
          line: input.launchBrowser && packet.adapterPlan.supportsBrowserLaunch
            ? `Browser handoff launched for session ${submissionSessionId}. Grant Guardian will stop before any narrative entry or submit click.`
            : `Submission handoff prepared for session ${submissionSessionId}.`,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for autopilot launch handoff");
      }
    }

    return {
      opportunityId: packet.opportunityId,
      opportunityTitle: packet.opportunityTitle,
      submissionRecordId: packet.submissionRecordId,
      submissionSessionId,
      submissionMethod: packet.submissionMethod,
      portalUrl: targetReference,
      portalReadiness: packet.portalReadiness,
      adapterPlan: packet.adapterPlan,
      reviewReadiness: packet.reviewReadiness,
      safetyGate: packet.safetyGate,
      launchStatus,
      launchMode,
      browserLaunchTriggered:
        input.launchBrowser === true && packet.adapterPlan.supportsBrowserLaunch,
      storageStatePath,
      storageStatePresent,
      launchCommand,
      warnings,
      fieldPlan: fieldPlan?.mappingSummary,
      guidedFillCommand: fieldPlan?.guidedFillCommand,
      emailDraft: packet.adapterPlan.emailDraft,
      finalSubmitGate: packet.adapterPlan.requiresSecondHumanConfirmation
        ? {
            finalSubmitAuthorized: false,
            requiresSecondConfirmation: true,
            authorizeCommand:
              `npm run authorize:final-submit -- --submission-session-id=${submissionSessionId} --confirm-final-submit --reviewer-name=${quoteArg(
                input.reviewerName ?? "Human Reviewer",
              )}`,
            authorizeEndpoint: `/submission-sessions/${submissionSessionId}/authorize-final-submit`,
          }
        : {
            finalSubmitAuthorized: false,
            requiresSecondConfirmation: false,
            reason: `${packet.adapterPlan.adapterLabel} handoff remains human-controlled and does not use the browser final-submit authorization flow.`,
          },
      notionSync,
    };
  }

  async authorizeFinalSubmit(
    input: FinalSubmitAuthorizationInput,
  ): Promise<FinalSubmitAuthorizationResult> {
    if (!input.confirmFinalSubmit) {
      throw new Error(
        "Final submit authorization requires confirmFinalSubmit=true so a second human confirmation is recorded.",
      );
    }

    const [session] = await db
      .select()
      .from(submissionSessions)
      .where(eq(submissionSessions.id, input.submissionSessionId))
      .limit(1);
    if (!session) {
      throw new Error("No submission session exists for the provided submissionSessionId.");
    }

    const packet = await this.submissionPacketService.run({
      opportunityId: session.opportunityId,
      confirmAutopilot: true,
      syncToNotion: false,
    });

    if (
      !packet.adapterPlan.supportsBrowserLaunch ||
      !packet.adapterPlan.requiresSecondHumanConfirmation
    ) {
      throw new Error(
        `Final submit authorization is only used for browser-based submission adapters. This session uses ${packet.adapterPlan.adapterLabel}.`,
      );
    }

    if (!packet.reviewReadiness.readyForSubmission || !packet.safetyGate.safeToLaunchAutopilot) {
      throw new Error(
        `Final submit authorization is blocked: ${packet.safetyGate.blockers.join(" ")}`,
      );
    }

    const reviewerName = normalizeText(input.reviewerName) || "Human Reviewer";
    const reviewerNotes = normalizeText(input.reviewerNotes) || undefined;
    const authorizedAt = new Date().toISOString();

    await db
      .update(submissionSessions)
      .set({
        status: "Final Submit Authorized",
        finalSubmitAuthorized: true,
        finalSubmitAuthorizedAt: authorizedAt,
        reviewerName,
        reviewerNotes: reviewerNotes ?? null,
        updatedAt: authorizedAt,
      })
      .where(eq(submissionSessions.id, session.id));

    const portalReference = this.buildFinalAuthorizationReference({
      reviewerName,
      reviewerNotes,
      authorizedAt,
    });

    await this.updateSubmissionReference(packet.submissionRecordId, portalReference);

    await db.insert(agentLogs).values({
      runId: session.id,
      agentName: "Submission Autopilot Agent",
      actionDescription: "Recorded second human confirmation for final submit",
      confidenceLevel: 1,
      outputSummary: `Final submit authorization recorded for '${packet.opportunityTitle}' by ${reviewerName}.`,
      followUpRequired: false,
      sourceUrl: `submission-session:${session.id}`,
    });

    let notionSync: FinalSubmitAuthorizationResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncSubmissionPacket({
          opportunityTitle: packet.opportunityTitle,
          method: packet.submissionMethod,
          readyStatus: packet.reviewReadiness.readyForSubmission ? "Ready" : "Preparing",
          portalUrl:
            packet.adapterPlan.targetReference ??
            packet.portalReadiness.preferredBrowserUrl ??
            packet.portalUrl,
          portalReference,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for final submit authorization");
      }
    }

    return {
      submissionSessionId: session.id,
      submissionRecordId: packet.submissionRecordId,
      opportunityId: packet.opportunityId,
      opportunityTitle: packet.opportunityTitle,
      status: "Final Submit Authorized",
      reviewerName,
      reviewerNotes,
      finalSubmitAuthorizedAt: authorizedAt,
      finalSubmitGate: {
        finalSubmitAuthorized: true,
        authorizationRecorded: true,
      },
      notionSync,
    };
  }

  private resolveStorageStatePath(organizationId?: string | null) {
    return this.fileStorage.resolveBrowserStorageStatePath(organizationId);
  }

  private buildLaunchCommand(input: {
    portalUrl: string;
    submissionSessionId: string;
    opportunityTitle: string;
    storageStatePath: string;
    clerkUserId?: string | null;
  }) {
    const tsxPath = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
    const scriptPath = resolve(PROJECT_ROOT, "scripts/open-submission-handoff.ts");

    return [
      quoteArg(process.execPath),
      quoteArg(tsxPath),
      quoteArg(scriptPath),
      `--portal-url=${quoteArg(input.portalUrl)}`,
      `--submission-session-id=${quoteArg(input.submissionSessionId)}`,
      `--opportunity-title=${quoteArg(input.opportunityTitle)}`,
      `--storage-state-path=${quoteArg(input.storageStatePath)}`,
      ...(normalizeText(input.clerkUserId)
        ? [`--clerk-user-id=${quoteArg(normalizeText(input.clerkUserId))}`]
        : []),
    ].join(" ");
  }

  private buildNonBrowserLaunchCommand(adapterPlan: SubmissionAdapterPlan) {
    if (adapterPlan.adapterKey === "email" && adapterPlan.emailDraft?.recipientEmail) {
      const params = new URLSearchParams();
      params.set("subject", adapterPlan.emailDraft.subject);
      params.set("body", adapterPlan.emailDraft.body);
      return `mailto:${adapterPlan.emailDraft.recipientEmail}?${params.toString()}`;
    }

    return normalizeText(adapterPlan.targetReference) || "manual://submission-handoff";
  }

  private buildLaunchPortalReference(input: {
    adapterPlan: SubmissionAdapterPlan;
    packetSummary: string;
    launchMode: LaunchMode;
    browserLaunchTriggered: boolean;
    storageStatePresent: boolean;
    fieldPlan?: PortalFieldPlanResult;
  }) {
    if (input.adapterPlan.adapterKey === "email") {
      const recipient = input.adapterPlan.emailDraft?.recipientEmail ?? "the discovered recipient";
      const attachmentCount = input.adapterPlan.emailDraft?.attachmentTitles.length ?? 0;
      return `${input.packetSummary} Email handoff prepared for ${recipient} with ${attachmentCount} attachment(s) listed in the draft. Final send remains fully human-controlled.`;
    }

    const launchText = input.browserLaunchTriggered
      ? "Browser handoff launch was triggered."
      : "Browser handoff was prepared but not auto-opened.";
    const sessionText = input.adapterPlan.requiresSavedSession
      ? input.storageStatePresent
        ? "A saved Submittable session is available."
        : "No saved Submittable session is available yet, so login may still be manual."
      : "This handoff does not require a saved portal session.";

    const fieldPlanText = input.fieldPlan
      ? ` Portal field plan includes ${input.fieldPlan.mappingSummary.narrativeMappings} narrative field(s) and ${input.fieldPlan.mappingSummary.attachmentMappings} attachment field(s), with ${input.fieldPlan.mappingSummary.manualReviewCount} item(s) still flagged for human review.`
      : "";

    return `${input.packetSummary} ${launchText} ${sessionText}${fieldPlanText} Final submit still requires a second explicit human confirmation.`;
  }

  private buildFinalAuthorizationReference(input: {
    reviewerName: string;
    reviewerNotes?: string;
    authorizedAt: string;
  }) {
    const noteText = input.reviewerNotes ? ` Notes: ${input.reviewerNotes}` : "";
    return `Final submit authorization recorded on ${input.authorizedAt} by ${input.reviewerName}.${noteText} Browser automation must still stop short of a live submit click until this approval is present.`;
  }

  private async updateSubmissionReference(submissionId: string, portalReference: string) {
    await db
      .update(submissions)
      .set({
        portalReference,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(submissions.id, submissionId));
  }

  private triggerBrowserHandoff(input: {
    submissionSessionId: string;
    portalUrl: string;
    opportunityTitle: string;
    storageStatePath: string;
    clerkUserId?: string | null;
  }) {
    const tsxPath = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
    const scriptPath = resolve(PROJECT_ROOT, "scripts/open-submission-handoff.ts");

    const child = spawn(
      process.execPath,
      [
        tsxPath,
        scriptPath,
        `--portal-url=${input.portalUrl}`,
        `--submission-session-id=${input.submissionSessionId}`,
        `--opportunity-title=${input.opportunityTitle}`,
        `--storage-state-path=${input.storageStatePath}`,
        ...(normalizeText(input.clerkUserId)
          ? [`--clerk-user-id=${normalizeText(input.clerkUserId)}`]
          : []),
      ],
      {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: "ignore",
      },
    );

    child.on("error", (error) => {
      this.logger.error({ error }, "Failed to trigger detached browser handoff");
    });

    child.unref();
  }
}
