import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { opportunities } from "../../db/schema.js";
import { resolveOrganizationId } from "../../lib/organization-scope.js";
import {
  PortalDiscoveryService,
  assessPortalReadiness,
  type PortalReadinessResult,
} from "./portal-discovery.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";
import { dedupeOpportunities } from "./opportunity-identity.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type SubmissionMethod = "Submittable" | "Email" | "Portal" | "Other";

export type OpportunityListResult = {
  opportunities: Array<{
    id: string;
    organizationId?: string | null;
    funderId: string;
    title: string;
    deadline?: string | null;
    status: string;
    submissionMethod?: string | null;
    sourceUrl?: string | null;
    portalUrl?: string | null;
    portalDiscoveredAt?: string | null;
    rationale?: string | null;
    updatedAt: string;
    portalReadiness: PortalReadinessResult;
  }>;
};

export type OpportunityPortalUpdateInput = {
  opportunityId: string;
  portalUrl: string;
  submissionMethod?: SubmissionMethod | string | null;
  syncToNotion?: boolean;
};

export type OpportunityPortalUpdateResult = {
  opportunityId: string;
  opportunityTitle: string;
  portalUrl: string | null;
  submissionMethod: string | null;
  portalDiscoveredAt: string | null;
  portalReadiness: PortalReadinessResult;
  notionSync?: {
    opportunityPageId: string;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

export class OpportunityCatalogService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly portalDiscoveryService: PortalDiscoveryService,
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

  async list(input?: {
    organizationId?: string | null;
    clerkUserId?: string | null;
  }): Promise<OpportunityListResult> {
    const organizationId = await resolveOrganizationId(input?.organizationId, input?.clerkUserId);
    const rows = organizationId
      ? await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.organizationId, organizationId))
          .orderBy(desc(opportunities.updatedAt))
      : await db.select().from(opportunities).orderBy(desc(opportunities.updatedAt));

    const visibleRows = dedupeOpportunities(rows);

    return {
      opportunities: visibleRows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        funderId: row.funderId,
        title: row.title,
        deadline: row.deadline,
        status: row.status,
        submissionMethod: row.submissionMethod,
        sourceUrl: row.sourceUrl,
        portalUrl: row.portalUrl,
        portalDiscoveredAt: row.portalDiscoveredAt,
        rationale: row.rationale,
        updatedAt: row.updatedAt,
        portalReadiness: assessPortalReadiness({
          portalUrl: row.portalUrl,
          submissionMethod: row.submissionMethod,
          sourceUrl: row.sourceUrl,
        }),
      })),
    };
  }

  async updatePortal(input: OpportunityPortalUpdateInput): Promise<OpportunityPortalUpdateResult> {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new Error("No opportunity exists for the provided opportunityId.");
    }

    const portalReadiness = assessPortalReadiness({
      portalUrl: input.portalUrl,
      submissionMethod: input.submissionMethod ?? opportunity.submissionMethod,
      sourceUrl: opportunity.sourceUrl,
    });

    const now = new Date().toISOString();
    const nextPortalUrl =
      portalReadiness.preferredBrowserUrl ??
      portalReadiness.normalizedPortalUrl ??
      (normalizeText(input.portalUrl) || null);
    const nextSubmissionMethod =
      portalReadiness.submissionMethod ?? (normalizeText(input.submissionMethod) || null);

    await db
      .update(opportunities)
      .set({
        portalUrl: nextPortalUrl,
        submissionMethod: nextSubmissionMethod,
        portalDiscoveredAt: nextPortalUrl ? now : opportunity.portalDiscoveredAt,
        updatedAt: now,
      })
      .where(eq(opportunities.id, opportunity.id));

    let notionSync: OpportunityPortalUpdateResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncOpportunityPortalDiscovery({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          sourceUrl: opportunity.sourceUrl,
          portalUrl: nextPortalUrl,
          submissionMethod: nextSubmissionMethod,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for portal confirmation update");
      }
    }

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      portalUrl: nextPortalUrl,
      submissionMethod: nextSubmissionMethod,
      portalDiscoveredAt: nextPortalUrl ? now : opportunity.portalDiscoveredAt,
      portalReadiness,
      notionSync,
    };
  }
}
