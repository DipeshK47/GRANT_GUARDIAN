import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentLogs, organizations } from "../../db/schema.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type OrganizationProfileInput = {
  organizationId?: string;
  clerkUserId?: string | null;
  legalName: string;
  ein: string;
  mission: string;
  dbaName?: string | null;
  foundedYear?: number | null;
  vision?: string | null;
  annualBudget?: number | null;
  staffCount?: number | null;
  volunteerCount?: number | null;
  executiveDirector?: string | null;
  grantsContact?: string | null;
  boardChair?: string | null;
  address?: string | null;
  website?: string | null;
  phone?: string | null;
  serviceArea?: string | null;
  programSummary?: string | null;
  onboardingCompleted?: boolean | null;
};

export type OrganizationProfileRecord = typeof organizations.$inferSelect;

export type OrganizationProfileSaveResult = {
  organizationId: string;
  created: boolean;
  profileCompletenessPercent: number;
  organization: OrganizationProfileRecord;
};

export type OrganizationListResult = {
  organizations: Array<{
    id: string;
    legalName: string;
    dbaName?: string | null;
    ein: string;
    mission: string;
    serviceArea?: string | null;
    website?: string | null;
      grantsContact?: string | null;
      profileCompletenessPercent: number;
      onboardingCompleted: boolean;
      createdAt: string;
      updatedAt: string;
  }>;
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const normalizeEin = (value?: string | null) => (value ?? "").replace(/\D+/g, "");

const isPresent = (value?: string | null | number) => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return normalizeText(value) !== "";
};

export const computeOrganizationProfileCompleteness = (
  organization?: Partial<OrganizationProfileRecord> | null,
) => {
  if (!organization) {
    return 0;
  }

  const checks = [
    organization.legalName,
    organization.ein,
    organization.mission,
    organization.programSummary,
    organization.serviceArea,
    organization.website,
    organization.grantsContact,
    organization.executiveDirector,
  ];

  const presentCount = checks.filter((value) => isPresent(value as string | null | undefined)).length;
  return Math.round((presentCount / checks.length) * 100);
};

export class OrganizationProfileService {
  private readonly logger: LoggerLike;

