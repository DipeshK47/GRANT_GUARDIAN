import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { PortalDiscoveryService } from "../apps/orchestrator/src/services/opportunities/portal-discovery.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let opportunityId: string | undefined;
  let portalUrl: string | undefined;
  let submissionMethod: string | undefined;
  let probe = false;

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
    if (arg.startsWith("--portal-url=")) {
      portalUrl = arg.replace("--portal-url=", "");
      continue;
    }
    if (arg === "--portal-url") {
      portalUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--submission-method=")) {
      submissionMethod = arg.replace("--submission-method=", "");
      continue;
    }
    if (arg === "--submission-method") {
      submissionMethod = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--probe") {
      probe = true;
    }
  }

  return {
    opportunityId,
    portalUrl,
    submissionMethod,
    probe,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.opportunityId && !args.portalUrl) {
    throw new Error("Provide --opportunity-id or --portal-url to assess portal readiness.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const service = new PortalDiscoveryService(env, notionClient, logger);
  const result = await service.assessReadiness({
    opportunityId: args.opportunityId,
    portalUrl: args.portalUrl,
    submissionMethod: args.submissionMethod,
    probe: args.probe,
  });

  logger.info(result, "Opportunity portal readiness assessed");
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
      "Failed to assess portal readiness",
    );
  } else {
    logger.error({ error }, "Failed to assess portal readiness");
  }
  process.exit(1);
});
