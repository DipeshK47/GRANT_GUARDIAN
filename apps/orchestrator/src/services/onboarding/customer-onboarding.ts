import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { asc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  budgets,
  documents,
  evidenceLibrary,
  opportunities,
  programs,
  submissionSessions,
} from "../../db/schema.js";
import { resolveOrganizationId } from "../../lib/organization-scope.js";
import type { NotionMcpClient } from "../notion/client.js";
import { FileStorageService } from "../storage/file-storage.js";
import {
  computeOrganizationProfileCompleteness,
  type OrganizationProfileRecord,
} from "../organizations/profile.js";
import { organizations } from "../../db/schema.js";
import { dedupeOpportunities } from "../opportunities/opportunity-identity.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type OnboardingStepStatus = "complete" | "attention" | "optional";

type OnboardingStep = {
  key: string;
  label: string;
  status: OnboardingStepStatus;
  summary: string;
  recommendedAction?: string;
  command?: string;
  url?: string;
};

export type CustomerOnboardingStatus = {
  organizationId: string | null;
  organizationName: string | null;
  setupReadinessPercent: number;
  readyForOpportunityIntake: boolean;
  readyForSubmissionAutomation: boolean;
  organizationProfileCompletenessPercent: number;
  counts: {
    programs: number;
    evidence: number;
    readyDocuments: number;
    budgets: number;
    opportunities: number;
    submissionSessions: number;
  };
  notion: {
    configured: boolean;
    authenticated: boolean;
    workspaceName: string | null;
    bootstrapReady: boolean;
  };
  browserSession: {
    storageStatePath: string | null;
    present: boolean;
    requiredForBrowserPortals: boolean;
  };
  essentialDocuments: {
    has501c3: boolean;
    hasBudgetSupport: boolean;
  };
  steps: OnboardingStep[];
  nextRecommendedAction: string;
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const documentTypeIncludes = (value: string | null | undefined, pattern: RegExp) =>
  pattern.test(normalizeText(value));

const pathExists = async (targetPath?: string | null) => {
  if (!normalizeText(targetPath)) {
    return false;
  }

  try {
    await access(targetPath!, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export class CustomerOnboardingService {
  private readonly logger: LoggerLike;
  private readonly fileStorage: FileStorageService;

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
    this.fileStorage = new FileStorageService(config, logger);
  }

  async getStatus(input?: {
    organizationId?: string | null;
    clerkUserId?: string | null;
  }): Promise<CustomerOnboardingStatus> {
    const resolvedOrganizationId = await resolveOrganizationId(
      input?.organizationId,
      input?.clerkUserId,
    );
    const [organization] = resolvedOrganizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, resolvedOrganizationId))
          .limit(1)
      : [];

    if (!organization) {
      return this.buildEmptyStatus();
    }

    const programRows = await db
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.organizationId, organization.id));
    const programIds = programRows.map((row) => row.id);
    const evidenceRows =
      programIds.length > 0
        ? await db
            .select({ id: evidenceLibrary.id })
            .from(evidenceLibrary)
            .where(inArray(evidenceLibrary.programId, programIds))
        : [];
    const budgetRows =
      programIds.length > 0
        ? await db.select({ id: budgets.id }).from(budgets).where(inArray(budgets.programId, programIds))
        : [];
    const documentRows = await db
      .select({
        id: documents.id,
        documentType: documents.documentType,
        uploadStatus: documents.uploadStatus,
      })
      .from(documents)
      .where(eq(documents.organizationId, organization.id));
    const opportunityRows = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.organizationId, organization.id));
    const visibleOpportunities = dedupeOpportunities(opportunityRows);
    const submissionSessionRows = await db
      .select({ id: submissionSessions.id })
      .from(submissionSessions)
      .where(eq(submissionSessions.organizationId, organization.id));

    const readyDocuments = documentRows.filter(
      (row) => normalizeText(row.uploadStatus).toLowerCase() === "ready",
    );
    const has501c3 = readyDocuments.some((row) =>
      documentTypeIncludes(row.documentType, /501\s*\(?c\)?\s*\(?3\)?/i),
    );
    const hasBudgetDocument = readyDocuments.some((row) =>
      documentTypeIncludes(row.documentType, /budget/i),
    );
    const hasBudgetSupport = hasBudgetDocument || budgetRows.length > 0;

    const notionStatus = this.notionClient
      ? await this.notionClient.getAuthStatus().catch((error) => {
          this.logger.warn({ error }, "Failed to read Notion auth status during onboarding");
          return null;
        })
      : null;
    const storageStatePath = this.fileStorage.resolveBrowserStorageStatePath(organization.id);
    const storageStatePresent = await pathExists(storageStatePath);

    const organizationProfileCompletenessPercent =
      computeOrganizationProfileCompleteness(organization);
    const hasOrganizationEssentials =
      normalizeText(organization.legalName) !== "" &&
      normalizeText(organization.ein) !== "" &&
      normalizeText(organization.mission) !== "";
    const hasProgramContext = programRows.length > 0 && evidenceRows.length > 0;
    const hasDocumentsReady = has501c3 && hasBudgetSupport;
    const hasNotionReady = Boolean(notionStatus?.authenticated && notionStatus.bootstrap);
    const readyForOpportunityIntake = hasOrganizationEssentials && hasProgramContext;
    const readyForSubmissionAutomation = readyForOpportunityIntake && hasDocumentsReady;

    const requiredSteps = [
      hasOrganizationEssentials,
      hasProgramContext,
      hasDocumentsReady,
      hasNotionReady,
    ];
    const setupReadinessPercent = Math.round(
      (requiredSteps.filter(Boolean).length / requiredSteps.length) * 100,
    );

    const steps = this.buildSteps({
      organization,
      organizationProfileCompletenessPercent,
      hasProgramContext,
      hasDocumentsReady,
      has501c3,
      hasBudgetSupport,
      hasNotionReady,
      notionStatus,
      storageStatePath,
      storageStatePresent,
      programCount: programRows.length,
      evidenceCount: evidenceRows.length,
      readyDocumentCount: readyDocuments.length,
      opportunityCount: visibleOpportunities.length,
    });

    return {
      organizationId: organization.id,
      organizationName: organization.legalName,
      setupReadinessPercent,
      readyForOpportunityIntake,
      readyForSubmissionAutomation,
      organizationProfileCompletenessPercent,
      counts: {
        programs: programRows.length,
        evidence: evidenceRows.length,
        readyDocuments: readyDocuments.length,
        budgets: budgetRows.length,
        opportunities: visibleOpportunities.length,
        submissionSessions: submissionSessionRows.length,
      },
      notion: {
        configured: Boolean(notionStatus?.configured),
        authenticated: Boolean(notionStatus?.authenticated),
        workspaceName: notionStatus?.workspaceName ?? null,
        bootstrapReady: Boolean(notionStatus?.bootstrap),
      },
      browserSession: {
        storageStatePath,
        present: storageStatePresent,
        requiredForBrowserPortals: true,
      },
      essentialDocuments: {
        has501c3,
        hasBudgetSupport,
      },
      steps,
      nextRecommendedAction:
        steps.find((step) => step.status === "attention")?.recommendedAction ??
        "Onboarding looks healthy. Paste a live opportunity into intake to start the next run.",
    };
  }

  private buildEmptyStatus(): CustomerOnboardingStatus {
    return {
      organizationId: null,
      organizationName: null,
      setupReadinessPercent: 0,
      readyForOpportunityIntake: false,
      readyForSubmissionAutomation: false,
      organizationProfileCompletenessPercent: 0,
      counts: {
        programs: 0,
        evidence: 0,
        readyDocuments: 0,
        budgets: 0,
        opportunities: 0,
        submissionSessions: 0,
      },
      notion: {
        configured: Boolean(this.notionClient),
        authenticated: false,
        workspaceName: null,
        bootstrapReady: false,
      },
      browserSession: {
        storageStatePath: null,
        present: false,
        requiredForBrowserPortals: true,
      },
      essentialDocuments: {
        has501c3: false,
        hasBudgetSupport: false,
      },
      steps: [
        {
          key: "organization-profile",
          label: "Save the organization profile",
          status: "attention",
        summary: "No organization profile exists yet, so intake and drafting do not know who they are writing for.",
        recommendedAction: "Create the first organization profile with legal name, EIN, and mission.",
        url: "/onboarding?step=2",
      },
      ],
      nextRecommendedAction:
        "Create the first organization profile with legal name, EIN, and mission.",
    };
  }

  private buildSteps(input: {
    organization: OrganizationProfileRecord;
    organizationProfileCompletenessPercent: number;
    hasProgramContext: boolean;
    hasDocumentsReady: boolean;
    has501c3: boolean;
    hasBudgetSupport: boolean;
    hasNotionReady: boolean;
    notionStatus: Awaited<ReturnType<NotionMcpClient["getAuthStatus"]>> | null;
    storageStatePath: string;
    storageStatePresent: boolean;
    programCount: number;
    evidenceCount: number;
    readyDocumentCount: number;
    opportunityCount: number;
  }): OnboardingStep[] {
    return [
      {
        key: "organization-profile",
        label: "Save the organization profile",
        status:
          input.organizationProfileCompletenessPercent >= 60 ? "complete" : "attention",
        summary: `${input.organization.legalName} is ${input.organizationProfileCompletenessPercent}% complete as a reusable grant profile.`,
        recommendedAction:
          input.organizationProfileCompletenessPercent >= 60
            ? "Profile basics are in place."
            : "Add grants contact, service area, website, and program summary so drafts have real context.",
      },
      {
        key: "program-context",
        label: "Add programs and evidence",
        status: input.hasProgramContext ? "complete" : "attention",
        summary: input.hasProgramContext
          ? `${input.programCount} program(s) and ${input.evidenceCount} evidence item(s) are ready for opportunity analysis.`
          : `Only ${input.programCount} program(s) and ${input.evidenceCount} evidence item(s) are available. Opportunity fit and drafting improve once both exist.`,
        recommendedAction: input.hasProgramContext
          ? "Program context is ready for intake."
          : "Use the Program Context section on the dashboard to add at least one program and one evidence record.",
      },
      {
        key: "documents",
        label: "Upload evergreen documents",
        status: input.hasDocumentsReady ? "complete" : "attention",
        summary: input.hasDocumentsReady
          ? `${input.readyDocumentCount} ready document(s) include the core 501(c)(3) and budget support needed for guided submission uploads.`
          : `Core evergreen docs are still incomplete. 501(c)(3): ${input.has501c3 ? "ready" : "missing"}. Budget support: ${input.hasBudgetSupport ? "ready" : "missing"}.`,
        recommendedAction: input.hasDocumentsReady
          ? "Vault coverage is strong enough for most early submissions."
          : "Upload the 501(c)(3) letter and a current organizational budget into the document vault.",
        url: input.hasDocumentsReady ? undefined : "/dashboard#document-vault",
      },
      {
        key: "notion",
        label: "Connect and bootstrap Notion",
        status: input.hasNotionReady ? "complete" : "attention",
        summary: input.hasNotionReady
          ? `Notion is connected${input.notionStatus?.workspaceName ? ` to ${input.notionStatus.workspaceName}` : ""} and the workspace bootstrap is ready.`
          : "Notion sync is not fully ready yet, so the shared workspace view will stay sparse.",
        recommendedAction: input.hasNotionReady
          ? "Workspace sync is ready."
          : "Complete Notion OAuth and bootstrap the workspace so onboarding data appears in the operating system view.",
        url: input.hasNotionReady ? undefined : "/onboarding?step=1",
      },
      {
        key: "browser-session",
        label: "Save a browser session for portal work",
        status: input.storageStatePresent ? "complete" : "optional",
        summary: input.storageStatePresent
          ? `A reusable browser session is saved at ${input.storageStatePath}.`
          : "No browser session is saved yet. This only matters for browser-based portals like Submittable.",
        recommendedAction: input.storageStatePresent
          ? "Portal login reuse is ready."
          : "You can skip this until a portal handoff is ready. Grant Guardian will prompt for the browser step when it matters.",
      },
      {
        key: "first-opportunity",
        label: "Run the first opportunity",
        status: input.opportunityCount > 0 ? "complete" : "attention",
        summary:
          input.opportunityCount > 0
            ? `${input.opportunityCount} opportunity record(s) already exist for this organization.`
            : "No opportunity has been intake-processed yet for this organization.",
        recommendedAction:
          input.opportunityCount > 0
            ? "The team can keep iterating from live opportunities."
            : "Paste a real opportunity URL or RFP text into intake to kick off the full flow.",
        url: input.opportunityCount > 0 ? "/opportunities" : "/dashboard#opportunity-intake",
      },
    ];
  }
}
