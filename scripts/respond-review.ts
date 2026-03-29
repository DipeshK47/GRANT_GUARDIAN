import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { OpportunityAnalysisService } from "../apps/orchestrator/src/services/opportunities/analysis.js";
import { OpportunityDraftingService } from "../apps/orchestrator/src/services/opportunities/drafting.js";
import { OpportunityReviewWorkflowService } from "../apps/orchestrator/src/services/opportunities/review-workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let reviewId: string | undefined;
  let status:
    | "Requested"
    | "In Review"
    | "Changes Requested"
    | "Approved"
    | undefined;
  let reviewerNotes: string | undefined;
  let assignee: string | undefined;
  let dueDate: string | undefined;
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--review-id=")) {
      reviewId = arg.replace("--review-id=", "");
      continue;
    }

    if (arg.startsWith("--status=")) {
      status = arg.replace("--status=", "") as
        | "Requested"
        | "In Review"
        | "Changes Requested"
        | "Approved";
      continue;
    }

    if (arg.startsWith("--notes=")) {
      reviewerNotes = arg.replace("--notes=", "");
      continue;
    }

    if (arg.startsWith("--assignee=")) {
      assignee = arg.replace("--assignee=", "");
      continue;
    }

    if (arg.startsWith("--due-date=")) {
      dueDate = arg.replace("--due-date=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    reviewId,
    status,
    reviewerNotes,
    assignee,
    dueDate,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.reviewId || !args.status) {
    throw new Error("Provide --review-id=<local-review-id> and --status=<Requested|In Review|Changes Requested|Approved>.");
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

  const result = await reviewWorkflowService.respond(args);
  logger.info(result, "Opportunity review response recorded");
};

main().catch((error) => {
  logger.error({ error }, "Failed to record review response");
  process.exit(1);
});
