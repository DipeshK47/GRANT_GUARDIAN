import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { PostAwardReportingService } from "../apps/orchestrator/src/services/reporting/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let organizationId: string | undefined;
  let awardDate: string | undefined;
  let owner: string | undefined;
  let cadence: "Final Only" | "Semiannual + Final" | "Quarterly + Final" | undefined;
  let templateLink: string | undefined;
  let requiredMetrics: string[] = [];
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg.startsWith("--award-date=")) {
      awardDate = arg.replace("--award-date=", "");
      continue;
    }
    if (arg.startsWith("--owner=")) {
      owner = arg.replace("--owner=", "");
      continue;
    }
    if (arg.startsWith("--cadence=")) {
      const value = arg.replace("--cadence=", "") as typeof cadence;
      cadence = value;
      continue;
    }
    if (arg.startsWith("--template-link=")) {
      templateLink = arg.replace("--template-link=", "");
      continue;
    }
    if (arg.startsWith("--required-metric=")) {
      requiredMetrics.push(arg.replace("--required-metric=", ""));
      continue;
    }
    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    opportunityId,
    organizationId,
    awardDate,
    owner,
    cadence,
    templateLink,
    requiredMetrics,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId) {
    throw new Error("Provide --opportunity-id=<local-opportunity-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const reportingService = new PostAwardReportingService(notionClient, logger);
  const result = await reportingService.activate(args);
  logger.info(result, "Post-award reporting workflow activated");
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
      "Failed to activate reporting workflow",
    );
  } else {
    logger.error({ error }, "Failed to activate reporting workflow");
  }
  process.exit(1);
});
