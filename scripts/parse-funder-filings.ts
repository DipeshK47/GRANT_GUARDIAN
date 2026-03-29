import { env } from "../apps/orchestrator/src/config/env.js";
import { prepareCliRequestContext } from "../apps/orchestrator/src/lib/cli-request-context.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { FunderFilingParsingService } from "../apps/orchestrator/src/services/funders/filing-parser.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let funderId: string | undefined;
  let taxYear: number | undefined;
  let limit: number | undefined;
  let syncToNotion = false;
  let force = false;

  for (const arg of args) {
    if (arg.startsWith("--funder-id=")) {
      funderId = arg.replace("--funder-id=", "");
      continue;
    }

    if (arg.startsWith("--tax-year=")) {
      const parsed = Number(arg.replace("--tax-year=", ""));
      taxYear = Number.isFinite(parsed) ? parsed : undefined;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.replace("--limit=", ""));
      limit = Number.isFinite(parsed) ? parsed : undefined;
      continue;
    }

    if (arg === "--sync-notion") {
      syncToNotion = true;
      continue;
    }

    if (arg === "--force") {
      force = true;
    }
  }

  return {
    funderId,
    taxYear,
    limit,
    syncToNotion,
    force,
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

  if (!args.funderId) {
    throw new Error("Provide --funder-id=<id>.");
  }

  const notionClient = new NotionMcpClient(env, logger);
  const service = new FunderFilingParsingService(
    env,
    new GeminiClient(env),
    notionClient,
    logger,
  );

  const result = await service.run(args as { funderId: string; taxYear?: number; limit?: number; syncToNotion?: boolean; force?: boolean });
  logger.info(result, "Funder filing parsing completed");
};

main().catch((error) => {
  logger.error({ error }, "Failed to parse funder filings");
  process.exit(1);
});
