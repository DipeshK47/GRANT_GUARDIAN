import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { PostAwardReportingService } from "../apps/orchestrator/src/services/reporting/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let reportId: string | undefined;
  let organizationId: string | undefined;
  let status: "Upcoming" | "In Progress" | "Submitted" | "Overdue" | undefined;
  let owner: string | undefined;
  let templateLink: string | undefined;
  const requiredMetrics: string[] = [];
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--report-id=")) {
      reportId = arg.replace("--report-id=", "");
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg.startsWith("--status=")) {
      status = arg.replace("--status=", "") as typeof status;
      continue;
    }
    if (arg.startsWith("--owner=")) {
      owner = arg.replace("--owner=", "");
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
    reportId,
    organizationId,
    status,
    owner,
    templateLink,
    requiredMetrics,
    syncToNotion,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.reportId) {
    throw new Error("Provide --report-id=<reporting-calendar-row-id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const reportingService = new PostAwardReportingService(notionClient, logger);
  const result = await reportingService.updateReport(args);
  logger.info(result, "Reporting workflow entry updated");
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
      "Failed to update reporting workflow entry",
    );
  } else {
    logger.error({ error }, "Failed to update reporting workflow entry");
  }
  process.exit(1);
});
