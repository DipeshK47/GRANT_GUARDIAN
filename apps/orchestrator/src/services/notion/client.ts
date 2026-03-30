import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../config/env.js";
import { db } from "../../db/client.js";
import { notionConnections, opportunities } from "../../db/schema.js";
import { getCurrentClerkUserId } from "../../lib/request-context.js";
import {
  buildOpportunityTitleAliases,
  collectRelatedOpportunityRows,
  selectCanonicalOpportunity,
} from "../opportunities/opportunity-identity.js";
import {
  grantGuardianRootPageDefinition,
  notionWorkspaceDatabases,
  type NotionPropertyDefinition,
} from "./workspace-schema.js";

const NOTION_API_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const BOOTSTRAP_FILE = "data/notion/workspace-bootstrap.json";
const DEMO_SEED_FILE = "data/notion/demo-seed.json";
const SYNC_STATUS_FILE = "data/notion/sync-status.json";
const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);
const LEGACY_WORKSPACE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
);
const STATE_TTL_MS = 10 * 60 * 1000;

const roundPercentForNotion = (value: number) =>
  Math.round((value / 100) * 10000) / 10000;

const sanitizeNotionMultiSelectOption = (value?: string | null) =>
  (value ?? "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();

const toNotionMultiSelectValues = (value?: string | null) =>
  (value ?? "")
    .split(/[,;|]/)
    .map((entry) => sanitizeNotionMultiSelectOption(entry))
    .filter(Boolean);

const toNotionMultiSelectList = (values?: Array<string | null | undefined>) =>
  [...new Set((values ?? []).map((value) => sanitizeNotionMultiSelectOption(value)).filter(Boolean))];

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

type OAuthStatePayload = {
  clerkUserId: string;
  createdAt: string;
};

type StoredNotionTokens = {
  accessToken: string;
};

type NotionConnectionMetadata = {
  clerkUserId: string;
  workspaceId: string;
  workspaceName: string | null;
  workspaceIcon: string | null;
  botId: string;
  ownerType: string | null;
  duplicatedTemplateId: string | null;
  connectedAt: string;
};

type NotionTokenResponse = {
  access_token: string;
  token_type: "bearer";
  refresh_token: string | null;
  bot_id: string;
  workspace_icon: string | null;
  workspace_name: string | null;
  workspace_id: string;
  owner?: {
    type?: string;
  };
  duplicated_template_id?: string | null;
  request_id?: string;
};

type NotionApiErrorPayload = {
  object?: string;
  status?: number;
  code?: string;
  message?: string;
  request_id?: string;
};

type NotionParent =
  | { type: "workspace"; workspace: true }
  | { type: "page_id"; page_id: string };

type NotionPlainText = Array<{
  type: "text";
  text: {
    content: string;
  };
}>;

type NotionBootstrapDatabaseRecord = {
  key: string;
  name: string;
  description: string;
  databaseId: string;
  databaseUrl?: string;
  dataSourceId?: string;
};

type BootstrapDataSourceKey = (typeof notionWorkspaceDatabases)[number]["key"];
type BootstrapDataSourceMap = Record<BootstrapDataSourceKey, string>;

type NotionPagePropertyValue =
  | { type: "title"; value: string }
  | { type: "rich_text"; value?: string | null }
  | { type: "url"; value?: string | null }
  | { type: "number"; value?: number | null }
  | { type: "date"; value?: string | null }
  | { type: "checkbox"; value: boolean }
  | { type: "select"; value?: string | null }
  | { type: "multi_select"; value: string[] }
  | { type: "relation"; value: string[] };

export type NotionBootstrapSummary = {
  createdAt: string;
  workspaceId: string;
  workspaceName: string | null;
  rootPageId: string;
  rootPageUrl?: string;
  parentType: "workspace" | "page";
  parentPageId?: string;
  databases: NotionBootstrapDatabaseRecord[];
};

export type NotionAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  serverUrl: string;
  redirectUri: string;
  workspaceId?: string;
  workspaceName?: string | null;
  connectedAt?: string;
  bootstrap?: NotionBootstrapSummary | null;
};

export type NotionWorkspaceSyncStatus = {
  configured: boolean;
  authenticated: boolean;
  workspaceId?: string;
  workspaceName?: string | null;
  bootstrapReady: boolean;
  lastSyncedAt?: string | null;
  lastOperation?: string | null;
  lastTarget?: string | null;
};

type StoredNotionSyncStatus = {
  lastSyncedAt: string;
  lastOperation: string;
  lastTarget?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
};

export type NotionBootstrapPlan = {
  transport: "rest-api";
  serverUrl: string;
  requiresOAuth: true;
  rootPageTitle: string;
  databasesPlanned: Array<{
    key: string;
    name: string;
    description: string;
    propertyCount: number;
  }>;
};

export type BootstrapWorkspaceInput = {
  force?: boolean;
  parentPageId?: string;
  workspaceTitle?: string;
};

export type DemoSeedResult = {
  seededAt: string;
  organizationPageId?: string;
  programPageIds: string[];
  evidencePageIds: string[];
  documentPageIds: string[];
  funderPageIds: string[];
};

export type NotionOpportunitySyncInput = {
  opportunityId?: string;
  funderName: string;
  funderWebsite?: string;
  sourceUrl?: string;
  opportunityTitle: string;
  deadline?: string | null;
  submissionMethod?: string | null;
  portalUrl?: string | null;
  requirements: Array<{
    questionText: string;
    requirementType?: string | null;
    wordLimit?: number | null;
  }>;
};

export type NotionOpportunityPortalDiscoverySyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  sourceUrl?: string | null;
  portalUrl?: string | null;
  submissionMethod?: string | null;
};

export type NotionOpportunityStatusSyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  status: string;
};

export type NotionOrganizationProfileSyncInput = {
  legalName: string;
  ein: string;
  mission: string;
  annualBudget?: number | null;
  staffSize?: number | null;
  foundingYear?: number | null;
  executiveDirector?: string | null;
  grantsContact?: string | null;
  address?: string | null;
  serviceArea?: string | null;
  programAreas?: string | null;
  website?: string | null;
};

export type NotionAgentProgressSyncInput = {
  runId?: string | null;
  agentName: string;
  actionDescription: string;
  progressLine: string;
  summary: string;
  source?: string | null;
  sourceUrl?: string | null;
  confidenceLevel?: number | null;
  followUpRequired?: boolean;
  opportunityTitle?: string | null;
  funderName?: string | null;
  targetPageId?: string | null;
};

export type NotionAgentProgressSyncResult = {
  agentLogPageId: string;
  targetPageIds: string[];
};

export type NotionFunderIntelligenceSyncInput = {
  funderName: string;
  ein?: string | null;
  website?: string | null;
  foundationType?: string | null;
  issueAreas?: string[] | null;
  givingSummary?: string | null;
  averageGrant?: number | null;
  medianGrant?: number | null;
  geographicFocus?: string[];
  grantDnaTopTerms?: string | null;
  framingStyle?: string | null;
  toneSummary?: string | null;
  notes?: string | null;
  smallOrgFriendly?: "High" | "Medium" | "Low" | "Needs Review";
  filings: Array<{
    taxYear: number;
    filingType: "990-PF" | "990" | "Other";
    parsedStatus: "Queued" | "Parsed" | "Partial" | "Failed";
    grantCount?: number | null;
    totalGrants?: number | null;
    sourceUrl?: string | null;
  }>;
};

export type NotionPortfolioOptimizerSyncInput = {
  monthlyStaffHours: number;
  weeklyStaffHours: number;
  rankedOpportunities: Array<{
    id: string;
    title: string;
    funderName: string;
    deadline?: string | null;
    fitScore: number;
    evidenceCoveragePercent: number;
    effortEstimateHours: number;
    reportingBurdenScore: number;
    deadlineProximityScore: number;
    priorityScore: number;
    classification: "Pursue Now" | "Revisit Later" | "Skip";
    recommendedHoursThisWeek: number;
    analysisReady: boolean;
    nextMove: string;
  }>;
  staffingRecommendation: {
    availableHoursThisWeek: number;
    allocatedHoursThisWeek: number;
    remainingHoursThisWeek: number;
    recommendations: Array<{
      opportunityId: string;
      opportunityTitle: string;
      hours: number;
      classification: "Pursue Now" | "Revisit Later" | "Skip";
    }>;
    summary: string;
  };
};

export type NotionFunderContrastSyncInput = {
  title: string;
  leftFunder: string;
  rightFunder: string;
  leftGrantSignal: string;
  rightGrantSignal: string;
  primaryDifference: string;
  contrastSummary: string;
  recommendedMove: string;
};

export type NotionOpportunityAnalysisSyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  funderName?: string | null;
  status?: string | null;
  deadline?: string | null;
  submissionPlatform?: string | null;
  sourceUrl?: string | null;
  portalUrl?: string | null;
  fitScorePercent: number;
  pursueDecision: "Pursue" | "Revisit" | "Skip" | "Pursue Now" | "Revisit Later";
  evidenceCoveragePercent: number;
  effortHours: number;
  reportingBurdenScore?: number | null;
  priorityScore?: number | null;
  nextBestAction?: string | null;
  tasks: Array<{
    title: string;
    priority: "Low" | "Medium" | "High";
    status: "To Do" | "In Progress" | "Blocked" | "Done";
    dueDate?: string | null;
    assignee?: string | null;
    blocking: boolean;
  }>;
  requirements: Array<{
    questionText: string;
    required?: boolean;
    coverageStatus: "Green" | "Amber" | "Red";
    riskLevel: "Low" | "Medium" | "High";
    note: string;
    riskFlag?: string | null;
  }>;
};

export type NotionDraftAnswersSyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  archiveStale?: boolean;
  drafts: Array<{
    requirementId?: string | null;
    requirementText: string;
    status: "Not Started" | "Draft" | "Drafting" | "Needs Review" | "Approved";
    draftText: string;
    evidenceCitations: string[];
    dnaMatchPercent: number;
    unsupportedClaims: string[];
    reviewerNotes?: string | null;
  }>;
};

export type NotionDocumentVaultSyncInput = {
  organizationName?: string | null;
  documentName: string;
  category: string;
  uploadStatus: string;
  owner?: string | null;
  expirationDate?: string | null;
  fileUrl?: string | null;
};

export type NotionProgramSyncInput = {
  organizationName: string;
  programName: string;
  targetPopulation?: string | null;
  geography?: string | null;
  goals?: string | null;
  outcomes?: string | null;
  metrics?: string | null;
  programBudget?: number | null;
  programLead?: string | null;
  strategicPriority?: string | null;
};

export type NotionEvidenceLibrarySyncInput = {
  programName: string;
  evidenceTitle: string;
  evidenceType: string;
  summary: string;
  metrics?: string | null;
  geography?: string | null;
  sourceDocument?: string | null;
  qualityScore?: number | null;
  reusabilityScore?: string | null;
  collectedAt?: string | null;
  tags?: string | null;
};

export type NotionBudgetSyncInput = {
  programName: string;
  budgetName: string;
  fiscalYear?: number | null;
  budgetType: string;
  totalRevenue?: number | null;
  totalExpense?: number | null;
  notes?: string | null;
};

export type NotionReviewWorkflowSyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  submissionMethod?: string | null;
  portalUrl?: string | null;
  readyStatus: "Preparing" | "Ready";
  reviews: Array<{
    title: string;
    reviewType: "Draft Review" | "Compliance Review" | "Submission Approval";
    status: "Requested" | "In Review" | "Changes Requested" | "Approved";
    reviewer: string;
    requestedOn?: string | null;
    approvedOn?: string | null;
  }>;
  tasks: Array<{
    title: string;
    priority: "Low" | "Medium" | "High";
    status: "To Do" | "In Progress" | "Blocked" | "Done";
    dueDate?: string | null;
    assignee?: string | null;
    blocking: boolean;
  }>;
};

export type NotionSubmissionPacketSyncInput = {
  opportunityTitle: string;
  method: "Submittable" | "Email" | "Portal" | "Other";
  readyStatus: "Preparing" | "Ready";
  portalUrl?: string | null;
  portalReference: string;
};

export type NotionOpportunityHandoffLogInput = {
  opportunityId?: string | null;
  opportunityTitle: string;
  line: string;
};

export type NotionReportingWorkflowSyncInput = {
  opportunityId?: string;
  opportunityTitle: string;
  metricsToTrack?: string[];
  templates?: Array<{
    title: string;
    templateLink?: string | null;
  }>;
  reports: Array<{
    title: string;
    dueDate: string;
    status: "Not started" | "Upcoming" | "In Progress" | "Submitted" | "Overdue";
    owner?: string | null;
    reportingPeriod?: string | null;
    requiredMetrics?: string | null;
    templateLink?: string | null;
  }>;
  tasks: Array<{
    title: string;
    priority: "Low" | "Medium" | "High";
    status: "To Do" | "In Progress" | "Blocked" | "Done";
    dueDate?: string | null;
    assignee?: string | null;
    blocking: boolean;
  }>;
};

export type NotionLessonsMemorySyncInput = {
  lessons: Array<{
    title: string;
    funderName: string;
    opportunityTitle?: string | null;
    result?: string | null;
    feedbackText: string;
    themes: string[];
    recommendations?: string | null;
    appliesNextCycle: boolean;
    recordedAt?: string | null;
    appendToFunderPage?: boolean;
  }>;
};

class NotionApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, payload: NotionApiErrorPayload) {
    super(payload.message || `Notion API request failed with status ${status}`);
    this.name = "NotionApiError";
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.request_id;
  }
}

export class NotionAuthorizationError extends Error {
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = "NotionAuthorizationError";
  }
}

