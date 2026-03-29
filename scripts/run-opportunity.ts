import { readFile } from "node:fs/promises";
import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { OpportunityIntakeService } from "../apps/orchestrator/src/services/intake/opportunity.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { PortalDiscoveryService } from "../apps/orchestrator/src/services/opportunities/portal-discovery.js";

const parseArgs = async () => {
  const args = process.argv.slice(2);
  let url: string | undefined;
  let rawText: string | undefined;
  let organizationId: string | undefined;
  let syncToNotion = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--url=")) {
      url = arg.replace("--url=", "");
      continue;
    }

    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = args[index + 1];
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

    if (arg.startsWith("--text-file=")) {
      const filePath = arg.replace("--text-file=", "");
      rawText = await readFile(filePath, "utf8");
      continue;
    }

    if (arg === "--text-file") {
      const filePath = args[index + 1];
      index += 1;
      if (filePath) {
        rawText = await readFile(filePath, "utf8");
      }
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    url,
    rawText,
    organizationId,
    syncToNotion,
  };
};

const main = async () => {
  const notionClient = new NotionMcpClient(env, logger);
  const geminiClient = new GeminiClient(env);
  const portalDiscoveryService = new PortalDiscoveryService(env, notionClient, logger);
  const intakeService = new OpportunityIntakeService(
    env,
    geminiClient,
    portalDiscoveryService,
    notionClient,
    logger,
  );
  const args = await parseArgs();

  if (!args.url && !args.rawText) {
    throw new Error(
      "Provide either --url=<opportunity-url> or --raw-text=<text> or --text-file=<path>.",
    );
  }

  const result = await intakeService.run(args);
  logger.info(result, "Opportunity intake completed");
};

main().catch((error) => {
  logger.error({ error }, "Failed to run opportunity intake");
  process.exit(1);
});
