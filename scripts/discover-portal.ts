import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { PortalDiscoveryService } from "../apps/orchestrator/src/services/opportunities/portal-discovery.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let sourceUrl: string | undefined;
  let rawText: string | undefined;
  let syncToNotion = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }
    if (arg === "--opportunity-id") {
      opportunityId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-url=")) {
      sourceUrl = arg.replace("--source-url=", "");
      continue;
    }
    if (arg === "--source-url") {
      sourceUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--raw-text=")) {
      rawText = arg.replace("--raw-text=", "");
      continue;
    }
    if (arg === "--raw-text") {
      rawText = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    opportunityId,
    sourceUrl,
    rawText,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId && !args.sourceUrl && !args.rawText) {
    throw new Error("Provide --opportunity-id, --source-url, or --raw-text for portal discovery.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const portalDiscoveryService = new PortalDiscoveryService(env, notionClient, logger);
  const result = await portalDiscoveryService.run(args);
  logger.info(result, "Opportunity portal discovery completed");
};

main().catch((error) => {
  if (error instanceof Error) {
    logger.error(
      {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      "Failed to discover an opportunity portal",
    );
  } else {
    logger.error({ error }, "Failed to discover an opportunity portal");
  }
  process.exit(1);
});
