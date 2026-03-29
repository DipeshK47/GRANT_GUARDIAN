import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { OpportunityAnalysisService } from "../apps/orchestrator/src/services/opportunities/analysis.js";
import { OpportunityDraftingService } from "../apps/orchestrator/src/services/opportunities/drafting.js";
import { OpportunityReviewWorkflowService } from "../apps/orchestrator/src/services/opportunities/review-workflow.js";
import { SubmissionPacketService } from "../apps/orchestrator/src/services/opportunities/submission-packet.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let syncToNotion = false;
  let confirmAutopilot = false;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
      continue;
    }

    if (arg === "--confirm-autopilot") {
      confirmAutopilot = true;
    }
  }

  return {
    opportunityId,
    syncToNotion,
    confirmAutopilot,
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
  const submissionPacketService = new SubmissionPacketService(
    reviewWorkflowService,
    notionClient,
    logger,
  );

  const result = await submissionPacketService.run(args);
  logger.info(result, "Submission packet assembled");
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
      "Failed to assemble submission packet",
    );
  } else {
    logger.error({ error }, "Failed to assemble submission packet");
  }
  process.exit(1);
});
