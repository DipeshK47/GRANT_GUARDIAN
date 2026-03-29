import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { OpportunityAnalysisService } from "../apps/orchestrator/src/services/opportunities/analysis.js";
import { OpportunityDraftingService } from "../apps/orchestrator/src/services/opportunities/drafting.js";
import { OpportunityReviewWorkflowService } from "../apps/orchestrator/src/services/opportunities/review-workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let reviewer: string | undefined;
  let dueDate: string | undefined;
  let syncToNotion = false;
  let force = false;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }

    if (arg.startsWith("--reviewer=")) {
      reviewer = arg.replace("--reviewer=", "");
      continue;
    }

    if (arg.startsWith("--due-date=")) {
      dueDate = arg.replace("--due-date=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
      continue;
    }

    if (arg === "--force") {
      force = true;
    }
  }

  return {
    opportunityId,
    reviewer,
    dueDate,
    syncToNotion,
    force,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId) {
    throw new Error("Provide --opportunity-id=<local-opportunity-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const geminiClient = new GeminiClient(env);
  const analysisService = new OpportunityAnalysisService(notionClient, logger);
  const draftingService = new OpportunityDraftingService(
    geminiClient,
    analysisService,
    notionClient,
    logger,
  );
  const reviewWorkflowService = new OpportunityReviewWorkflowService(
    draftingService,
    notionClient,
    logger,
  );

  const result = await reviewWorkflowService.run(args);
  logger.info(result, "Opportunity review workflow prepared");
};

main().catch((error) => {
  logger.error({ error }, "Failed to prepare opportunity review workflow");
  process.exit(1);
});
