import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { OpportunityAnalysisService } from "../apps/orchestrator/src/services/opportunities/analysis.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    opportunityId,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId) {
    throw new Error("Provide --opportunity-id=<local-opportunity-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const analysisService = new OpportunityAnalysisService(notionClient, logger);
  const result = await analysisService.run(args);
  logger.info(result, "Opportunity analysis completed");
};

main().catch((error) => {
  logger.error({ error }, "Failed to analyze opportunity");
  process.exit(1);
});