  constructor(logger?: Partial<LoggerLike>) {
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : () => undefined,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : () => undefined,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : () => undefined,
    };
  }

  async list(): Promise<OrganizationListResult> {
    return this.listForScope();
  }

  async listForScope(clerkUserId?: string | null): Promise<OrganizationListResult> {
    const normalizedClerkUserId = normalizeText(clerkUserId) || null;
    const rows = normalizedClerkUserId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.clerkUserId, normalizedClerkUserId))
          .orderBy(asc(organizations.createdAt))
      : await db.select().from(organizations).orderBy(asc(organizations.createdAt));

    return {
      organizations: rows.map((row) => ({
        id: row.id,
        legalName: row.legalName,
        dbaName: row.dbaName,
        ein: row.ein,
        mission: row.mission,
        serviceArea: row.serviceArea,
        website: row.website,
        grantsContact: row.grantsContact,
        profileCompletenessPercent: computeOrganizationProfileCompleteness(row),
        onboardingCompleted: Boolean(row.onboardingCompleted),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async save(input: OrganizationProfileInput): Promise<OrganizationProfileSaveResult> {
    const legalName = normalizeText(input.legalName);
    const ein = normalizeText(input.ein);
    const mission = normalizeText(input.mission);
    const clerkUserId = normalizeText(input.clerkUserId) || null;

    if (!legalName) {
      throw new Error("Organization save requires a legalName.");
    }
    if (!ein) {
      throw new Error("Organization save requires an EIN.");
    }
    if (!mission) {
      throw new Error("Organization save requires a mission.");
    }

    const allOrganizations = clerkUserId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.clerkUserId, clerkUserId))
          .orderBy(asc(organizations.createdAt))
      : await db.select().from(organizations).orderBy(asc(organizations.createdAt));
    const requestedOrganizationId = normalizeText(input.organizationId);
    const matchingOrganization = requestedOrganizationId
      ? allOrganizations.find((row) => row.id === requestedOrganizationId) ?? null
      : allOrganizations.find(
          (row) =>
            normalizeEin(row.ein) === normalizeEin(ein) ||
            normalizeText(row.legalName).toLowerCase() === legalName.toLowerCase(),
        ) ?? null;

    if (requestedOrganizationId && clerkUserId && !matchingOrganization) {
      const [existingById] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, requestedOrganizationId))
        .limit(1);
      if (existingById) {
        throw new Error("Organization is not scoped to the current Clerk user.");
      }
    }

    const now = new Date().toISOString();
    const organizationId = matchingOrganization?.id ?? requestedOrganizationId ?? randomUUID();
    const nextValues = {
      legalName,
      dbaName: normalizeText(input.dbaName) || null,
      ein,
      foundedYear: input.foundedYear ?? null,
      mission,
      vision: normalizeText(input.vision) || null,
      annualBudget: input.annualBudget ?? null,
      staffCount: input.staffCount ?? null,
      volunteerCount: input.volunteerCount ?? null,
      executiveDirector: normalizeText(input.executiveDirector) || null,
      grantsContact: normalizeText(input.grantsContact) || null,
      boardChair: normalizeText(input.boardChair) || null,
      address: normalizeText(input.address) || null,
      website: normalizeText(input.website) || null,
      phone: normalizeText(input.phone) || null,
      serviceArea: normalizeText(input.serviceArea) || null,
      programSummary: normalizeText(input.programSummary) || null,
      clerkUserId,
      onboardingCompleted: input.onboardingCompleted ?? matchingOrganization?.onboardingCompleted ?? false,
      updatedAt: now,
    } satisfies Partial<OrganizationProfileRecord>;

    let persistedOrganizationId = organizationId;

    if (matchingOrganization) {
      await db.update(organizations).set(nextValues).where(eq(organizations.id, matchingOrganization.id));
    } else {
      let insertId = organizationId;
      let attempts = 0;
      let inserted = false;

      while (attempts < 3) {
        try {
          await db.insert(organizations).values({
            id: insertId,
            ...nextValues,
            createdAt: now,
          });
          persistedOrganizationId = insertId;
          inserted = true;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (
            message.includes("UNIQUE constraint failed: organizations.id") &&
            !requestedOrganizationId
          ) {
            attempts += 1;
            insertId = randomUUID();
            this.logger.warn(
              {
                previousOrganizationId: persistedOrganizationId,
                nextOrganizationId: insertId,
                attempts,
              },
              "Retrying organization insert after duplicate id collision",
            );
            continue;
          }

          if (
            message.includes("UNIQUE constraint failed: organizations.clerk_user_id") ||
            message.includes("organizations_clerk_user_id_unique")
          ) {
            throw new Error(
              "This user already has a legacy single-workspace record. Run the latest database migration, then choose the existing workspace or create a new one again.",
            );
          }

          throw error;
        }
      }

      if (!inserted) {
        throw new Error(
          "Grant Guardian could not create the workspace after several retries. Please try again.",
        );
      }
    }

    const [savedOrganization] = await db
      .select()
      .from(organizations)
      .where(
        clerkUserId
          ? and(
              eq(organizations.id, persistedOrganizationId),
              eq(organizations.clerkUserId, clerkUserId),
            )
          : eq(organizations.id, persistedOrganizationId),
      )
      .limit(1);

    if (!savedOrganization) {
      throw new Error("Organization profile could not be loaded after save.");
    }

    const created = !matchingOrganization;
    const profileCompletenessPercent = computeOrganizationProfileCompleteness(savedOrganization);

    await db.insert(agentLogs).values({
      id: randomUUID(),
      runId: randomUUID(),
      agentName: "organization-profile",
      actionDescription: created ? "Created organization profile" : "Updated organization profile",
      confidenceLevel: 0.98,
      outputSummary: created
        ? `Created the ${savedOrganization.legalName} organization profile so onboarding can begin.`
        : `Updated the ${savedOrganization.legalName} organization profile and refreshed onboarding readiness.`,
      followUpRequired: profileCompletenessPercent < 100,
      createdAt: now,
      updatedAt: now,
    });

    return {
      organizationId: savedOrganization.id,
      created,
      profileCompletenessPercent,
      organization: savedOrganization,
    };
  }
}
