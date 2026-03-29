import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { GeminiLessonFeedbackAnalyzer } from "../apps/orchestrator/src/services/lessons/gemini-feedback.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { LessonMemoryService } from "../apps/orchestrator/src/services/lessons/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let funderId: string | undefined;
  let organizationId: string | undefined;
  let feedbackText: string | undefined;
  let recommendations: string | undefined;
  const themes: string[] = [];
  let appliesNextCycle: boolean | undefined;
  let markOpportunityRejected = false;
  let syncToNotion = false;

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
    if (arg.startsWith("--feedback-text=")) {
      feedbackText = arg.replace("--feedback-text=", "");
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
    if (arg === "--mark-opportunity-rejected") {
      markOpportunityRejected = true;
      continue;
    }
    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    opportunityId,
    funderId,
    organizationId,
    feedbackText,
    themes,
    recommendations,
    appliesNextCycle,
    markOpportunityRejected,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.feedbackText) {
    throw new Error("Provide --feedback-text=\"...\".");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const lessonMemoryService = new LessonMemoryService(
    notionClient,
    new GeminiLessonFeedbackAnalyzer(env, logger),
    logger,
  );
  const result = await lessonMemoryService.record(args);
  logger.info(result, "Lesson memory recorded");
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
      "Failed to record lesson memory",
    );
  } else {
    logger.error({ error }, "Failed to record lesson memory");
  }
  process.exit(1);
});
