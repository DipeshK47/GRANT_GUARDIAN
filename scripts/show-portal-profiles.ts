import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { PortalSchemaProfileService } from "../apps/orchestrator/src/services/opportunities/portal-schema.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let submissionSessionId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--submission-session-id=")) {
      submissionSessionId = arg.replace("--submission-session-id=", "");
      continue;
    }

    if (arg === "--submission-session-id") {
      submissionSessionId = args[index + 1];
      index += 1;
    }
  }

  return {
    submissionSessionId,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.submissionSessionId) {
    throw new Error("Provide --submission-session-id=<submission-session-id>.");
  }

  const service = new PortalSchemaProfileService(logger);
  const result = await service.getProfileHintsForSession(args.submissionSessionId);
  logger.info(result, "Portal schema profiles loaded");
};

main().catch((error) => {
  logger.error({ error }, "Failed to load portal schema profiles");
  process.exit(1);
});
