import { env } from "../apps/orchestrator/src/config/env.js";
import { OrganizationProfileService } from "../apps/orchestrator/src/services/organizations/profile.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      parsed[key] = valueParts.join("=");
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      parsed[key] = args[index + 1] ?? "";
      index += 1;
    }
  }

  return parsed;
};

const toOptionalNumber = (value?: string) => {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const args = parseArgs();
const service = new OrganizationProfileService(console);

service
  .save({
    organizationId: args["organization-id"],
    legalName: args["legal-name"] ?? "",
    ein: args.ein ?? "",
    mission: args.mission ?? "",
    dbaName: args["dba-name"] ?? null,
    foundedYear: toOptionalNumber(args["founded-year"]),
    vision: args.vision ?? null,
    annualBudget: toOptionalNumber(args["annual-budget"]),
    staffCount: toOptionalNumber(args["staff-count"]),
    volunteerCount: toOptionalNumber(args["volunteer-count"]),
    executiveDirector: args["executive-director"] ?? null,
    grantsContact: args["grants-contact"] ?? null,
    boardChair: args["board-chair"] ?? null,
    address: args.address ?? null,
    website: args.website ?? null,
    phone: args.phone ?? null,
    serviceArea: args["service-area"] ?? null,
    programSummary: args["program-summary"] ?? null,
  })
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          environment: env.NODE_ENV,
          organizationId: result.organizationId,
          created: result.created,
          profileCompletenessPercent: result.profileCompletenessPercent,
          organization: {
            legalName: result.organization.legalName,
            ein: result.organization.ein,
            grantsContact: result.organization.grantsContact,
            serviceArea: result.organization.serviceArea,
            website: result.organization.website,
          },
        },
        null,
        2,
      ),
    );
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unknown error");
    }
    process.exit(1);
  });
