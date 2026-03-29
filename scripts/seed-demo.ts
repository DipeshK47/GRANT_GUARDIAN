import { env } from "../apps/orchestrator/src/config/env.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { DemoSeedService } from "../apps/orchestrator/src/services/demo/seed.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  return {
    force: args.includes("--force"),
    syncToNotion: args.includes("--sync-notion"),
  };
};

const main = async () => {
  const notionClient = new NotionMcpClient(env, logger);
  const seedService = new DemoSeedService(notionClient, logger);
  const result = await seedService.seed(parseArgs());

  logger.info(result, "Demo seed completed");
};

main().catch((error) => {
  logger.error({ error }, "Failed to seed demo data");
  process.exit(1);
});
