import { env } from "../apps/orchestrator/src/config/env.js";
import { prepareCliRequestContext } from "../apps/orchestrator/src/lib/cli-request-context.js";
import { logger } from "../apps/orchestrator/src/lib/logger.js";
import { NotionMcpClient } from "../apps/orchestrator/src/services/notion/client.js";
import { DocumentVaultService } from "../apps/orchestrator/src/services/documents/vault.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let documentId: string | undefined;
  let organizationId: string | undefined;
  let name: string | undefined;
  let documentType: string | undefined;
  let filePath: string | undefined;
  let owner: string | undefined;
  let expirationDate: string | undefined;
  let requiredByOpportunityIds: string[] = [];
  let syncToNotion = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--document-id=")) {
      documentId = arg.replace("--document-id=", "");
      continue;
    }
    if (arg === "--document-id") {
      documentId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.replace("--name=", "");
      continue;
    }
    if (arg === "--name") {
      name = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--document-type=")) {
      documentType = arg.replace("--document-type=", "");
      continue;
    }
    if (arg === "--document-type") {
      documentType = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--file-path=")) {
      filePath = arg.replace("--file-path=", "");
      continue;
    }
    if (arg === "--file-path") {
      filePath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--owner=")) {
      owner = arg.replace("--owner=", "");
      continue;
    }
    if (arg === "--owner") {
      owner = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--expiration-date=")) {
      expirationDate = arg.replace("--expiration-date=", "");
      continue;
    }
    if (arg === "--expiration-date") {
      expirationDate = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--required-by=")) {
      requiredByOpportunityIds = arg
        .replace("--required-by=", "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--required-by") {
      requiredByOpportunityIds = (args[index + 1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--sync-notion") {
      syncToNotion = true;
    }
  }

  return {
    documentId,
    organizationId,
    name,
    documentType,
    filePath,
    owner,
    expirationDate,
    requiredByOpportunityIds,
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
  if (!args.name || !args.documentType || !args.filePath) {
    throw new Error(
      "Provide --name, --document-type, and --file-path for document upload.",
    );
  }

  const notionClient = new NotionMcpClient(env, logger);
  const service = new DocumentVaultService(env, notionClient, logger);
  const result = await service.uploadFromLocalPath({
      documentId: args.documentId,
      organizationId: args.organizationId,
      name: args.name,
    documentType: args.documentType,
    filePath: args.filePath,
    owner: args.owner,
    expirationDate: args.expirationDate,
    requiredByOpportunityIds: args.requiredByOpportunityIds,
    syncToNotion: args.syncToNotion,
  });
  logger.info(result, "Document uploaded to vault");
};

main().catch((error) => {
  logger.error({ error }, "Failed to upload document to vault");
  process.exit(1);
});
