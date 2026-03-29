import { and, desc, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { notionConnections } from "../db/schema.js";
import { enterRequestContext } from "./request-context.js";

type LoggerLike = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

const normalizeText = (value?: string | null) => value?.trim() || null;

const parseExplicitClerkUserId = (args: string[]) => {
  for (const arg of args) {
    if (arg.startsWith("--clerk-user-id=")) {
      return normalizeText(arg.replace("--clerk-user-id=", ""));
    }
  }

  return null;
};

export const prepareCliRequestContext = async (input: {
  args: string[];
  syncToNotion?: boolean;
  logger?: LoggerLike;
}) => {
  const explicitClerkUserId =
    parseExplicitClerkUserId(input.args) || normalizeText(process.env.CLERK_USER_ID);

  if (explicitClerkUserId) {
    enterRequestContext({ clerkUserId: explicitClerkUserId });
    input.logger?.info?.(
      {
        clerkUserId: explicitClerkUserId,
        resolvedFrom: "explicit",
      },
      "Using Clerk user scope for CLI run",
    );
    return explicitClerkUserId;
  }

  if (!input.syncToNotion) {
    enterRequestContext({ clerkUserId: null });
    return null;
  }

  const activeConnections = await db
    .select({
      clerkUserId: notionConnections.clerkUserId,
      workspaceName: notionConnections.workspaceName,
      updatedAt: notionConnections.updatedAt,
    })
    .from(notionConnections)
    .where(
      and(
        isNull(notionConnections.disconnectedAt),
        isNotNull(notionConnections.accessToken),
      ),
    )
    .orderBy(desc(notionConnections.updatedAt), desc(notionConnections.connectedAt));

  const resolvedConnection = activeConnections[0] ?? null;
  if (!resolvedConnection?.clerkUserId) {
    throw new Error(
      "No active Notion connection is available for CLI sync. Reconnect Notion in the website first or pass --clerk-user-id=<user_id>.",
    );
  }

  if (activeConnections.length > 1) {
    input.logger?.warn?.(
      {
        clerkUserId: resolvedConnection.clerkUserId,
        workspaceName: resolvedConnection.workspaceName,
        activeConnectionCount: activeConnections.length,
      },
      "Multiple active Notion connections were found; defaulting to the most recently updated one",
    );
  }

  enterRequestContext({ clerkUserId: resolvedConnection.clerkUserId });
  input.logger?.info?.(
    {
      clerkUserId: resolvedConnection.clerkUserId,
      workspaceName: resolvedConnection.workspaceName,
      resolvedFrom: "latest-active-notion-connection",
    },
    "Using Clerk user scope for CLI run",
  );

  return resolvedConnection.clerkUserId;
};
