import { randomUUID } from "node:crypto";
import { db } from "../../db/client.js";
import { agentLogs } from "../../db/schema.js";
import {
  isNotionAuthorizationError,
  type NotionAgentProgressSyncResult,
  type NotionMcpClient,
} from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type AgentProgressRecordInput = {
  runId?: string | null;
  agentName: string;
  actionDescription: string;
  progressLine: string;
  summary: string;
  sourceUrl?: string | null;
  confidenceLevel?: number | null;
  followUpRequired?: boolean;
  opportunityTitle?: string | null;
  funderName?: string | null;
  targetPageId?: string | null;
  syncToNotion?: boolean;
};

export type AgentProgressRecordResult = {
  logId: string;
  runId: string;
  notionSync?: NotionAgentProgressSyncResult;
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

export class AgentProgressService {
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

  async record(input: AgentProgressRecordInput): Promise<AgentProgressRecordResult> {
    const runId = normalizeText(input.runId) || randomUUID();
    const logId = randomUUID();
    const now = new Date().toISOString();

    await db.insert(agentLogs).values({
      id: logId,
      runId,
      agentName: normalizeText(input.agentName),
      actionDescription: normalizeText(input.actionDescription),
      sourceUrl: normalizeText(input.sourceUrl) || null,
      confidenceLevel:
        typeof input.confidenceLevel === "number" ? input.confidenceLevel : null,
      outputSummary: normalizeText(input.summary),
      followUpRequired: Boolean(input.followUpRequired),
      createdAt: now,
      updatedAt: now,
    });

    let notionSync: NotionAgentProgressSyncResult | undefined;
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncAgentProgress({
          runId,
          agentName: input.agentName,
          actionDescription: input.actionDescription,
          progressLine: input.progressLine,
          summary: input.summary,
          source: input.sourceUrl ?? null,
          sourceUrl: input.sourceUrl,
          confidenceLevel: input.confidenceLevel,
          followUpRequired: input.followUpRequired,
          opportunityTitle: input.opportunityTitle,
          funderName: input.funderName,
          targetPageId: input.targetPageId,
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping live Notion progress sync");
      }
    }

    return {
      logId,
      runId,
      notionSync,
    };
  }
}
