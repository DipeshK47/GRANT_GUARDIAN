import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { LessonMemoryService } from "../apps/orchestrator/src/services/lessons/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let funderId: string | undefined;
  let organizationId: string | undefined;
  let reusableOnly = false;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }
    if (arg.startsWith("--funder-id=")) {
      funderId = arg.replace("--funder-id=", "");
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg === "--reusable-only") {
      reusableOnly = true;
    }
  }

  return {
    opportunityId,
    funderId,
    organizationId,
    reusableOnly,
  };
};

const main = async () => {
  const args = parseArgs();
  const lessonMemoryService = new LessonMemoryService(undefined, undefined, logger);
  const result = await lessonMemoryService.list(args);
  logger.info(result, "Lesson memory loaded");
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
      "Failed to load lesson memory",
    );
  } else {
    logger.error({ error }, "Failed to load lesson memory");
  }
  process.exit(1);
});
