import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed: {
    force?: boolean;
    parentPageId?: string;
    workspaceTitle?: string;
  } = {};

  for (const arg of args) {
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg.startsWith("--parentPageId=")) {
      parsed.parentPageId = arg.replace("--parentPageId=", "");
      continue;
    }

    if (arg.startsWith("--workspaceTitle=")) {
      parsed.workspaceTitle = arg.replace("--workspaceTitle=", "");
    }
  }

  return parsed;
};

const main = async () => {
  const notion = new NotionMcpClient(env, logger);
  const result = await notion.bootstrapWorkspace(parseArgs());

  if (result.reused) {
    logger.info(
      {
        rootPageId: result.summary.rootPageId,
        rootPageUrl: result.summary.rootPageUrl,
      },
      "Reusing existing Notion workspace bootstrap summary",
    );
  } else {
    logger.info(
      {
        rootPageId: result.summary.rootPageId,
        rootPageUrl: result.summary.rootPageUrl,
        databaseCount: result.summary.databases.length,
      },
      "Created Grant Guardian Notion workspace",
    );
  }

  logger.info(
    {
      workspaceId: result.summary.workspaceId,
      workspaceName: result.summary.workspaceName,
      databases: result.summary.databases.map((database) => ({
        name: database.name,
        databaseId: database.databaseId,
      })),
    },
    "Workspace bootstrap summary",
  );
};

main().catch((error) => {
  logger.error({ error }, "Failed to bootstrap Notion workspace");
  process.exit(1);
});
