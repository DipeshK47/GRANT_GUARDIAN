import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { OpportunityAnalysisService } from "../apps/orchestrator/src/services/opportunities/analysis.js";
import { OpportunityDraftingService } from "../apps/orchestrator/src/services/opportunities/drafting.js";
import { OpportunityReviewWorkflowService } from "../apps/orchestrator/src/services/opportunities/review-workflow.js";
import { SubmissionAutopilotService } from "../apps/orchestrator/src/services/opportunities/submission-autopilot.js";
import { SubmissionFormFillService } from "../apps/orchestrator/src/services/opportunities/submission-form-fill.js";
import { SubmissionPacketService } from "../apps/orchestrator/src/services/opportunities/submission-packet.js";
import { SubmissionUploadStagingService } from "../apps/orchestrator/src/services/opportunities/submission-upload-staging.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let confirmLaunch = false;
  let launchBrowser = false;
  let reviewerName: string | undefined;
  let reviewerNotes: string | undefined;
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

    if (arg === "--confirm-launch") {
      confirmLaunch = true;
      continue;
    }

    if (arg === "--launch-browser") {
      launchBrowser = true;
      continue;
    }

    if (arg.startsWith("--reviewer-name=")) {
      reviewerName = arg.replace("--reviewer-name=", "");
      continue;
    }

    if (arg === "--reviewer-name") {
      reviewerName = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--reviewer-notes=")) {
      reviewerNotes = arg.replace("--reviewer-notes=", "");
      continue;
    }

    if (arg === "--reviewer-notes") {
      reviewerNotes = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    opportunityId,
    confirmLaunch,
    launchBrowser,
    reviewerName,
    reviewerNotes,
    syncToNotion,
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
  const uploadStagingService = new SubmissionUploadStagingService(env, notionClient, logger);
  const submissionFormFillService = new SubmissionFormFillService(
    uploadStagingService,
    notionClient,
    logger,
  );
  const autopilotService = new SubmissionAutopilotService(
    env,
    submissionPacketService,
    submissionFormFillService,
    notionClient,
    logger,
  );

  const result = await autopilotService.launch(args);
  logger.info(result, "Submission autopilot handoff prepared");
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
      "Failed to prepare submission autopilot handoff",
    );
  } else {
    logger.error({ error }, "Failed to prepare submission autopilot handoff");
  }
  process.exit(1);
});
