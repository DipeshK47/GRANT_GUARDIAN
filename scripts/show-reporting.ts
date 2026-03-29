import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { PostAwardReportingService } from "../apps/orchestrator/src/services/reporting/workflow.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let organizationId: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--opportunity-id=")) {
      opportunityId = arg.replace("--opportunity-id=", "");
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
    }
  }

  return { opportunityId, organizationId };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId) {
    throw new Error("Provide --opportunity-id=<local-opportunity-id>.");
  }

  const reportingService = new PostAwardReportingService(undefined, logger);
  const result = await reportingService.list({
    opportunityId: args.opportunityId,
    organizationId: args.organizationId,
  });
  logger.info(result, "Reporting calendar loaded");
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
      "Failed to load reporting calendar",
    );
  } else {
    logger.error({ error }, "Failed to load reporting calendar");
  }
  process.exit(1);
});
