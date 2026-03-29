import { env } from "../apps/orchestrator/src/config/env.js";
import { prepareCliRequestContext } from "../apps/orchestrator/src/lib/cli-request-context.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { FunderIntelligenceService } from "../apps/orchestrator/src/services/funders/intelligence.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { ProPublicaClient } from "../apps/orchestrator/src/services/propublica/client.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let funderId: string | undefined;
  let name: string | undefined;
  let ein: string | undefined;
  let website: string | undefined;
  let syncToNotion = false;

  for (const arg of args) {
    if (arg.startsWith("--funder-id=")) {
      funderId = arg.replace("--funder-id=", "");
      continue;
    }

    if (arg.startsWith("--name=")) {
      name = arg.replace("--name=", "");
      continue;
    }

    if (arg.startsWith("--ein=")) {
      ein = arg.replace("--ein=", "");
      continue;
    }

    if (arg.startsWith("--website=")) {
      website = arg.replace("--website=", "");
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    funderId,
    name,
    ein,
    website,
    syncToNotion,
  };
};

const main = async () => {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs();
  await prepareCliRequestContext({
    args: rawArgs,
    syncToNotion: args.syncToNotion,
    logger,
  });

  const notionClient = new NotionMcpClient(env, logger);
  const service = new FunderIntelligenceService(
    env,
    new ProPublicaClient(env),
    notionClient,
    logger,
  );

  if (!args.funderId && !args.name && !args.ein) {
    throw new Error("Provide --funder-id=<id> or --name=<funder-name> or --ein=<ein>.");
  }

  const result = await service.run(args);
  logger.info(result, "Funder intelligence completed");
};

main().catch((error) => {
  logger.error({ error }, "Failed to enrich funder intelligence");
  process.exit(1);
});
