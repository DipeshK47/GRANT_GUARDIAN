import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { FunderContrastService } from "../apps/orchestrator/src/services/funders/contrast.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { env } from "../apps/orchestrator/src/config/env.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let leftFunderId: string | undefined;
  let rightFunderId: string | undefined;
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--left-funder-id=")) {
      leftFunderId = arg.replace("--left-funder-id=", "");
      continue;
    }

    if (arg.startsWith("--right-funder-id=")) {
      rightFunderId = arg.replace("--right-funder-id=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    leftFunderId,
    rightFunderId,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();

  if (!args.leftFunderId || !args.rightFunderId) {
    throw new Error(
      "Provide --left-funder-id=<id> and --right-funder-id=<id> to build a contrast.",
    );
  }

  const service = new FunderContrastService(new NotionMcpClient(env, logger), logger);
  const result = await service.run(args);
  logger.info(result, "Funder contrast prepared");
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
      "Failed to prepare funder contrast",
    );
  } else {
    logger.error({ error }, "Failed to prepare funder contrast");
  }
  process.exit(1);
});
