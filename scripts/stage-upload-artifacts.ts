import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
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
  const service = new SubmissionUploadStagingService(env, notionClient, logger);
  const result = await service.stage(args);
  logger.info(result, "Upload artifacts staged");
};

main().catch((error) => {
  logger.error({ error }, "Failed to stage upload artifacts");
  process.exit(1);
});