export const isNotionAuthorizationError = (
  error: unknown,
): error is NotionAuthorizationError =>
  error instanceof NotionAuthorizationError;

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export class NotionMcpClient {
  private readonly encryptionKey: Buffer;
  private readonly logger: LoggerLike;
  private cachedBootstrapDataSourceIds: Partial<BootstrapDataSourceMap> | null = null;

  constructor(
    private readonly config: AppEnv,
    logger?: Partial<LoggerLike>,
  ) {
    this.encryptionKey = createHash("sha256")
      .update(this.config.ENCRYPTION_KEY)
      .digest();
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

  isOauthReady() {
    return Boolean(
      this.config.NOTION_OAUTH_CLIENT_ID &&
        this.config.NOTION_OAUTH_CLIENT_SECRET &&
        this.config.NOTION_OAUTH_REDIRECT_URI,
    );
  }

  getConnectionSummary() {
    return {
      serverUrl: this.config.NOTION_MCP_SERVER_URL,
      requiresOAuth: true as const,
      supportsFileUploads: false,
      recommendedTransport: "streamable-http" as const,
      bootstrapTransport: "rest-api" as const,
      notionVersion: NOTION_VERSION,
    };
  }

  async planWorkspaceBootstrap(): Promise<NotionBootstrapPlan> {
    return {
      transport: "rest-api",
      serverUrl: this.config.NOTION_MCP_SERVER_URL,
      requiresOAuth: true,
      rootPageTitle: grantGuardianRootPageDefinition.title,
      databasesPlanned: notionWorkspaceDatabases.map((database) => ({
        key: database.key,
        name: database.name,
        description: database.description,
        propertyCount: database.properties.length,
      })),
    };
  }

  async beginOAuthSession() {
    if (!this.isOauthReady()) {
      throw new Error(
        "Notion OAuth is not fully configured. Add client ID, client secret, and redirect URI to .env first.",
      );
    }

    const clerkUserId = this.requireCurrentClerkUserId();
    const state = this.encrypt(
      JSON.stringify({
        clerkUserId,
        createdAt: new Date().toISOString(),
      } satisfies OAuthStatePayload),
    );

    const url = new URL(`${NOTION_API_BASE_URL}/oauth/authorize`);
    url.searchParams.set("owner", "user");
    url.searchParams.set("client_id", this.config.NOTION_OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", this.config.NOTION_OAUTH_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    return {
      createdAt: new Date().toISOString(),
      clerkUserId,
      state,
      authorizationUrl: url.toString(),
    };
  }

  async handleOAuthCallback(input: {
    code?: string;
    state?: string;
    error?: string;
  }) {
    if (input.error) {
      throw new Error(`Notion authorization failed: ${input.error}`);
    }

    if (!input.code) {
      throw new Error("Missing authorization code from Notion callback.");
    }

    const statePayload = this.parseOAuthState(input.state);

    const tokenResponse = await this.exchangeCodeForToken(input.code);
    await this.storeTokenResponse(tokenResponse, statePayload.clerkUserId);

    return {
      clerkUserId: statePayload.clerkUserId,
      workspaceId: tokenResponse.workspace_id,
      workspaceName: tokenResponse.workspace_name,
      connectedAt: new Date().toISOString(),
    };
  }

  async getAuthStatus(): Promise<NotionAuthStatus> {
    const clerkUserId = this.getOptionalCurrentClerkUserId();
    const connection = clerkUserId
      ? await this.readConnectionMetadata(clerkUserId)
      : null;
    const bootstrap = clerkUserId ? await this.getBootstrapSummary() : null;

    return {
      configured: this.isOauthReady(),
      authenticated: Boolean(connection?.workspaceId),
      serverUrl: this.config.NOTION_MCP_SERVER_URL,
      redirectUri: this.config.NOTION_OAUTH_REDIRECT_URI,
      workspaceId: connection?.workspaceId,
      workspaceName: connection?.workspaceName,
      connectedAt: connection?.connectedAt,
      bootstrap,
    };
  }

  async getSyncStatus(): Promise<NotionWorkspaceSyncStatus> {
    const authStatus = await this.getAuthStatus();
    const clerkUserId = this.getOptionalCurrentClerkUserId();
    const syncStatus = clerkUserId
      ? await this.readJsonFile<StoredNotionSyncStatus>(
          this.getScopedSupportFilePath(SYNC_STATUS_FILE, clerkUserId),
        )
      : null;

    return {
      configured: authStatus.configured,
      authenticated: authStatus.authenticated,
      workspaceId: authStatus.workspaceId,
      workspaceName: authStatus.workspaceName,
      bootstrapReady: Boolean(authStatus.bootstrap),
      lastSyncedAt: syncStatus?.lastSyncedAt ?? null,
      lastOperation: syncStatus?.lastOperation ?? null,
      lastTarget: syncStatus?.lastTarget ?? null,
    };
  }

  async disconnectCurrentConnection() {
    const clerkUserId = this.requireCurrentClerkUserId();
    const now = new Date().toISOString();
    const [connection] = await db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.clerkUserId, clerkUserId))
      .limit(1);

    if (!connection) {
      return {
        disconnected: false as const,
        clerkUserId,
      };
    }

    await db
      .update(notionConnections)
      .set({
        accessToken: null,
        disconnectedAt: now,
        updatedAt: now,
      })
      .where(eq(notionConnections.id, connection.id));

    await this.invalidateBootstrapArtifacts(clerkUserId);

    return {
      disconnected: true as const,
      clerkUserId,
      workspaceId: connection.workspaceId ?? null,
      workspaceName: connection.workspaceName ?? null,
      disconnectedAt: now,
    };
  }

  async getBootstrapSummary() {
    const clerkUserId = this.getOptionalCurrentClerkUserId();
    if (!clerkUserId) {
      return null;
    }

    return this.readJsonFile<NotionBootstrapSummary>(this.getScopedSupportFilePath(BOOTSTRAP_FILE, clerkUserId));
  }

  async bootstrapWorkspace(input: BootstrapWorkspaceInput = {}) {
    const clerkUserId = this.requireCurrentClerkUserId();
    const existing = await this.getBootstrapSummary();
    const connection = await this.requireConnectionMetadata();
    if (existing && existing.workspaceId === connection.workspaceId && !input.force) {
      return {
        created: false as const,
        reused: true as const,
        summary: existing,
      };
    }
    if (existing && existing.workspaceId !== connection.workspaceId) {
      await this.invalidateBootstrapArtifacts(clerkUserId);
    }
    const reusableWorkspace = await this.findReusableWorkspaceBootstrap({
      parentPageId: input.parentPageId,
      workspaceTitle: input.workspaceTitle ?? grantGuardianRootPageDefinition.title,
    });
    if (reusableWorkspace) {
      await this.writeJsonFile(
        this.getScopedSupportFilePath(BOOTSTRAP_FILE, clerkUserId),
        reusableWorkspace,
      );
      await this.reconcileBootstrapDataSources(reusableWorkspace);
      this.logger.info(
        {
          workspaceId: reusableWorkspace.workspaceId,
          rootPageId: reusableWorkspace.rootPageId,
          databaseCount: reusableWorkspace.databases.length,
        },
        "Reused existing Grant Guardian Notion workspace",
      );

      return {
        created: false as const,
        reused: true as const,
        summary: reusableWorkspace,
      };
    }
    const parent = this.buildParent(input.parentPageId);
    const rootPage = await this.createPage({
      parent,
      title: input.workspaceTitle ?? grantGuardianRootPageDefinition.title,
      icon: grantGuardianRootPageDefinition.icon,
      children: [...grantGuardianRootPageDefinition.children],
    });

    const databases: NotionBootstrapDatabaseRecord[] = [];
    for (const definition of notionWorkspaceDatabases) {
      const database = await this.createDatabase({
        parentPageId: rootPage.id,
        definition,
      });

      databases.push(database);
    }

    const summary: NotionBootstrapSummary = {
      createdAt: new Date().toISOString(),
      workspaceId: connection.workspaceId,
      workspaceName: connection.workspaceName,
      rootPageId: rootPage.id,
      rootPageUrl: rootPage.url,
      parentType: input.parentPageId ? "page" : "workspace",
      parentPageId: input.parentPageId,
      databases,
    };

    await this.reconcileBootstrapDataSources(summary);
    await this.writeJsonFile(this.getScopedSupportFilePath(BOOTSTRAP_FILE, clerkUserId), summary);

    this.logger.info(
      {
        workspaceId: summary.workspaceId,
        rootPageId: summary.rootPageId,
        databaseCount: summary.databases.length,
      },
      "Bootstrapped Grant Guardian Notion workspace",
    );

    return {
      created: true as const,
      reused: false as const,
      summary,
    };
  }

  async seedDemoContent(input: { force?: boolean } = {}) {
    const clerkUserId = this.requireCurrentClerkUserId();
    const existing = await this.readJsonFile<DemoSeedResult>(
      this.getScopedSupportFilePath(DEMO_SEED_FILE, clerkUserId),
    );
    if (existing && !input.force) {
      return {
        created: false as const,
        reused: true as const,
        summary: existing,
      };
    }

    const dataSources = await this.requireBootstrapDataSources();
    const seededAt = new Date().toISOString();

    const organizationPage = await this.createDataSourcePage({
      dataSourceId: dataSources.organization!,
      properties: {
        Name: { type: "title", value: "Bright Path Youth Collective" },
        EIN: { type: "rich_text", value: "12-3456789" },
        Mission: {
          type: "rich_text",
          value:
            "Bright Path Youth Collective equips low-income middle-school students with year-round literacy, mentoring, and family support.",
        },
        "Annual Budget": { type: "number", value: 420000 },
        "Executive Director": { type: "rich_text", value: "Ava Thompson" },
        "Grants Contact": { type: "rich_text", value: "Maya Patel" },
        "Service Areas": {
          type: "multi_select",
          value: ["Atlanta", "Dekalb County"],
        },
        Website: { type: "url", value: "https://brightpathyouth.example.org" },
      },
    });

    const programPages = await Promise.all([
      this.createDataSourcePage({
        dataSourceId: dataSources.programs!,
        properties: {
          "Program Name": { type: "title", value: "Reading Acceleration Lab" },
          "Target Population": {
            type: "rich_text",
            value: "Middle-school students reading below grade level",
          },
          Geography: { type: "multi_select", value: ["Atlanta"] },
          Outcomes: {
            type: "rich_text",
            value: "Students gain at least 1.2 grade levels in reading growth each year.",
          },
          Metrics: {
            type: "rich_text",
            value: "Reading gains, attendance, family conference participation",
          },
          "Program Budget": { type: "number", value: 160000 },
          "Strategic Priority": { type: "select", value: "Critical" },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources.programs!,
        properties: {
          "Program Name": { type: "title", value: "Family Learning Circles" },
          "Target Population": {
            type: "rich_text",
            value: "Parents and caregivers supporting literacy at home",
          },
          Geography: { type: "multi_select", value: ["Atlanta", "Dekalb County"] },
          Outcomes: {
            type: "rich_text",
            value: "Caregivers increase confidence and weekly learning routines at home.",
          },
          Metrics: {
            type: "rich_text",
            value: "Workshop attendance, home reading logs, caregiver survey scores",
          },
          "Program Budget": { type: "number", value: 78000 },
          "Strategic Priority": { type: "select", value: "High" },
        },
      }),
    ]);

    const evidencePages = await Promise.all([
      this.createDataSourcePage({
        dataSourceId: dataSources["evidence-library"]!,
        properties: {
          "Evidence Title": {
            type: "title",
            value: "2025 cohort showed 1.3 grade-level reading growth",
          },
          "Evidence Type": { type: "select", value: "Metric" },
          Summary: {
            type: "rich_text",
            value:
              "Independent assessments across 86 students showed median reading growth of 1.3 grade levels.",
          },
          "Source Document": { type: "rich_text", value: "FY25 Reading Outcomes Memo" },
          "Quality Score": { type: "number", value: 0.92 },
          "Collected At": { type: "date", value: "2025-12-15" },
          Tags: { type: "multi_select", value: ["literacy", "outcomes", "evaluation"] },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources["evidence-library"]!,
        properties: {
          "Evidence Title": {
            type: "title",
            value: "92% of caregivers reported stronger home reading routines",
          },
          "Evidence Type": { type: "select", value: "Outcome" },
          Summary: {
            type: "rich_text",
            value:
              "Post-program surveys show most caregivers adopted structured weekly literacy routines within two months.",
          },
          "Source Document": { type: "rich_text", value: "Family Learning Circles Survey Summary" },
          "Quality Score": { type: "number", value: 0.88 },
          "Collected At": { type: "date", value: "2025-11-10" },
          Tags: { type: "multi_select", value: ["family engagement", "survey"] },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources["evidence-library"]!,
        properties: {
          "Evidence Title": {
            type: "title",
            value: "Student testimonial on confidence and mentoring",
          },
          "Evidence Type": { type: "select", value: "Testimonial" },
          Summary: {
            type: "rich_text",
            value:
              "A sixth-grade participant described reading aloud in class for the first time after mentoring support.",
          },
          "Source Document": { type: "rich_text", value: "Student Story Bank" },
          "Quality Score": { type: "number", value: 0.75 },
          "Collected At": { type: "date", value: "2025-10-01" },
          Tags: { type: "multi_select", value: ["testimonials", "mentoring"] },
        },
      }),
    ]);

    const documentPages = await Promise.all([
      this.createDataSourcePage({
        dataSourceId: dataSources.documents!,
        properties: {
          "Document Name": { type: "title", value: "IRS 501(c)(3) Determination Letter" },
          Category: { type: "select", value: "501(c)(3)" },
          "Upload Status": { type: "select", value: "Ready" },
          Owner: { type: "rich_text", value: "Maya Patel" },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources.documents!,
        properties: {
          "Document Name": { type: "title", value: "FY26 Organizational Budget" },
          Category: { type: "select", value: "Budget" },
          "Upload Status": { type: "select", value: "Ready" },
          Owner: { type: "rich_text", value: "Luis Romero" },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources.documents!,
        properties: {
          "Document Name": { type: "title", value: "Board of Directors Roster" },
          Category: { type: "select", value: "Board List" },
          "Upload Status": { type: "select", value: "Ready" },
          Owner: { type: "rich_text", value: "Maya Patel" },
        },
      }),
    ]);

    const funderPages = await Promise.all([
      this.createDataSourcePage({
        dataSourceId: dataSources.funders!,
        properties: {
          "Funder Name": { type: "title", value: "North Star Family Foundation" },
          Website: { type: "url", value: "https://northstarfamily.example.org" },
          "Average Grant": { type: "number", value: 65000 },
          "Median Grant": { type: "number", value: 50000 },
          "Geographic Focus": { type: "multi_select", value: ["Georgia", "Southeast"] },
          "Giving Summary": {
            type: "rich_text",
            value:
              "Historically funds youth literacy, small education nonprofits, and family support organizations in the Southeast.",
          },
          "Grant DNA Top Terms": {
            type: "rich_text",
            value: "community-led, literacy gains, family partnership, measurable outcomes",
          },
          "Small-Org Friendly": { type: "select", value: "High Confidence" },
        },
      }),
      this.createDataSourcePage({
        dataSourceId: dataSources.funders!,
        properties: {
          "Funder Name": { type: "title", value: "Catalyst Learning Fund" },
          Website: { type: "url", value: "https://catalystlearning.example.org" },
          "Average Grant": { type: "number", value: 180000 },
          "Median Grant": { type: "number", value: 150000 },
          "Geographic Focus": { type: "multi_select", value: ["National"] },
          "Giving Summary": {
            type: "rich_text",
            value:
              "Prioritizes systems-change education work, evaluation rigor, and organizations with multi-site scale.",
          },
          "Grant DNA Top Terms": {
            type: "rich_text",
            value: "systems change, evidence-based, catalytic investment, scale",
          },
          "Small-Org Friendly": { type: "select", value: "Needs Review" },
        },
      }),
    ]);

    const summary: DemoSeedResult = {
      seededAt,
      organizationPageId: organizationPage.id,
      programPageIds: programPages.map((page) => page.id),
      evidencePageIds: evidencePages.map((page) => page.id),
      documentPageIds: documentPages.map((page) => page.id),
      funderPageIds: funderPages.map((page) => page.id),
    };

    await this.writeJsonFile(this.getScopedSupportFilePath(DEMO_SEED_FILE, clerkUserId), summary);

    return {
      created: true as const,
      reused: false as const,
      summary,
    };
  }

  async syncOpportunityIntake(input: NotionOpportunitySyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });

    const funderPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.funders!,
      titlePropertyName: "Funder Name",
      title: input.funderName,
      properties: {
        "Funder Name": { type: "title", value: input.funderName },
        Website: { type: "url", value: input.funderWebsite ?? input.sourceUrl ?? null },
        "Giving Summary": {
          type: "rich_text",
          value: "Added from the intake pipeline. ProPublica enrichment will deepen this record later.",
        },
      },
    });

    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
        Funder: { type: "relation", value: [funderPage.id] },
        "Funder Name": { type: "rich_text", value: input.funderName },
        Status: { type: "select", value: "Researching" },
        Deadline: { type: "date", value: input.deadline ?? null },
        "Submission Platform": {
          type: "select",
          value: this.toSupportedSubmissionMethod(input.submissionMethod),
        },
        "Source URL": { type: "url", value: input.sourceUrl ?? null },
        "Portal URL": { type: "url", value: input.portalUrl ?? null },
      },
    });

    const existingRequirementPages = await this.queryDataSourcePages({
      dataSourceId: dataSources.requirements!,
      pageSize: 100,
    });

    const requirementPages = await Promise.all(
      input.requirements.map(async (requirement, index) => {
        const expectedTitle = this.toRequirementRecordTitle(
          requirement.questionText,
          `Requirement ${index + 1}`,
        );
        const existing = existingRequirementPages.results.find((page) => {
          const title = this.readPageTitle(page.properties, "Requirement");
          const opportunityName = this.readPageRichText(page.properties, "Opportunity Name");

          return (
            title?.trim().toLowerCase() === expectedTitle.trim().toLowerCase() &&
            this.hasOpportunityTitleAlias(opportunityName, scope.relatedTitles)
          );
        });

        const properties: Record<string, NotionPagePropertyValue> = {
          Requirement: { type: "title", value: expectedTitle },
          Opportunity: { type: "relation", value: [opportunityPage.id] },
          "Opportunity Name": { type: "rich_text", value: scope.opportunityTitle },
          "Requirement Type": {
            type: "select",
            value: this.toSupportedRequirementType(requirement.requirementType),
          },
          Required: { type: "checkbox", value: true },
          "Word Limit": { type: "number", value: requirement.wordLimit ?? null },
          "Coverage Status": { type: "select", value: "Red" },
          "Risk Flag": { type: "rich_text", value: null },
          "Reviewer Notes": { type: "rich_text", value: null },
        };

        if (existing) {
          return this.updatePage({
            pageId: existing.id,
            properties,
          });
        }

        return this.createDataSourcePage({
          dataSourceId: dataSources.requirements!,
          properties,
        });
      }),
    );

    const activeRequirementPageIds = new Set(requirementPages.map((page) => page.id));
    await Promise.all(
      existingRequirementPages.results
        .filter((page) => {
          const opportunityName = this.readPageRichText(page.properties, "Opportunity Name");
          return (
            this.hasOpportunityTitleAlias(opportunityName, scope.relatedTitles) &&
            !activeRequirementPageIds.has(page.id)
          );
        })
        .map((page) => this.archivePage(page.id)),
    );

    const result = {
      funderPageId: funderPage.id,
      opportunityPageId: opportunityPage.id,
      requirementPageIds: requirementPages.map((page) => page.id),
    };
    await this.recordSyncStatus({
      operation: "opportunity-intake",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncOpportunityPortalDiscovery(
    input: NotionOpportunityPortalDiscoverySyncInput,
  ) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });

    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
        "Source URL": { type: "url", value: input.sourceUrl ?? null },
        "Portal URL": { type: "url", value: input.portalUrl ?? null },
        "Submission Platform": {
          type: "select",
          value: this.toSupportedSubmissionMethod(input.submissionMethod),
        },
        Status: { type: "select", value: "Researching" },
      },
    });

    const result = {
      opportunityPageId: opportunityPage.id,
    };
    await this.recordSyncStatus({
      operation: "portal-discovery",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncOpportunityStatus(input: NotionOpportunityStatusSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });

    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
        Status: { type: "select", value: input.status },
      },
    });

    const result = {
      opportunityPageId: opportunityPage.id,
    };
    await this.recordSyncStatus({
      operation: "opportunity-status",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async appendOpportunityHandoffLog(input: NotionOpportunityHandoffLogInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId ?? undefined,
      opportunityTitle: input.opportunityTitle,
    });
    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
      },
    });

    await this.appendSubmissionHandoffLogToOpportunityPage(opportunityPage.id, input.line);

    const result = {
      opportunityPageId: opportunityPage.id,
    };
    await this.recordSyncStatus({
      operation: "submission-handoff-log",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncOrganizationProfile(input: NotionOrganizationProfileSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();

    const organizationPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.organization!,
      titlePropertyName: "Name",
      title: input.legalName,
      properties: {
        Name: { type: "title", value: input.legalName },
        EIN: { type: "rich_text", value: input.ein },
        Mission: { type: "rich_text", value: input.mission },
        "Annual Budget": { type: "number", value: input.annualBudget ?? null },
        "Staff Size": { type: "number", value: input.staffSize ?? null },
        "Founding Year": { type: "number", value: input.foundingYear ?? null },
        "Executive Director": {
          type: "rich_text",
          value: input.executiveDirector ?? null,
        },
        "Grants Contact": {
          type: "rich_text",
          value: input.grantsContact ?? null,
        },
        Address: { type: "rich_text", value: input.address ?? null },
        "Service Areas": {
          type: "multi_select",
          value: toNotionMultiSelectValues(input.serviceArea),
        },
        "Program Areas": {
          type: "multi_select",
          value: toNotionMultiSelectValues(input.programAreas),
        },
        Website: { type: "url", value: input.website ?? null },
      },
    });

    const result = {
      organizationPageId: organizationPage.id,
    };
    await this.recordSyncStatus({
      operation: "organization-profile",
      target: input.legalName,
    });
    return result;
  }

  async syncAgentProgress(
    input: NotionAgentProgressSyncInput,
  ): Promise<NotionAgentProgressSyncResult> {
    const dataSources = await this.requireBootstrapDataSources();
    const recordedAt = new Date().toISOString();

    const agentLogPage = await this.createDataSourcePage({
      dataSourceId: dataSources["agent-logs"]!,
      properties: {
        "Log Entry": {
          type: "title",
          value: this.toAgentProgressTitle(input.progressLine, input.agentName),
        },
        "Run ID": { type: "rich_text", value: input.runId ?? null },
        Timestamp: { type: "date", value: recordedAt },
        Agent: {
          type: "select",
          value: this.toSupportedAgentLogValue(input.agentName),
        },
        Action: {
          type: "rich_text",
          value: input.actionDescription,
        },
        Source: {
          type: "rich_text",
          value: input.source ?? null,
        },
        Confidence: {
          type: "select",
          value: this.toSupportedConfidenceLabel(input.confidenceLevel),
        },
        "Confidence %": {
          type: "number",
          value:
            typeof input.confidenceLevel === "number"
              ? Math.max(0, Math.min(1, input.confidenceLevel))
              : null,
        },
        "Source URL": { type: "url", value: input.sourceUrl ?? null },
        "Follow-Up Required": {
          type: "checkbox",
          value: Boolean(input.followUpRequired),
        },
        "Output Summary": {
          type: "rich_text",
          value: input.summary,
        },
        Summary: {
          type: "rich_text",
          value: input.summary,
        },
      },
    });

    const targetPageIds = new Set<string>();
    if (input.targetPageId) {
      await this.appendProgressBlock(input.targetPageId, input.progressLine);
      targetPageIds.add(input.targetPageId);
    } else {
      const pageTargets = await this.findProgressTargetPageIds({
        opportunityTitle: input.opportunityTitle,
        funderName: input.funderName,
        dataSources,
      });

      for (const pageId of pageTargets) {
        await this.appendProgressBlock(pageId, input.progressLine);
        targetPageIds.add(pageId);
      }
    }

    const result = {
      agentLogPageId: agentLogPage.id,
      targetPageIds: [...targetPageIds],
    };
    await this.recordSyncStatus({
      operation: "agent-progress",
      target: input.opportunityTitle ?? input.funderName ?? input.agentName,
    });
    return result;
  }

  async syncOpportunityAnalysis(input: NotionOpportunityAnalysisSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });
    const funderPage =
      input.funderName && normalizeText(input.funderName)
        ? await this.findDataSourcePageByTitle(
            dataSources.funders!,
            "Funder Name",
            input.funderName,
          )
        : null;

    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
        Funder: { type: "relation", value: funderPage?.id ? [funderPage.id] : [] },
        "Funder Name": { type: "rich_text", value: input.funderName ?? null },
        Status: { type: "select", value: input.status ?? "Researching" },
        Deadline: { type: "date", value: input.deadline ?? null },
        "Submission Platform": {
          type: "select",
          value: this.toSupportedSubmissionMethod(input.submissionPlatform),
        },
        "Fit Score": {
          type: "number",
          value: roundPercentForNotion(input.fitScorePercent),
        },
        "Pursue Decision": {
          type: "select",
          value: this.toSupportedPursueDecision(input.pursueDecision),
        },
        "Evidence Coverage %": {
          type: "number",
          value: roundPercentForNotion(input.evidenceCoveragePercent),
        },
        "Effort Hours": { type: "number", value: input.effortHours },
        "Reporting Burden Score": {
          type: "number",
          value: input.reportingBurdenScore ?? null,
        },
        "Priority Score": { type: "number", value: input.priorityScore ?? null },
        "Next Best Action": {
          type: "rich_text",
          value: input.nextBestAction ?? null,
        },
        "Source URL": { type: "url", value: input.sourceUrl ?? null },
        "Portal URL": { type: "url", value: input.portalUrl ?? null },
      },
    });

    const requirementPages = await this.queryDataSourcePages({
      dataSourceId: dataSources.requirements!,
      pageSize: 100,
    });

    const updatedRequirementPages = await Promise.all(
      input.requirements.map(async (requirement, index) => {
        const fallbackTitle = `Requirement ${index + 1}`;
        const expectedTitle = this.toRequirementRecordTitle(
          requirement.questionText,
          fallbackTitle,
        );
        const existing = requirementPages.results.find((page) => {
          const title = this.readPageTitle(page.properties, "Requirement");
          const opportunityName = this.readPageRichText(page.properties, "Opportunity Name");

          return (
            title?.trim().toLowerCase() === expectedTitle.trim().toLowerCase() &&
            this.hasOpportunityTitleAlias(opportunityName, scope.relatedTitles)
          );
        });

        const properties: Record<string, NotionPagePropertyValue> = {
          Requirement: { type: "title", value: expectedTitle },
          Opportunity: { type: "relation", value: [opportunityPage.id] },
          "Opportunity Name": { type: "rich_text", value: scope.opportunityTitle },
          "Coverage Status": { type: "select", value: requirement.coverageStatus },
          "Risk Level": { type: "select", value: requirement.riskLevel },
          Required: {
            type: "checkbox",
            value: requirement.required ?? true,
          },
          "Risk Flag": {
            type: "rich_text",
            value: requirement.riskFlag ?? requirement.note,
          },
          "Reviewer Notes": { type: "rich_text", value: requirement.note },
        };

        if (existing) {
          return this.updatePage({
            pageId: existing.id,
            properties,
          });
        }

        return this.createDataSourcePage({
          dataSourceId: dataSources.requirements!,
          properties,
        });
      }),
    );

    const activeRequirementPageIds = new Set(updatedRequirementPages.map((page) => page.id));
    await Promise.all(
      requirementPages.results
        .filter((page) => {
          const opportunityName = this.readPageRichText(page.properties, "Opportunity Name");
          return (
            this.hasOpportunityTitleAlias(opportunityName, scope.relatedTitles) &&
            !activeRequirementPageIds.has(page.id)
          );
        })
        .map((page) => this.archivePage(page.id)),
    );

    const taskPages = await Promise.all(
      input.tasks.map((task) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources.tasks!,
          titlePropertyName: "Task",
          title: task.title,
          properties: {
            Task: { type: "title", value: task.title },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            Priority: { type: "select", value: task.priority },
            Status: { type: "select", value: task.status },
            "Due Date": { type: "date", value: task.dueDate ?? null },
            Assignee: { type: "rich_text", value: task.assignee ?? null },
            Blocking: { type: "checkbox", value: task.blocking },
          },
        }),
      ),
    );

    const result = {
      opportunityPageId: opportunityPage.id,
      requirementPageIds: updatedRequirementPages.map((page) => page.id),
      taskPageIds: taskPages.map((page) => page.id),
    };
    await this.recordSyncStatus({
      operation: "opportunity-analysis",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncDraftAnswers(input: NotionDraftAnswersSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });
    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
      },
    });

    const existingDraftPages = await this.queryDataSourcePages({
      dataSourceId: dataSources["draft-answers"]!,
      pageSize: 100,
    });
    const requirementPages = await this.queryDataSourcePages({
      dataSourceId: dataSources.requirements!,
      pageSize: 100,
    });

    const draftPages = await Promise.all(
      input.drafts.map(async (draft, index) => {
        const draftName = this.toDraftRecordTitle(
          scope.opportunityTitle,
          draft.requirementText,
          `Draft ${index + 1}`,
        );
        const requirementTitle = this.toRequirementRecordTitle(
          draft.requirementText,
          `Requirement ${index + 1}`,
        );
        const requirementPage =
          requirementPages.results.find((page) => {
            const title = this.readPageTitle(page.properties, "Requirement");
            const opportunityName = this.readPageRichText(page.properties, "Opportunity Name");
            return (
              normalizeText(title) === normalizeText(requirementTitle) &&
              this.hasOpportunityTitleAlias(opportunityName, scope.relatedTitles)
            );
          }) ?? null;
        const evidenceRelationIds = await this.resolveRelationIdsByTitle(
          dataSources["evidence-library"]!,
          "Evidence Title",
          draft.evidenceCitations,
        );
        const reviewerNote =
          draft.reviewerNotes ??
          (draft.unsupportedClaims.length > 0
            ? `UNSUPPORTED: ${draft.unsupportedClaims.join("; ")}`
            : null);

        return this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources["draft-answers"]!,
          titlePropertyName: "Draft Name",
          title: draftName,
          properties: {
            "Draft Name": { type: "title", value: draftName },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            Requirement: {
              type: "relation",
              value: requirementPage?.id ? [requirementPage.id] : [],
            },
            Evidence: { type: "relation", value: evidenceRelationIds },
            Status: { type: "select", value: draft.status },
            "Draft Text": { type: "rich_text", value: draft.draftText },
            "Evidence Citations": {
              type: "rich_text",
              value: draft.evidenceCitations.join("; "),
            },
            "DNA Match %": {
              type: "number",
              value: roundPercentForNotion(draft.dnaMatchPercent),
            },
            "Unsupported Claims": {
              type: "checkbox",
              value: draft.unsupportedClaims.length > 0,
            },
            "Reviewer Notes": {
              type: "rich_text",
              value: reviewerNote,
            },
          },
        });
      }),
    );

    await Promise.all(
      draftPages.map((page, index) => {
        const draft = input.drafts[index];
        if (!draft || draft.unsupportedClaims.length === 0) {
          return Promise.resolve();
        }

        return this.appendDraftUnsupportedWarningBlock(page.id, draft.unsupportedClaims);
      }),
    );

    if (input.archiveStale !== false) {
      const activeDraftPageIds = new Set(draftPages.map((page) => page.id));
      await Promise.all(
        existingDraftPages.results
          .filter((page) => {
            const title = this.readPageTitle(page.properties, "Draft Name");
            return (
              this.titleMatchesAnyOpportunityPrefix(title, scope.relatedTitles) &&
              !activeDraftPageIds.has(page.id)
            );
          })
          .map((page) => this.archivePage(page.id)),
      );
    }

    const result = {
      opportunityPageId: opportunityPage.id,
      draftPageIds: draftPages.map((page) => page.id),
      draftPages: draftPages.map((page, index) => ({
        id: page.id,
        url: page.url,
        requirementText: input.drafts[index]?.requirementText ?? "Requirement",
      })),
    };
    await this.recordSyncStatus({
      operation: "draft-answers",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncDocumentVaultEntry(input: NotionDocumentVaultSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const organizationPage =
      input.organizationName && normalizeText(input.organizationName)
        ? await this.findDataSourcePageByTitle(
            dataSources.organization!,
            "Name",
            input.organizationName,
          )
        : null;

    const documentPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.documents!,
      titlePropertyName: "Document Name",
      title: input.documentName,
      properties: {
        "Document Name": { type: "title", value: input.documentName },
        Organization: {
          type: "relation",
          value: organizationPage?.id ? [organizationPage.id] : [],
        },
        Category: { type: "select", value: input.category },
        "Upload Status": { type: "select", value: input.uploadStatus },
        Owner: { type: "rich_text", value: input.owner ?? null },
        "Expiration Date": { type: "date", value: input.expirationDate ?? null },
        "File URL": { type: "url", value: input.fileUrl ?? null },
      },
    });

    const result = {
      documentPageId: documentPage.id,
    };
    await this.recordSyncStatus({
      operation: "document-vault",
      target: input.documentName,
    });
    return result;
  }

  async syncProgramRecord(input: NotionProgramSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const organizationPage = await this.findDataSourcePageByTitle(
      dataSources.organization!,
      "Name",
      input.organizationName,
    );

    const programPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.programs!,
      titlePropertyName: "Program Name",
      title: input.programName,
      properties: {
        "Program Name": { type: "title", value: input.programName },
        Organization: {
          type: "relation",
          value: organizationPage?.id ? [organizationPage.id] : [],
        },
        "Target Population": { type: "rich_text", value: input.targetPopulation ?? null },
        Geography: {
          type: "multi_select",
          value: toNotionMultiSelectValues(input.geography),
        },
        Goals: { type: "rich_text", value: input.goals ?? null },
        Outcomes: { type: "rich_text", value: input.outcomes ?? null },
        Metrics: { type: "rich_text", value: input.metrics ?? null },
        "Program Budget": { type: "number", value: input.programBudget ?? null },
        "Program Lead": { type: "rich_text", value: input.programLead ?? null },
        "Strategic Priority": {
          type: "select",
          value: input.strategicPriority ?? "High",
        },
      },
    });

    const result = {
      programPageId: programPage.id,
    };
    await this.recordSyncStatus({
      operation: "program-context",
      target: input.programName,
    });
    return result;
  }

  async syncEvidenceLibraryEntry(input: NotionEvidenceLibrarySyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const programPage = await this.findDataSourcePageByTitle(
      dataSources.programs!,
      "Program Name",
      input.programName,
    );

    const evidencePage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources["evidence-library"]!,
      titlePropertyName: "Evidence Title",
      title: input.evidenceTitle,
      properties: {
        "Evidence Title": { type: "title", value: input.evidenceTitle },
        Program: {
          type: "relation",
          value: programPage?.id ? [programPage.id] : [],
        },
        "Evidence Type": { type: "select", value: input.evidenceType },
        Summary: { type: "rich_text", value: input.summary },
        Metrics: { type: "rich_text", value: input.metrics ?? null },
        Geography: { type: "rich_text", value: input.geography ?? null },
        "Source Document": {
          type: "rich_text",
          value: input.sourceDocument ?? input.programName,
        },
        "Quality Score": { type: "number", value: input.qualityScore ?? null },
        "Reusability Score": {
          type: "select",
          value: input.reusabilityScore ?? null,
        },
        "Collected At": { type: "date", value: input.collectedAt ?? null },
        Tags: {
          type: "multi_select",
          value: toNotionMultiSelectValues(input.tags),
        },
      },
    });

    const result = {
      evidencePageId: evidencePage.id,
    };
    await this.recordSyncStatus({
      operation: "evidence-library",
      target: input.evidenceTitle,
    });
    return result;
  }

  async syncBudgetEntry(input: NotionBudgetSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const programPage = await this.findDataSourcePageByTitle(
      dataSources.programs!,
      "Program Name",
      input.programName,
    );

    const budgetPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.budgets!,
      titlePropertyName: "Budget Name",
      title: input.budgetName,
      properties: {
        "Budget Name": { type: "title", value: input.budgetName },
        Program: {
          type: "relation",
          value: programPage?.id ? [programPage.id] : [],
        },
        "Fiscal Year": { type: "number", value: input.fiscalYear ?? null },
        "Budget Type": { type: "select", value: input.budgetType },
        "Total Revenue": { type: "number", value: input.totalRevenue ?? null },
        "Total Expense": { type: "number", value: input.totalExpense ?? null },
        Notes: { type: "rich_text", value: input.notes ?? input.programName },
      },
    });

    const result = {
      budgetPageId: budgetPage.id,
    };
    await this.recordSyncStatus({
      operation: "budget-record",
      target: input.budgetName,
    });
    return result;
  }

  async syncReviewWorkflow(input: NotionReviewWorkflowSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });
    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
      },
    });
    const existingReviewPages = await this.queryDataSourcePages({
      dataSourceId: dataSources["reviews-approvals"]!,
      pageSize: 100,
    });

    const reviewPages = await Promise.all(
      input.reviews.map((review) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources["reviews-approvals"]!,
          titlePropertyName: "Review",
          title: review.title,
          properties: {
            Review: { type: "title", value: review.title },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            "Review Type": { type: "select", value: review.reviewType },
            Status: { type: "select", value: review.status },
            Reviewer: { type: "rich_text", value: review.reviewer },
            "Requested On": { type: "date", value: review.requestedOn ?? null },
            "Approved On": { type: "date", value: review.approvedOn ?? null },
          },
        }),
      ),
    );

    const activeReviewPageIds = new Set(reviewPages.map((page) => page.id));
    await Promise.all(
      existingReviewPages.results
        .filter((page) => {
          const title = this.readPageTitle(page.properties, "Review");
          return (
            this.titleMatchesAnyOpportunityPrefix(title, scope.relatedTitles) &&
            !activeReviewPageIds.has(page.id)
          );
        })
        .map((page) => this.archivePage(page.id)),
    );

    const taskPages = await Promise.all(
      input.tasks.map((task) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources.tasks!,
          titlePropertyName: "Task",
          title: task.title,
          properties: {
            Task: { type: "title", value: task.title },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            Priority: { type: "select", value: task.priority },
            Status: { type: "select", value: task.status },
            "Due Date": { type: "date", value: task.dueDate ?? null },
            Assignee: { type: "rich_text", value: task.assignee ?? null },
            Blocking: { type: "checkbox", value: task.blocking },
          },
        }),
      ),
    );

    const submissionPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.submissions!,
      titlePropertyName: "Submission",
      title: input.opportunityTitle,
      properties: {
        Submission: { type: "title", value: input.opportunityTitle },
        Opportunity: { type: "relation", value: [opportunityPage.id] },
        Method: {
          type: "select",
          value: this.toSupportedSubmissionMethod(input.submissionMethod),
        },
        "Ready Status": { type: "select", value: input.readyStatus },
        "Portal URL": { type: "url", value: input.portalUrl ?? null },
        "Portal Reference": {
          type: "rich_text",
          value: `Review workflow synced with ready status '${input.readyStatus}'.`,
        },
      },
    });

    const result = {
      reviewPageIds: reviewPages.map((page) => page.id),
      taskPageIds: taskPages.map((page) => page.id),
      submissionPageId: submissionPage.id,
    };
    await this.recordSyncStatus({
      operation: "review-workflow",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncSubmissionPacket(input: NotionSubmissionPacketSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const opportunityPage = await this.findDataSourcePageByTitle(
      dataSources.opportunities!,
      "Opportunity Name",
      input.opportunityTitle,
    );

    const submissionPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.submissions!,
      titlePropertyName: "Submission",
      title: input.opportunityTitle,
      properties: {
        Submission: { type: "title", value: input.opportunityTitle },
        Opportunity: {
          type: "relation",
          value: opportunityPage?.id ? [opportunityPage.id] : [],
        },
        Method: { type: "select", value: input.method },
        "Ready Status": { type: "select", value: input.readyStatus },
        "Portal URL": { type: "url", value: input.portalUrl ?? null },
        "Portal Reference": { type: "rich_text", value: input.portalReference },
      },
    });

    const result = {
      submissionPageId: submissionPage.id,
    };
    await this.recordSyncStatus({
      operation: "submission-packet",
      target: input.opportunityTitle,
    });
    return result;
  }

  async syncReportingWorkflow(input: NotionReportingWorkflowSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const scope = await this.resolveOpportunitySyncScope({
      opportunityId: input.opportunityId,
      opportunityTitle: input.opportunityTitle,
    });
    const opportunityPage = await this.upsertOpportunityPageByScope({
      dataSourceId: dataSources.opportunities!,
      scope,
      properties: {
        "Opportunity Name": { type: "title", value: scope.opportunityTitle },
        Status: { type: "select", value: "Awarded" },
      },
    });

    const reportingPages = await Promise.all(
      input.reports.map((report) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources["reporting-calendar"]!,
          titlePropertyName: "Report",
          title: report.title,
          properties: {
            Report: { type: "title", value: report.title },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            "Opportunity Name": { type: "rich_text", value: input.opportunityTitle },
            "Due Date": { type: "date", value: report.dueDate },
            Status: {
              type: "select",
              value: this.toSupportedReportStatus(report.status),
            },
            Owner: { type: "rich_text", value: report.owner ?? null },
            "Reporting Period": { type: "rich_text", value: report.reportingPeriod ?? null },
            "Required Metrics": {
              type: "rich_text",
              value: report.requiredMetrics ?? (input.metricsToTrack ?? []).join(", "),
            },
            "Template Link": { type: "url", value: report.templateLink ?? null },
          },
        }),
      ),
    );

    const taskPages = await Promise.all(
      input.tasks.map((task) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources.tasks!,
          titlePropertyName: "Task",
          title: task.title,
          properties: {
            Task: { type: "title", value: task.title },
            Opportunity: { type: "relation", value: [opportunityPage.id] },
            Priority: { type: "select", value: task.priority },
            Status: { type: "select", value: task.status },
            "Due Date": { type: "date", value: task.dueDate ?? null },
            Assignee: { type: "rich_text", value: task.assignee ?? null },
            Blocking: { type: "checkbox", value: task.blocking },
          },
        }),
      ),
    );

    const workspacePageTitle = `${scope.opportunityTitle} Reporting`;
    const existingReportingWorkspacePages = await this.searchWorkspacePagesByTitle(workspacePageTitle);
    await Promise.all(
      existingReportingWorkspacePages
        .filter((page) => page.parent?.page_id === opportunityPage.id)
        .map((page) => this.archivePage(page.id)),
    );

    const reportingSummaryBlocks = [
      this.toParagraphBlock(
        `Reporting workspace for ${scope.opportunityTitle}. Grant Guardian generated the deadline plan, milestone tasks, and seeded report templates from the awarded proposal.`,
      ),
      this.toHeadingBlock("Timeline"),
      ...(input.reports.length > 0
        ? input.reports.map((report) =>
            this.toBulletedListItemBlock(
              `${report.title} — due ${report.dueDate} · ${report.status}${report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}`,
            ),
          )
        : [this.toParagraphBlock("No reporting milestones have been created yet.")]),
      this.toHeadingBlock("Metrics to track"),
      ...((input.metricsToTrack ?? []).length > 0
        ? (input.metricsToTrack ?? []).map((metric) => this.toBulletedListItemBlock(metric))
        : [this.toParagraphBlock("No promised metrics were extracted yet.")]),
      this.toHeadingBlock("Draft templates"),
      ...((input.templates ?? []).length > 0
        ? (input.templates ?? []).map((template) =>
            this.toBulletedListItemBlock(
              template.templateLink
                ? `${template.title} — ${template.templateLink}`
                : template.title,
            ),
          )
        : [this.toParagraphBlock("No report templates have been seeded yet.")]),
      this.toHeadingBlock("Milestone reminders"),
      ...(input.tasks.length > 0
        ? input.tasks.map((task) =>
            this.toBulletedListItemBlock(
              `${task.title}${task.dueDate ? ` — due ${task.dueDate}` : ""} · ${task.status}`,
            ),
          )
        : [this.toParagraphBlock("No milestone reminders are scheduled yet.")]),
    ];

    const reportingWorkspacePage = await this.createPage({
      parent: this.buildParent(opportunityPage.id),
      title: workspacePageTitle,
      icon: "📅",
      children: reportingSummaryBlocks,
    });

    const result = {
      reportingPageIds: reportingPages.map((page) => page.id),
      taskPageIds: taskPages.map((page) => page.id),
      reportingWorkspacePageId: reportingWorkspacePage.id,
      reportingWorkspacePageUrl: reportingWorkspacePage.url,
    };
    await this.recordSyncStatus({
      operation: "reporting-workflow",
      target: scope.opportunityTitle,
    });
    return result;
  }

  async syncLessonsMemory(input: NotionLessonsMemorySyncInput) {
    const dataSources = await this.requireBootstrapDataSources();

    const lessonPages = await Promise.all(
      input.lessons.map(async (lesson) => {
        const funderPage = await this.findDataSourcePageByTitle(
          dataSources.funders!,
          "Funder Name",
          lesson.funderName,
        );
        const opportunityPage =
          lesson.opportunityTitle && normalizeText(lesson.opportunityTitle)
            ? await this.findDataSourcePageByTitle(
                dataSources.opportunities!,
                "Opportunity Name",
                lesson.opportunityTitle,
              )
            : null;
        return this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources["lessons-rejections"]!,
          titlePropertyName: "Lesson",
          title: lesson.title,
          properties: {
            Lesson: { type: "title", value: lesson.title },
            Funder: { type: "relation", value: funderPage?.id ? [funderPage.id] : [] },
            Opportunity: {
              type: "relation",
              value: opportunityPage?.id ? [opportunityPage.id] : [],
            },
            "Funder Name": { type: "rich_text", value: lesson.funderName },
            Result: { type: "select", value: lesson.result ?? "Rejected" },
            "Feedback Text": { type: "rich_text", value: lesson.feedbackText },
            Themes: { type: "multi_select", value: toNotionMultiSelectList(lesson.themes) },
            Recommendations: { type: "rich_text", value: lesson.recommendations ?? null },
            "Applies Next Cycle": { type: "checkbox", value: lesson.appliesNextCycle },
          },
        });
      }),
    );

    const funderLessonPages = new Map<string, { id: string }>();
    await Promise.all(
      input.lessons
        .filter((lesson) => lesson.appendToFunderPage)
        .map(async (lesson) => {
          const normalizedFunderName = lesson.funderName.trim();
          if (!normalizedFunderName) {
            return;
          }

          let funderPage = funderLessonPages.get(normalizedFunderName);
          if (!funderPage) {
            const resolved = await this.findDataSourcePageByTitle(
              dataSources.funders!,
              "Funder Name",
              normalizedFunderName,
            );
            if (!resolved) {
              return;
            }

            funderPage = resolved;
            funderLessonPages.set(normalizedFunderName, resolved);
          }

          await this.appendLessonLearnedToFunderPage(funderPage.id, {
            funderName: normalizedFunderName,
            opportunityTitle: lesson.opportunityTitle ?? null,
            themes: lesson.themes,
            recommendations: lesson.recommendations ?? null,
            feedbackText: lesson.feedbackText,
            recordedAt: lesson.recordedAt ?? null,
          });
        }),
    );

    const result = {
      lessonPageIds: lessonPages.map((page) => page.id),
    };
    await this.recordSyncStatus({
      operation: "lessons-memory",
      target: input.lessons[0]?.funderName ?? "Lessons",
    });
    return result;
  }

  async syncFunderContrast(input: NotionFunderContrastSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();

    const contrastPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources["funder-contrasts"]!,
      titlePropertyName: "Contrast",
      title: input.title,
      properties: {
        Contrast: { type: "title", value: input.title },
        "Left Funder": { type: "rich_text", value: input.leftFunder },
        "Right Funder": { type: "rich_text", value: input.rightFunder },
        "Left Grant Signal": { type: "rich_text", value: input.leftGrantSignal },
        "Right Grant Signal": { type: "rich_text", value: input.rightGrantSignal },
        "Primary Difference": { type: "rich_text", value: input.primaryDifference },
        "Contrast Summary": { type: "rich_text", value: input.contrastSummary },
        "Recommended Move": { type: "rich_text", value: input.recommendedMove },
      },
    });

    const result = {
      contrastPageId: contrastPage.id,
    };
    await this.recordSyncStatus({
      operation: "funder-contrast",
      target: input.title,
    });
    return result;
  }

  async syncFunderIntelligence(input: NotionFunderIntelligenceSyncInput) {
    const dataSources = await this.requireBootstrapDataSources();
    const filings = this.dedupeNotionFilings(input.filings);

    const funderPage = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources.funders!,
      titlePropertyName: "Funder Name",
      title: input.funderName,
      properties: {
        "Funder Name": { type: "title", value: input.funderName },
        EIN: { type: "rich_text", value: input.ein ?? null },
        Website: { type: "url", value: input.website ?? null },
        "Foundation Type": {
          type: "select",
          value: input.foundationType ?? null,
        },
        "Issue Areas": {
          type: "multi_select",
          value: toNotionMultiSelectList(input.issueAreas ?? []),
        },
        "Average Grant": { type: "number", value: input.averageGrant ?? null },
        "Median Grant": { type: "number", value: input.medianGrant ?? null },
        "Geographic Focus": {
          type: "multi_select",
          value: toNotionMultiSelectList(input.geographicFocus ?? []),
        },
        "Giving Summary": { type: "rich_text", value: input.givingSummary ?? null },
        "Grant DNA Top Terms": {
          type: "rich_text",
          value: input.grantDnaTopTerms ?? null,
        },
        "Framing Style": {
          type: "rich_text",
          value: input.framingStyle ?? null,
        },
        "Tone Summary": {
          type: "rich_text",
          value: input.toneSummary ?? null,
        },
        Notes: { type: "rich_text", value: input.notes ?? null },
        "Small-Org Friendly": {
          type: "select",
          value: this.toSupportedSmallOrgFriendly(input.smallOrgFriendly),
        },
      },
    });

    const existingFilingPages = await this.queryDataSourcePages({
      dataSourceId: dataSources["funder-filings"]!,
      pageSize: 100,
    });

    const filingPages = await Promise.all(
      filings.map((filing) =>
        this.upsertDataSourcePageByTitle({
          dataSourceId: dataSources["funder-filings"]!,
          titlePropertyName: "Filing Record",
          title: `${input.funderName} ${filing.taxYear}`,
          properties: {
            "Filing Record": {
              type: "title",
              value: `${input.funderName} ${filing.taxYear}`,
            },
            Funder: { type: "relation", value: [funderPage.id] },
            "Tax Year": { type: "number", value: filing.taxYear },
            "Filing Type": { type: "select", value: filing.filingType },
            "Parsed Status": { type: "select", value: filing.parsedStatus },
            "Grant Count": { type: "number", value: filing.grantCount ?? null },
            "Total Grants": { type: "number", value: filing.totalGrants ?? null },
            "Source URL": { type: "url", value: filing.sourceUrl ?? null },
          },
        }),
      ),
    );

    const activeFilingPageIds = new Set(filingPages.map((page) => page.id));
    await Promise.all(
      existingFilingPages.results
        .filter((page) => {
          const title = this.readPageTitle(page.properties, "Filing Record");
          return (
            normalizeText(title).startsWith(`${input.funderName.toLowerCase()} `) &&
            !activeFilingPageIds.has(page.id)
          );
        })
        .map((page) => this.archivePage(page.id)),
    );

    const existingDocumentPages = await this.queryDataSourcePages({
      dataSourceId: dataSources.documents!,
      pageSize: 100,
    });
    const filingDocumentPages = await Promise.all(
      filings
        .filter((filing) => normalizeText(filing.sourceUrl))
        .map((filing) =>
          this.upsertDataSourcePageByTitle({
            dataSourceId: dataSources.documents!,
            titlePropertyName: "Document Name",
            title: `Funder filing · ${input.funderName} · ${filing.taxYear} · ${filing.filingType}`,
            properties: {
              "Document Name": {
                type: "title",
                value: `Funder filing · ${input.funderName} · ${filing.taxYear} · ${filing.filingType}`,
              },
              Organization: { type: "relation", value: [] },
              Category: { type: "select", value: "Other" },
              "Upload Status": { type: "select", value: "Ready" },
              Owner: { type: "rich_text", value: "External funder research" },
              "File URL": { type: "url", value: filing.sourceUrl ?? null },
            },
          }),
        ),
    );

    const activeDocumentPageIds = new Set(filingDocumentPages.map((page) => page.id));
    await Promise.all(
      existingDocumentPages.results
        .filter((page) => {
          const title = this.readPageTitle(page.properties, "Document Name");
          return (
            normalizeText(title).startsWith(
              normalizeText(`Funder filing · ${input.funderName}`),
            ) && !activeDocumentPageIds.has(page.id)
          );
        })
        .map((page) => this.archivePage(page.id)),
    );

    const result = {
      funderPageId: funderPage.id,
      filingPageIds: filingPages.map((page) => page.id),
      documentPageIds: filingDocumentPages.map((page) => page.id),
    };
    await this.recordSyncStatus({
      operation: "funder-intelligence",
      target: input.funderName,
    });
    return result;
  }

  async syncPortfolioOptimizer(input: NotionPortfolioOptimizerSyncInput) {
    const bootstrap =
      (await this.ensureBootstrapDataSources()) ??
      (await this.bootstrapWorkspace({ force: true })).summary;
    if (!bootstrap) {
      throw new Error("No Notion bootstrap summary exists yet. Run the bootstrap flow first.");
    }

    const pageTitle = "Pursue This Week";
    const existingPages = await this.searchWorkspacePagesByTitle(pageTitle);
    await Promise.all(
      existingPages
        .filter((page) => page.parent?.page_id === bootstrap.rootPageId)
        .map((page) => this.archivePage(page.id)),
    );

    const rankedBlocks = input.rankedOpportunities.length
      ? input.rankedOpportunities.map((opportunity, index) =>
          this.toBulletedListItemBlock(
            `${index + 1}. ${opportunity.title} — ${opportunity.classification} | Priority ${opportunity.priorityScore} | Fit ${opportunity.fitScore} | Coverage ${opportunity.evidenceCoveragePercent}% | Effort ${opportunity.effortEstimateHours}h | Deadline ${opportunity.deadline ?? "No deadline saved"} | ${opportunity.nextMove}`,
          ),
        )
      : [this.toParagraphBlock("No active opportunities are ranked right now.")];

    const recommendationBlocks = input.staffingRecommendation.recommendations.length
      ? input.staffingRecommendation.recommendations.map((recommendation) =>
          this.toBulletedListItemBlock(
            `${recommendation.hours}h this week on ${recommendation.opportunityTitle} (${recommendation.classification})`,
          ),
        )
      : [this.toParagraphBlock("No hours are currently recommended this week.")];

    const page = await this.createPage({
      parent: this.buildParent(bootstrap.rootPageId),
      title: pageTitle,
      icon: "📈",
      children: [
        this.toParagraphBlock(
          `Weekly portfolio snapshot for Grant Guardian. Monthly staff hours: ${input.monthlyStaffHours}. Weekly capacity: ${input.weeklyStaffHours}.`,
        ),
        this.toHeadingBlock("Ranked opportunities"),
        ...rankedBlocks,
        this.toHeadingBlock("This week"),
        this.toParagraphBlock(input.staffingRecommendation.summary),
        ...recommendationBlocks,
      ],
    });

    const result = {
      pursueThisWeekPageId: page.id,
    };
    await this.recordSyncStatus({
      operation: "portfolio-optimizer",
      target: "Pursue This Week",
    });
    return result;
  }

  async syncStoredAgentLog(input: {
    logId: string;
    runId?: string | null;
    agentName: string;
    actionDescription: string;
    summary?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
    confidenceLevel?: number | null;
    followUpRequired?: boolean;
    createdAt: string;
  }) {
    const dataSources = await this.requireBootstrapDataSources();
    const title = `${input.createdAt.slice(0, 16)} · ${input.agentName} · ${input.logId.slice(0, 8)}`;
    const page = await this.upsertDataSourcePageByTitle({
      dataSourceId: dataSources["agent-logs"]!,
      titlePropertyName: "Log Entry",
      title,
      properties: {
        "Log Entry": { type: "title", value: title },
        "Run ID": { type: "rich_text", value: input.runId ?? null },
        Timestamp: { type: "date", value: input.createdAt },
        Agent: {
          type: "select",
          value: this.toSupportedAgentLogValue(input.agentName),
        },
        Action: { type: "rich_text", value: input.actionDescription },
        Source: { type: "rich_text", value: input.source ?? null },
        Confidence: {
          type: "select",
          value: this.toSupportedConfidenceLabel(input.confidenceLevel),
        },
        "Confidence %": {
          type: "number",
          value:
            typeof input.confidenceLevel === "number"
              ? Math.max(0, Math.min(1, input.confidenceLevel))
              : null,
        },
        "Source URL": { type: "url", value: input.sourceUrl ?? null },
        "Follow-Up Required": {
          type: "checkbox",
          value: Boolean(input.followUpRequired),
        },
        "Output Summary": {
          type: "rich_text",
          value: input.summary ?? null,
        },
        Summary: {
          type: "rich_text",
          value: input.summary ?? null,
        },
      },
    });
    await this.recordSyncStatus({
      operation: "agent-log-backfill",
      target: input.agentName,
    });
    return {
      agentLogPageId: page.id,
    };
  }

  private dedupeNotionFilings(input: NotionFunderIntelligenceSyncInput["filings"]) {
    const rowsByTaxYear = new Map<number, NotionFunderIntelligenceSyncInput["filings"]>();

    for (const filing of input) {
      const current = rowsByTaxYear.get(filing.taxYear) ?? [];
      current.push(filing);
      rowsByTaxYear.set(filing.taxYear, current);
    }

    return [...rowsByTaxYear.values()]
      .map((group) =>
        [...group].sort((left, right) => {
          const statusDelta =
            this.rankFilingStatus(right.parsedStatus) - this.rankFilingStatus(left.parsedStatus);
          if (statusDelta !== 0) {
            return statusDelta;
          }

          const pdfDelta = Number(this.isPdfLikeUrl(right.sourceUrl)) - Number(this.isPdfLikeUrl(left.sourceUrl));
          if (pdfDelta !== 0) {
            return pdfDelta;
          }

          return (right.taxYear ?? 0) - (left.taxYear ?? 0);
        })[0],
      )
      .filter((row): row is NotionFunderIntelligenceSyncInput["filings"][number] => Boolean(row))
      .sort((left, right) => right.taxYear - left.taxYear);
  }

  private async createPage(input: {
    parent: NotionParent;
    title: string;
    icon?: string;
    children?: unknown[];
  }) {
    const response = await this.authorizedJsonRequest<{
      id: string;
      url?: string;
    }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: input.parent,
        icon: input.icon
          ? {
              type: "emoji",
              emoji: input.icon,
            }
          : undefined,
        properties: {
          title: this.toRichText(input.title),
        },
        content: input.children,
      }),
    });

    return response;
  }

  private async createDatabase(input: {
    parentPageId: string;
    definition: (typeof notionWorkspaceDatabases)[number];
  }): Promise<NotionBootstrapDatabaseRecord> {
    const payload = {
      parent: {
        type: "page_id",
        page_id: input.parentPageId,
      },
      title: this.toRichText(input.definition.name),
      description: this.toRichText(input.definition.description),
      is_inline: false,
      icon: {
        type: "emoji",
        emoji: input.definition.icon,
      },
      initial_data_source: {
        properties: this.buildDataSourceProperties(input.definition.properties),
      },
    };

    const response = await this.authorizedJsonRequest<{
      id: string;
      url?: string;
      data_sources?: Array<{ id: string }>;
    }>("/databases", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      key: input.definition.key,
      name: input.definition.name,
      description: input.definition.description,
      databaseId: response.id,
      databaseUrl: response.url,
      dataSourceId: response.data_sources?.[0]?.id,
    };
  }

  private async createDataSourcePage(input: {
    dataSourceId: string;
    properties: Record<string, NotionPagePropertyValue>;
  }) {
    return this.authorizedJsonRequest<{ id: string; url?: string }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: {
          data_source_id: input.dataSourceId,
        },
        properties: this.buildPageProperties(input.properties),
      }),
    });
  }

  private async appendProgressBlock(pageId: string, progressLine: string) {
    const normalizedLine = normalizeText(progressLine);
    if (!normalizedLine) {
      return;
    }

    const existingChildren = await this.queryBlockChildren(pageId);
    const duplicateExists = existingChildren.results.some(
      (block) => normalizeText(this.readBlockText(block)) === normalizedLine,
    );
    if (duplicateExists) {
      return;
    }

    await this.authorizedJsonRequest<{ results?: Array<{ id: string }> }>(
      `/blocks/${pageId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({
          children: [this.toProgressBlock(normalizedLine)],
        }),
      },
    );
  }

  private async appendDraftUnsupportedWarningBlock(
    pageId: string,
    unsupportedClaims: string[],
  ) {
    const note = `Reviewer note: Unsupported sections still need evidence before approval. ${unsupportedClaims.join("; ")}`;
    await this.authorizedJsonRequest<{ results?: Array<{ id: string }> }>(
      `/blocks/${pageId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({
          children: [this.toParagraphBlock(note)],
        }),
      },
    );
  }

  private async appendLessonLearnedToFunderPage(
    pageId: string,
    input: {
      funderName: string;
      opportunityTitle?: string | null;
      themes: string[];
      recommendations?: string | null;
      feedbackText: string;
      recordedAt?: string | null;
    },
  ) {
    const existingChildren = await this.queryBlockChildren(pageId);
    const hasHeading = existingChildren.results.some((block) => {
      if (block.type !== "heading_2") {
        return false;
      }

      return normalizeText(this.readBlockText(block)).toLowerCase() === "lessons learned";
    });
    const summaryLine = [
      input.recordedAt ? input.recordedAt.slice(0, 10) : null,
      input.opportunityTitle ? input.opportunityTitle : null,
      input.themes.length > 0 ? `Themes: ${input.themes.join(", ")}` : null,
      normalizeText(input.recommendations) || normalizeText(input.feedbackText),
    ]
      .filter(Boolean)
      .join(" · ");
    const duplicateExists = existingChildren.results.some(
      (block) => normalizeText(this.readBlockText(block)) === normalizeText(summaryLine),
    );

    if (duplicateExists) {
      return;
    }

    const children = [
      ...(hasHeading ? [] : [this.toHeadingBlock("Lessons learned")]),
      this.toBulletedListItemBlock(summaryLine),
    ];

    await this.authorizedJsonRequest<{ results?: Array<{ id: string }> }>(
      `/blocks/${pageId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({ children }),
      },
    );
  }

  private async appendSubmissionHandoffLogToOpportunityPage(pageId: string, line: string) {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine) {
      return;
    }

    const existingChildren = await this.queryBlockChildren(pageId);
    const hasHeading = existingChildren.results.some((block) => {
      if (block.type !== "heading_2") {
        return false;
      }

      return normalizeText(this.readBlockText(block)).toLowerCase() === "submission handoff log";
    });
    const duplicateExists = existingChildren.results.some(
      (block) => normalizeText(this.readBlockText(block)) === normalizedLine,
    );

    if (duplicateExists) {
      return;
    }

    const children = [
      ...(hasHeading ? [] : [this.toHeadingBlock("Submission handoff log")]),
      this.toBulletedListItemBlock(normalizedLine),
    ];

    await this.authorizedJsonRequest<{ results?: Array<{ id: string }> }>(
      `/blocks/${pageId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({ children }),
      },
    );
  }

  private async updatePage(input: {
    pageId: string;
    properties: Record<string, NotionPagePropertyValue>;
  }) {
    return this.authorizedJsonRequest<{ id: string; url?: string }>(`/pages/${input.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: this.buildPageProperties(input.properties),
      }),
    });
  }

  private async archivePage(pageId: string) {
    return this.authorizedJsonRequest<{ id: string; url?: string }>(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        in_trash: true,
      }),
    });
  }

  private async searchWorkspacePagesByTitle(query: string) {
    const response = await this.authorizedJsonRequest<{
      results: Array<{
        id: string;
        url?: string;
        object?: string;
        parent?: { type?: string; page_id?: string };
        properties?: Record<string, unknown>;
      }>;
    }>("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filter: {
          property: "object",
          value: "page",
        },
      }),
    });

    const normalizedQuery = query.trim().toLowerCase();
    return response.results.filter((page) => {
      const title =
        this.readPageTitle(page.properties, "title") ??
        this.readPageTitle(page.properties, "Name") ??
        this.readPageTitle(page.properties, "Opportunity Name");

      return title?.trim().toLowerCase() === normalizedQuery;
    });
  }

  private async searchWorkspaceDatabasesByTitle(query: string) {
    const response = await this.authorizedJsonRequest<{
      results: Array<{
        id: string;
        url?: string;
        object?: string;
        parent?: { type?: string; page_id?: string };
        title?: Array<{ plain_text?: string }>;
      }>;
    }>("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filter: {
          property: "object",
          value: "data_source",
        },
      }),
    });

    const normalizedQuery = query.trim().toLowerCase();
    return response.results.filter((database) => {
      const title =
        database.title
          ?.map((segment) => segment.plain_text ?? "")
          .join("")
          .trim() || null;

      return title?.trim().toLowerCase() === normalizedQuery;
    });
  }

  private async queryDataSourcePages(input: { dataSourceId: string; pageSize?: number }) {
    return this.authorizedJsonRequest<{
      results: Array<{
        id: string;
        url?: string;
        properties?: Record<string, unknown>;
      }>;
      has_more?: boolean;
      next_cursor?: string | null;
    }>(`/data_sources/${input.dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: input.pageSize ?? 100,
      }),
    });
  }

  private async readDataSource(dataSourceId: string) {
    return this.authorizedJsonRequest<{
      id: string;
      title?: Array<{ plain_text?: string }>;
      properties?: Record<
        string,
        {
          id?: string;
          name?: string;
          type?: string;
        }
      >;
    }>(`/data_sources/${dataSourceId}`, {
      method: "GET",
    });
  }

  private async readDatabase(databaseId: string) {
    return this.authorizedJsonRequest<{
      id: string;
      url?: string;
      data_sources?: Array<{ id?: string }>;
    }>(`/databases/${databaseId}`, {
      method: "GET",
    });
  }

  private async updateDataSourceProperties(
    dataSourceId: string,
    properties: Record<string, unknown>,
  ) {
    return this.authorizedJsonRequest<{ id: string }>(`/data_sources/${dataSourceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties,
      }),
    });
  }

  private async queryBlockChildren(blockId: string) {
    return this.authorizedJsonRequest<{
      results: Array<{
        id: string;
        type?: string;
        child_database?: { title?: string };
        heading_2?: { rich_text?: Array<{ plain_text?: string }> };
        paragraph?: { rich_text?: Array<{ plain_text?: string }> };
        bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
      }>;
    }>(`/blocks/${blockId}/children?page_size=100`, {
      method: "GET",
    });
  }

  private async resolveOpportunitySyncScope(input: {
    opportunityId?: string;
    opportunityTitle: string;
  }) {
    if (!normalizeText(input.opportunityId)) {
      return {
        opportunityTitle: input.opportunityTitle,
        relatedTitles: buildOpportunityTitleAliases([], input.opportunityTitle),
      };
    }

    const [requestedOpportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId!.trim()))
      .limit(1);

    if (!requestedOpportunity || !normalizeText(requestedOpportunity.organizationId)) {
      return {
        opportunityTitle: input.opportunityTitle,
        relatedTitles: buildOpportunityTitleAliases([], input.opportunityTitle),
      };
    }

    const organizationOpportunities = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.organizationId, requestedOpportunity.organizationId!));
    const relatedRows = collectRelatedOpportunityRows(
      organizationOpportunities,
      requestedOpportunity,
    );
    const canonicalOpportunity =
      selectCanonicalOpportunity(relatedRows) ?? requestedOpportunity;

    return {
      opportunityTitle: canonicalOpportunity.title || input.opportunityTitle,
      relatedTitles: buildOpportunityTitleAliases(relatedRows, input.opportunityTitle),
    };
  }

  private async upsertOpportunityPageByScope(input: {
    dataSourceId: string;
    scope: {
      opportunityTitle: string;
      relatedTitles: string[];
    };
    properties: Record<string, NotionPagePropertyValue>;
  }) {
    const existingPages = await this.queryDataSourcePages({
      dataSourceId: input.dataSourceId,
      pageSize: 100,
    });
    const matchingPages = existingPages.results.filter((page) =>
      this.hasOpportunityTitleAlias(
        this.readPageTitle(page.properties, "Opportunity Name"),
        input.scope.relatedTitles,
      ),
    );
    const preferredPage =
      matchingPages.find(
        (page) =>
          normalizeText(this.readPageTitle(page.properties, "Opportunity Name")) ===
          normalizeText(input.scope.opportunityTitle),
      ) ?? matchingPages[0];

    const page = preferredPage
      ? await this.updatePage({
          pageId: preferredPage.id,
          properties: input.properties,
        })
      : await this.createDataSourcePage({
          dataSourceId: input.dataSourceId,
          properties: input.properties,
        });

    await Promise.all(
      matchingPages
        .filter((matchingPage) => matchingPage.id !== page.id)
        .map((matchingPage) => this.archivePage(matchingPage.id)),
    );

    return page;
  }

  private async upsertDataSourcePageByTitle(input: {
    dataSourceId: string;
    titlePropertyName: string;
    title: string;
    properties: Record<string, NotionPagePropertyValue>;
  }) {
    const existing = await this.findDataSourcePageByTitle(
      input.dataSourceId,
      input.titlePropertyName,
      input.title,
    );

    if (!existing) {
      return this.createDataSourcePage({
        dataSourceId: input.dataSourceId,
        properties: input.properties,
      });
    }

    return this.updatePage({
      pageId: existing.id,
      properties: input.properties,
    });
  }

  private async findDataSourcePageByTitle(
    dataSourceId: string,
    titlePropertyName: string,
    expectedTitle: string,
  ) {
    const response = await this.queryDataSourcePages({
      dataSourceId,
      pageSize: 100,
    });
    const normalizedExpected = expectedTitle.trim().toLowerCase();

    return response.results.find((page) => {
      const actualTitle = this.readPageTitle(page.properties, titlePropertyName);
      return actualTitle?.trim().toLowerCase() === normalizedExpected;
    });
  }

  private async resolveRelationIdsByTitle(
    dataSourceId: string,
    titlePropertyName: string,
    titles: Array<string | null | undefined>,
  ) {
    const relationIds = await Promise.all(
      [...new Set(titles.map((title) => normalizeText(title)).filter(Boolean))].map(
        async (title) => {
          const page = await this.findDataSourcePageByTitle(dataSourceId, titlePropertyName, title);
          return page?.id ?? null;
        },
      ),
    );

    return relationIds.filter((id): id is string => Boolean(id));
  }

  private async findProgressTargetPageIds(
    input: {
      opportunityTitle?: string | null;
      funderName?: string | null;
      dataSources: BootstrapDataSourceMap;
    },
  ) {
    const ids: string[] = [];

    const opportunityTitle = input.opportunityTitle?.trim();
    if (opportunityTitle) {
      const opportunityPage = await this.findDataSourcePageByTitle(
        input.dataSources.opportunities!,
        "Opportunity Name",
        opportunityTitle,
      );
      if (opportunityPage?.id) {
        ids.push(opportunityPage.id);
      }
    }

    const funderName = input.funderName?.trim();
    if (funderName) {
      const funderPage = await this.findDataSourcePageByTitle(
        input.dataSources.funders!,
        "Funder Name",
        funderName,
      );
      if (funderPage?.id && !ids.includes(funderPage.id)) {
        ids.push(funderPage.id);
      }
    }

    return ids;
  }

  private readPageTitle(
    properties: Record<string, unknown> | undefined,
    propertyName: string,
  ) {
    if (!properties) {
      return null;
    }

    const property = properties[propertyName] as
      | {
          title?: Array<{ plain_text?: string }>;
        }
      | undefined;

    return (
      property?.title
        ?.map((segment) => segment.plain_text ?? "")
        .join("")
        .trim() || null
    );
  }

  private readPageRichText(
    properties: Record<string, unknown> | undefined,
    propertyName: string,
  ) {
    if (!properties) {
      return null;
    }

    const property = properties[propertyName] as
      | {
          rich_text?: Array<{ plain_text?: string }>;
        }
      | undefined;

    return (
      property?.rich_text
        ?.map((segment) => segment.plain_text ?? "")
        .join("")
        .trim() || null
    );
  }

  private readPageRelationIds(
    properties: Record<string, unknown> | undefined,
    propertyName: string,
  ) {
    if (!properties) {
      return [];
    }

    const property = properties[propertyName] as
      | {
          relation?: Array<{ id?: string }>;
        }
      | undefined;

    return Array.isArray(property?.relation)
      ? property.relation.map((entry) => entry?.id ?? "").filter(Boolean)
      : [];
  }

  private readBlockText(block:
    | {
        heading_2?: { rich_text?: Array<{ plain_text?: string }> };
        paragraph?: { rich_text?: Array<{ plain_text?: string }> };
        bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
        type?: string;
      }
    | undefined,
  ) {
    if (!block) {
      return null;
    }

    const segments =
      block.heading_2?.rich_text ??
      block.paragraph?.rich_text ??
      block.bulleted_list_item?.rich_text ??
      [];

    return segments.map((segment) => segment.plain_text ?? "").join("").trim() || null;
  }

  private hasOpportunityTitleAlias(
    title: string | null,
    opportunityTitleAliases: string[],
  ) {
    const normalizedTitle = normalizeText(title).toLowerCase();
    if (!normalizedTitle) {
      return false;
    }

    return opportunityTitleAliases.some(
      (alias) => normalizeText(alias).toLowerCase() === normalizedTitle,
    );
  }

  private titleMatchesAnyOpportunityPrefix(
    title: string | null,
    opportunityTitleAliases: string[],
  ) {
    const normalizedTitle = normalizeText(title).toLowerCase();
    if (!normalizedTitle) {
      return false;
    }

    return opportunityTitleAliases.some((alias) =>
      normalizedTitle.startsWith(`${normalizeText(alias).toLowerCase()}:`),
    );
  }

  private rankFilingStatus(status: "Queued" | "Parsed" | "Partial" | "Failed") {
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

  private isPdfLikeUrl(value?: string | null) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized.includes("download-filing") || normalized.includes(".pdf");
  }

  private buildParent(parentPageId?: string): NotionParent {
    if (parentPageId) {
      return {
        type: "page_id",
        page_id: parentPageId,
      };
    }

    return {
      type: "workspace",
      workspace: true,
    };
  }

  private buildDataSourceProperties(properties: NotionPropertyDefinition[]) {
    return Object.fromEntries(
      properties
        .map((property) => [property.name, this.toPropertyPayload(property)] as const)
        .filter(([, payload]) => payload !== undefined),
    );
  }

  private async reconcileDataSourceSchema(
    dataSourceId: string,
    definition: (typeof notionWorkspaceDatabases)[number],
  ) {
    let live = await this.readDataSource(dataSourceId);
    let liveProperties = { ...(live.properties ?? {}) };
    const patches: Record<string, unknown> = {};

    if (definition.key === "agent-logs") {
      const legacyConfidence = liveProperties.Confidence;
      if (legacyConfidence?.type === "number" && !liveProperties["Confidence %"]) {
        await this.updateDataSourceProperties(dataSourceId, {
          [legacyConfidence.id ?? "Confidence"]: {
            name: "Confidence %",
            number: { format: "percent" },
          },
        });
        live = await this.readDataSource(dataSourceId);
        liveProperties = { ...(live.properties ?? {}) };
      }
    }

    for (const property of definition.properties) {
      const liveProperty = liveProperties[property.name];
      const payload = this.toPropertyPayload(property);
      if (!payload) {
        continue;
      }

      if (!liveProperty) {
        patches[property.name] = payload;
        continue;
      }

      if (
        liveProperty.type !== property.type ||
        property.type === "relation"
      ) {
        patches[liveProperty.id ?? property.name] = {
          name: property.name,
          ...payload,
        };
      }
    }

    if (Object.keys(patches).length === 0) {
      return;
    }

    await this.updateDataSourceProperties(dataSourceId, patches);
  }

  private buildBootstrapDataSourceMap(bootstrap: NotionBootstrapSummary) {
    return bootstrap.databases.reduce(
      (accumulator, database) => {
        if (database.dataSourceId) {
          accumulator[database.key] = database.dataSourceId;
        }
        return accumulator;
      },
      {} as Partial<BootstrapDataSourceMap>,
    );
  }

  private async reconcileBootstrapDataSources(bootstrap: NotionBootstrapSummary) {
    this.cachedBootstrapDataSourceIds = this.buildBootstrapDataSourceMap(bootstrap);
    try {
      for (const definition of notionWorkspaceDatabases) {
        const dataSourceId =
          this.cachedBootstrapDataSourceIds[definition.key as BootstrapDataSourceKey];
        if (!dataSourceId) {
          continue;
        }
        await this.reconcileDataSourceSchema(dataSourceId, definition);
      }
    } finally {
      this.cachedBootstrapDataSourceIds = null;
    }
  }

  private buildPageProperties(properties: Record<string, NotionPagePropertyValue>) {
    return Object.fromEntries(
      Object.entries(properties)
        .map(([name, property]) => [name, this.toPagePropertyValue(property)] as const)
        .filter(([, property]) => property !== undefined),
    );
  }

  private toPropertyPayload(property: NotionPropertyDefinition) {
    switch (property.type) {
      case "title":
        return { title: {} };
      case "rich_text":
        return { rich_text: {} };
      case "url":
        return { url: {} };
      case "checkbox":
        return { checkbox: {} };
      case "date":
        return { date: {} };
      case "number":
        return {
          number: {
            format: property.format ?? "number",
          },
        };
      case "select":
        return {
          select: {
            options: property.options,
          },
        };
      case "multi_select":
        return {
          multi_select: {
            options: property.options,
          },
        };
      case "relation": {
        const dataSourceIds = this.cachedBootstrapDataSourceIds;
        const targetDataSourceId = dataSourceIds?.[property.dataSourceKey as BootstrapDataSourceKey];
        if (!targetDataSourceId) {
          return undefined;
        }
        return {
          relation: {
            data_source_id: targetDataSourceId,
            single_property: {},
          },
        };
      }
    }
  }

  private toPagePropertyValue(property: NotionPagePropertyValue) {
    switch (property.type) {
      case "title":
        return { title: this.toRichText(property.value) };
      case "rich_text":
        return property.value
          ? { rich_text: this.toRichText(property.value) }
          : undefined;
      case "url":
        return property.value ? { url: property.value } : undefined;
      case "number":
        return typeof property.value === "number"
          ? { number: property.value }
          : undefined;
      case "date":
        return property.value
          ? {
              date: {
                start: property.value,
              },
            }
          : undefined;
      case "checkbox":
        return { checkbox: property.value };
      case "select":
        return property.value
          ? {
              select: {
                name: property.value,
              },
            }
          : undefined;
      case "multi_select":
        return property.value.length > 0
          ? {
              multi_select: property.value.map((value) => ({
                name: value,
              })),
            }
          : undefined;
      case "relation":
        return property.value.length > 0
          ? {
              relation: property.value.map((id) => ({ id })),
            }
          : undefined;
    }
  }

  private toRichText(content: string): NotionPlainText {
    return [
      {
        type: "text",
        text: {
          content,
        },
      },
    ];
  }

  private toProgressBlock(progressLine: string) {
    const normalized = progressLine.trim();
    const checked = normalized.startsWith("✅");

    return {
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: this.toRichText(normalized),
        checked,
        color: "default",
      },
    };
  }

  private toHeadingBlock(content: string) {
    return {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: this.toRichText(content.trim()),
        color: "default",
      },
    };
  }

  private toBulletedListItemBlock(content: string) {
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: this.toRichText(content.trim()),
        color: "default",
      },
    };
  }

  private toParagraphBlock(content: string) {
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: this.toRichText(content.trim()),
        color: "default",
      },
    };
  }

  private toAgentProgressTitle(progressLine: string, agentName: string) {
    const normalized = progressLine.trim();
    return normalized || `${agentName} update`;
  }

  private toSupportedAgentLogValue(agentName: string) {
    const normalized = agentName.trim().toLowerCase();

    if (normalized.includes("intake")) {
      return "Intake Agent";
    }
    if (normalized.includes("fit")) {
      return "Fit Agent";
    }
    if (normalized.includes("funder intelligence")) {
      return "Funder Intelligence Agent";
    }
    if (normalized.includes("funder filing")) {
      return "Funder Filing Parser Agent";
    }
    if (normalized.includes("evidence")) {
      return "Evidence Agent";
    }
    if (normalized.includes("narrative")) {
      return "Narrative Agent";
    }
    if (normalized.includes("review")) {
      return "Review Agent";
    }
    if (
      normalized.includes("submission") ||
      normalized.includes("portal") ||
      normalized.includes("attachment")
    ) {
      return "Submission Agent";
    }
    if (
      normalized.includes("compliance") ||
      normalized.includes("document vault")
    ) {
      return "Compliance Agent";
    }

    return undefined;
  }

  private toSupportedConfidenceLabel(confidenceLevel?: number | null) {
    if (typeof confidenceLevel !== "number" || Number.isNaN(confidenceLevel)) {
      return "Medium";
    }

    if (confidenceLevel >= 0.8) {
      return "High";
    }

    if (confidenceLevel >= 0.5) {
      return "Medium";
    }

    return "Low";
  }

  private async authorizedJsonRequest<T>(path: string, init: RequestInit) {
    const tokens = await this.requireStoredTokens();
    const response = await this.requestWithToken<T>(path, tokens.accessToken, init);

    if (response.status !== 401) {
      return response.body;
    }

    throw new NotionAuthorizationError(
      "The connected Notion workspace rejected this request. Reconnect your Notion workspace and try again.",
    );
  }

  private async requestWithToken<T>(
    path: string,
    accessToken: string,
    init: RequestInit,
  ) {
    const response = await fetch(`${NOTION_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let body: T | NotionApiErrorPayload | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as T | NotionApiErrorPayload;
      } catch {
        body = undefined;
      }
    }

    if (response.status === 401) {
      return {
        status: response.status,
        body: body as T,
      };
    }

    if (!response.ok) {
      throw new NotionApiError(response.status, (body ?? {}) as NotionApiErrorPayload);
    }

    return {
      status: response.status,
      body: body as T,
    };
  }

  private async exchangeCodeForToken(code: string) {
    return this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.NOTION_OAUTH_REDIRECT_URI,
    });
  }

  private async refreshToken(refreshToken: string) {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async requestToken(body: Record<string, string>) {
    const basicToken = Buffer.from(
      `${this.config.NOTION_OAUTH_CLIENT_ID}:${this.config.NOTION_OAUTH_CLIENT_SECRET}`,
    ).toString("base64");

    const response = await fetch(`${NOTION_API_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as NotionTokenResponse | NotionApiErrorPayload;
    if (!response.ok) {
      throw new NotionApiError(response.status, payload as NotionApiErrorPayload);
    }

    return payload as NotionTokenResponse;
  }

  private async storeTokenResponse(response: NotionTokenResponse, clerkUserId: string) {
    const now = new Date().toISOString();
    const [existing] = await db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.clerkUserId, clerkUserId))
      .limit(1);

    await this.invalidateBootstrapArtifacts(clerkUserId);

    if (existing) {
      await db
        .update(notionConnections)
        .set({
          accessToken: this.encrypt(response.access_token),
          workspaceId: response.workspace_id,
          workspaceName: response.workspace_name,
          botId: response.bot_id,
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        })
        .where(eq(notionConnections.id, existing.id));
      return;
    }

    await db.insert(notionConnections).values({
      clerkUserId,
      accessToken: this.encrypt(response.access_token),
      workspaceId: response.workspace_id,
      workspaceName: response.workspace_name,
      botId: response.bot_id,
      connectedAt: now,
      disconnectedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async requireStoredTokens(): Promise<StoredNotionTokens> {
    const clerkUserId = this.requireCurrentClerkUserId();
    const [connection] = await db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.clerkUserId, clerkUserId))
      .limit(1);

    if (!connection?.accessToken || connection.disconnectedAt) {
      throw new NotionAuthorizationError(
        "No Notion workspace is connected for this user yet. Connect Notion from onboarding first.",
      );
    }

    return {
      accessToken: this.decrypt(connection.accessToken),
    };
  }

  private async requireConnectionMetadata() {
    const clerkUserId = this.requireCurrentClerkUserId();
    const connection = await this.readConnectionMetadata(clerkUserId);
    if (!connection) {
      throw new NotionAuthorizationError(
        "No Notion workspace is connected for this user yet. Connect Notion from onboarding first.",
      );
    }

    return connection;
  }

  private async requireBootstrapDataSources(): Promise<BootstrapDataSourceMap> {
    const bootstrap =
      (await this.ensureBootstrapDataSources()) ??
      (await this.bootstrapWorkspace({ force: true })).summary;
    if (!bootstrap) {
      throw new Error("No Notion bootstrap summary exists yet. Run the bootstrap flow first.");
    }

    const dataSources = this.buildBootstrapDataSourceMap(bootstrap);

    const missing = bootstrap.databases
      .filter((database) => !database.dataSourceId)
      .map((database) => database.name);

    if (missing.length > 0) {
      throw new Error(
        `Some Notion data sources are missing IDs: ${missing.join(", ")}. Re-run bootstrap.`,
      );
    }

    return dataSources as BootstrapDataSourceMap;
  }

  private async ensureBootstrapDataSources() {
    const clerkUserId = this.requireCurrentClerkUserId();
    const connection = await this.requireConnectionMetadata();
    const bootstrap = await this.getBootstrapSummary();
    if (!bootstrap) {
      return bootstrap;
    }

    if (bootstrap.workspaceId !== connection.workspaceId) {
      await this.invalidateBootstrapArtifacts(clerkUserId);
      return null;
    }

    const probeDataSourceId = bootstrap.databases.find((database) => database.dataSourceId)?.dataSourceId;
    if (probeDataSourceId) {
      try {
        await this.queryDataSourcePages({
          dataSourceId: probeDataSourceId,
          pageSize: 1,
        });
      } catch (error) {
        if (
          error instanceof NotionApiError &&
          (error.status === 404 ||
            error.code === "object_not_found" ||
            error.message.includes("Could not find database"))
        ) {
          this.logger.warn(
            {
              workspaceId: connection.workspaceId,
              staleDataSourceId: probeDataSourceId,
            },
            "Invalidating stale Notion bootstrap after data source lookup failed",
          );
          await this.invalidateBootstrapArtifacts(clerkUserId);
          return null;
        }

        throw error;
      }
    }

    const knownKeys = new Set(bootstrap.databases.map((database) => database.key));
    const missingDefinitions = notionWorkspaceDatabases.filter(
      (definition) => !knownKeys.has(definition.key),
    );

    if (missingDefinitions.length === 0) {
      await this.reconcileBootstrapDataSources(bootstrap);
      return bootstrap;
    }

    const createdDatabases: NotionBootstrapDatabaseRecord[] = [];
    for (const definition of missingDefinitions) {
      const created = await this.createDatabase({
        parentPageId: bootstrap.rootPageId,
        definition,
      });
      bootstrap.databases.push(created);
      createdDatabases.push(created);
    }

    await this.writeJsonFile(this.getScopedSupportFilePath(BOOTSTRAP_FILE, clerkUserId), bootstrap);
    await this.reconcileBootstrapDataSources(bootstrap);
    this.logger.info(
      {
        createdKeys: createdDatabases.map((database) => database.key),
        rootPageId: bootstrap.rootPageId,
      },
      "Updated Notion bootstrap with newly required databases",
    );

    return bootstrap;
  }

  private async findReusableWorkspaceBootstrap(input: {
    parentPageId?: string;
    workspaceTitle: string;
  }): Promise<NotionBootstrapSummary | null> {
    const connection = await this.requireConnectionMetadata();
    const candidates = await this.searchWorkspacePagesByTitle(input.workspaceTitle);
    if (candidates.length === 0) {
      return null;
    }

    const expectedDatabaseNames = new Set(
      notionWorkspaceDatabases.map((definition) => normalizeText(definition.name)),
    );

    const scoredCandidates = await Promise.all(
      candidates
        .filter((page) =>
          input.parentPageId
            ? page.parent?.type === "page_id" && page.parent.page_id === input.parentPageId
            : true,
        )
        .map(async (page) => {
          const children = await this.queryBlockChildren(page.id);
          const matchingDatabaseCount = new Set(
            children.results
              .filter((block) => block.type === "child_database")
              .map((block) => normalizeText(block.child_database?.title))
              .filter((title): title is string => Boolean(title) && expectedDatabaseNames.has(title)),
          ).size;

          return {
            page,
            matchingDatabaseCount,
          };
        }),
    );

    const bestCandidate = [...scoredCandidates].sort(
      (left, right) => right.matchingDatabaseCount - left.matchingDatabaseCount,
    )[0];

    if (!bestCandidate || bestCandidate.matchingDatabaseCount === 0) {
      return null;
    }

    const databases: NotionBootstrapDatabaseRecord[] = [];
    for (const definition of notionWorkspaceDatabases) {
      const [databaseMatch] = (await this.searchWorkspaceDatabasesByTitle(definition.name)).filter(
        (database) =>
          database.parent?.type === "page_id" && database.parent.page_id === bestCandidate.page.id,
      );
      if (!databaseMatch) {
        continue;
      }

      databases.push({
        key: definition.key,
        name: definition.name,
        description: definition.description,
        databaseId: databaseMatch.id,
        databaseUrl: databaseMatch.url,
        dataSourceId: databaseMatch.id,
      });
    }

    if (databases.length === 0) {
      return null;
    }

    return {
      createdAt: new Date().toISOString(),
      workspaceId: connection.workspaceId,
      workspaceName: connection.workspaceName,
      rootPageId: bestCandidate.page.id,
      rootPageUrl: bestCandidate.page.url,
      parentType: input.parentPageId ? "page" : "workspace",
      parentPageId: input.parentPageId,
      databases,
    };
  }

  private toSupportedRequirementType(input?: string | null) {
    if (!input) {
      return "Narrative";
    }

    const normalized = input.trim().toLowerCase();
    if (normalized.includes("document")) {
      return "Document upload";
    }

    if (normalized.includes("budget")) {
      return "Budget";
    }

    if (normalized.includes("eligib")) {
      return "Eligibility";
    }

    if (normalized.includes("portal")) {
      return "Portal Field";
    }

    return "Narrative";
  }

  private toSupportedPursueDecision(input?: string | null) {
    const normalized = normalizeText(input).toLowerCase();
    if (!normalized) {
      return "Revisit";
    }

    if (normalized.includes("pursue")) {
      return "Pursue";
    }

    if (normalized.includes("revisit")) {
      return "Revisit";
    }

    return "Skip";
  }

  private toSupportedReportStatus(input?: string | null) {
    const normalized = normalizeText(input).toLowerCase();
    if (!normalized || normalized.includes("upcoming") || normalized.includes("not started")) {
      return "Not started";
    }

    if (normalized.includes("progress")) {
      return "In Progress";
    }

    if (normalized.includes("submitted")) {
      return "Submitted";
    }

    if (normalized.includes("overdue")) {
      return "Overdue";
    }

    return "Not started";
  }

  private toSupportedSmallOrgFriendly(input?: string | null) {
    const normalized = normalizeText(input).toLowerCase();
    if (!normalized) {
      return "Needs Review";
    }

    if (normalized.includes("high")) {
      return "High";
    }

    if (normalized.includes("medium") || normalized.includes("moderate")) {
      return "Medium";
    }

    if (normalized.includes("low")) {
      return "Low";
    }

    return "Needs Review";
  }

  private toSupportedSubmissionMethod(input?: string | null) {
    if (!input) {
      return "Other";
    }

    const normalized = input.trim().toLowerCase();
    if (normalized.includes("submittable")) {
      return "Submittable";
    }

    if (normalized.includes("direct application")) {
      return "Email / Direct application";
    }

    if (normalized.includes("email")) {
      return "Email";
    }

    if (normalized.includes("portal")) {
      return "Portal";
    }

    return "Other";
  }

  private toRequirementRecordTitle(questionText?: string | null, fallback = "Requirement") {
    const normalized = (questionText ?? "").trim();
    if (!normalized) {
      return fallback;
    }

    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  private toDraftRecordTitle(
    opportunityTitle: string,
    requirementText?: string | null,
    fallback = "Draft",
  ) {
    const requirementTitle = this.toRequirementRecordTitle(requirementText, fallback);
    const composite = `${opportunityTitle}: ${requirementTitle}`;
    return composite.length > 120 ? `${composite.slice(0, 117)}...` : composite;
  }

  private encrypt(plainText: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
  }

  private decrypt(encoded: string) {
    const [ivBase64, tagBase64, cipherBase64] = encoded.split(".");
    if (!ivBase64 || !tagBase64 || !cipherBase64) {
      throw new Error("Encrypted value is malformed.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(ivBase64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherBase64, "base64")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  private resolveProjectPath(relativePath: string) {
    return resolve(PROJECT_ROOT, relativePath);
  }

  private sanitizeSupportScope(value?: string | null) {
    const normalized = (value ?? "").trim().toLowerCase();
    const cleaned = normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

    return cleaned || "default";
  }

  private getScopedSupportFilePath(relativePath: string, clerkUserId: string) {
    const parts = relativePath.split("/");
    const fileName = parts.pop() ?? relativePath;
    const directory = parts.join("/");
    return `${directory}/${this.sanitizeSupportScope(clerkUserId)}/${fileName}`;
  }

  private getOptionalCurrentClerkUserId() {
    return getCurrentClerkUserId();
  }

  private requireCurrentClerkUserId() {
    const clerkUserId = this.getOptionalCurrentClerkUserId();
    if (!clerkUserId) {
      throw new NotionAuthorizationError(
        "No authenticated Grant Guardian user was found for this Notion request. Sign in through the app first.",
      );
    }

    return clerkUserId;
  }

  private parseOAuthState(state?: string) {
    if (!state) {
      throw new Error("Missing OAuth state. Start the Notion auth flow again.");
    }

    let parsed: OAuthStatePayload;
    try {
      parsed = JSON.parse(this.decrypt(state)) as OAuthStatePayload;
    } catch {
      throw new Error("OAuth state mismatch. Start the Notion auth flow again.");
    }

    if (!parsed.clerkUserId || !parsed.createdAt) {
      throw new Error("OAuth state mismatch. Start the Notion auth flow again.");
    }

    const createdAtMs = Date.parse(parsed.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > STATE_TTL_MS) {
      throw new Error("Notion authorization expired. Start the Notion auth flow again.");
    }

    return parsed;
  }

  private async readConnectionMetadata(clerkUserId: string): Promise<NotionConnectionMetadata | null> {
    const [connection] = await db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.clerkUserId, clerkUserId))
      .limit(1);

    if (!connection?.workspaceId || !connection.accessToken || connection.disconnectedAt) {
      return null;
    }

    return {
      clerkUserId,
      workspaceId: connection.workspaceId,
      workspaceName: connection.workspaceName ?? null,
      workspaceIcon: null,
      botId: connection.botId ?? "",
      ownerType: null,
      duplicatedTemplateId: null,
      connectedAt: connection.connectedAt,
    };
  }

  private resolveLegacyWorkspacePath(relativePath: string) {
    return resolve(LEGACY_WORKSPACE_ROOT, relativePath);
  }

  private resolveReadCandidates(relativePath: string) {
    const primary = this.resolveProjectPath(relativePath);
    const legacy = this.resolveLegacyWorkspacePath(relativePath);
    return primary === legacy ? [primary] : [primary, legacy];
  }

  private async ensureParentDirectory(relativePath: string) {
    await mkdir(dirname(this.resolveProjectPath(relativePath)), { recursive: true });
  }

  private async readJsonFile<T>(relativePath: string): Promise<T | null> {
    for (const candidatePath of this.resolveReadCandidates(relativePath)) {
      try {
        const file = await readFile(candidatePath, "utf8");
        return JSON.parse(file) as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }

    return null;
  }

  private async writeJsonFile<T>(relativePath: string, value: T) {
    await this.ensureParentDirectory(relativePath);
    await writeFile(
      this.resolveProjectPath(relativePath),
      JSON.stringify(value, null, 2),
      "utf8",
    );
  }

  private async invalidateBootstrapArtifacts(clerkUserId: string) {
    await rm(this.resolveProjectPath(this.getScopedSupportFilePath(BOOTSTRAP_FILE, clerkUserId)), {
      force: true,
    });
    await rm(this.resolveProjectPath(this.getScopedSupportFilePath(DEMO_SEED_FILE, clerkUserId)), {
      force: true,
    });
    await rm(this.resolveProjectPath(this.getScopedSupportFilePath(SYNC_STATUS_FILE, clerkUserId)), {
      force: true,
    });
  }

  private async recordSyncStatus(input: {
    operation: string;
    target?: string | null;
  }) {
    const clerkUserId = this.getOptionalCurrentClerkUserId();
    if (!clerkUserId) {
      return;
    }

    const connection = await this.readConnectionMetadata(clerkUserId);
    const status: StoredNotionSyncStatus = {
      lastSyncedAt: new Date().toISOString(),
      lastOperation: input.operation,
      lastTarget: input.target ?? null,
      workspaceId: connection?.workspaceId ?? null,
      workspaceName: connection?.workspaceName ?? null,
    };

    await this.writeJsonFile(
      this.getScopedSupportFilePath(SYNC_STATUS_FILE, clerkUserId),
      status,
    );
  }
}
