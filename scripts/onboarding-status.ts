import { env } from "../apps/orchestrator/src/config/env.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { CustomerOnboardingService } from "../apps/orchestrator/src/services/onboarding/customer-onboarding.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let organizationId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = args[index + 1];
      index += 1;
    }
  }

  return {
    organizationId,
  };
};

const args = parseArgs();
const notionClient = new NotionMcpClient(env, console);
const service = new CustomerOnboardingService(env, notionClient, console);

service
  .getStatus({
    organizationId: args.organizationId,
  })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unknown error");
    }
    process.exit(1);
  });
