import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { SubmissionFormFillService } from "../apps/orchestrator/src/services/opportunities/submission-form-fill.js";
import { SubmissionUploadStagingService } from "../apps/orchestrator/src/services/opportunities/submission-upload-staging.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let submissionSessionId: string | undefined;
  let syncToNotion = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--submission-session-id=")) {
      submissionSessionId = arg.replace("--submission-session-id=", "");
      continue;
    }

    if (arg === "--submission-session-id") {
      submissionSessionId = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    submissionSessionId,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.submissionSessionId) {
    throw new Error("Provide --submission-session-id=<submission-session-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const uploadStagingService = new SubmissionUploadStagingService(env, notionClient, logger);
  const service = new SubmissionFormFillService(uploadStagingService, notionClient, logger);
  const result = await service.prepare(args);
  logger.info(result, "Portal field plan prepared");
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
      "Failed to prepare portal field plan",
    );
  } else {
    logger.error({ error }, "Failed to prepare portal field plan");
  }
  process.exit(1);
});
