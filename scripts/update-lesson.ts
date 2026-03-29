import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { LessonMemoryService } from "../apps/orchestrator/src/services/lessons/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let lessonId: string | undefined;
  let organizationId: string | undefined;
  const themes: string[] = [];
  let recommendations: string | undefined;
  let appliesNextCycle: boolean | undefined;
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--lesson-id=")) {
      lessonId = arg.replace("--lesson-id=", "");
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg.startsWith("--theme=")) {
      themes.push(arg.replace("--theme=", ""));
      continue;
    }
    if (arg.startsWith("--recommendations=")) {
      recommendations = arg.replace("--recommendations=", "");
      continue;
    }
    if (arg.startsWith("--applies-next-cycle=")) {
      appliesNextCycle = arg.replace("--applies-next-cycle=", "").toLowerCase() === "true";
      continue;
    }
    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    lessonId,
    organizationId,
    themes: themes.length > 0 ? themes : undefined,
    recommendations,
    appliesNextCycle,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.lessonId) {
    throw new Error("Provide --lesson-id=<lesson-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const lessonMemoryService = new LessonMemoryService(notionClient, undefined, logger);
  const result = await lessonMemoryService.update(args);
  logger.info(result, "Lesson memory updated");
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
      "Failed to update lesson memory",
    );
  } else {
    logger.error({ error }, "Failed to update lesson memory");
  }
  process.exit(1);
});
