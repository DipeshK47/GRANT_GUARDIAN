import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  portalFieldProfiles,
  portalFormSnapshots,
  submissionSessions,
} from "../../db/schema.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type PortalFieldInventoryDescriptor = {
  key: string;
  label: string;
  tagName: string;
  type: string;
  placeholder?: string | null;
  ariaLabel?: string | null;
};

export type AnnotatedPortalFieldInventoryItem = PortalFieldInventoryDescriptor & {
  normalizedLabel: string;
  fieldType: "Long Text" | "File Upload";
  occurrenceIndex: number;
  portalSignature: string;
};

export type PortalFieldProfileHint = {
  id: string;
  organizationId?: string | null;
  portalHost: string;
  portalPath: string;
  portalUrl: string;
  fieldLabel: string;
  normalizedLabel: string;
  fieldType: "Long Text" | "File Upload";
  tagName: string;
  inputType: string;
  occurrenceIndex: number;
  timesSeen: number;
  timesMatched: number;
  lastMappedFieldLabel?: string | null;
  lastFillAction?: string | null;
  lastConfidence?: number | null;
};

export type PortalSchemaCaptureInput = {
  submissionSessionId?: string;
  organizationId?: string;
  portalUrl?: string;
  fields: PortalFieldInventoryDescriptor[];
  captureSource?: string;
};

export type PortalSchemaCaptureResult = {
  snapshotId: string;
  submissionSessionId?: string;
  opportunityId?: string;
  portalUrl: string;
  portalHost: string;
  portalPath: string;
  fieldCount: number;
  profileSummary: {
    totalProfiles: number;
    newProfiles: number;
    updatedProfiles: number;
    matchedProfiles: number;
    previouslyLearnedMappings: number;
  };
  profiles: PortalFieldProfileHint[];
};

export type PortalSchemaProfileLookupResult = {
  portalUrl: string;
  portalHost: string;
  portalPath: string;
  profileSummary: {
    totalProfiles: number;
    matchedProfiles: number;
    previouslyLearnedMappings: number;
  };
  profiles: PortalFieldProfileHint[];
};

export type PortalMatchLearningInput = {
  submissionSessionId?: string;
  portalUrl?: string;
  fields: PortalFieldInventoryDescriptor[];
  mappings: Array<{
    id: string;
    fieldLabel: string;
  }>;
  matches: Array<{
    mappingId: string;
    portalFieldKey?: string;
    confidence: number;
    fillAction: string;
  }>;
};

export type PortalMatchLearningResult = {
  portalUrl: string;
  portalHost: string;
  portalPath: string;
  updatedProfiles: number;
  reusedProfiles: number;
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const toPortalFieldType = (
  field: Pick<PortalFieldInventoryDescriptor, "tagName" | "type">,
): "Long Text" | "File Upload" =>
  normalizeText(field.type).toLowerCase() === "file" ? "File Upload" : "Long Text";

export const normalizePortalScope = (portalUrl: string) => {
  const parsed = new URL(portalUrl);
  const portalPath = parsed.pathname.replace(/\/+$/, "") || "/";

  return {
    portalUrl: parsed.toString(),
    portalHost: parsed.host.toLowerCase(),
    portalPath,
  };
};

export const annotatePortalFieldInventory = (
  fields: PortalFieldInventoryDescriptor[],
): AnnotatedPortalFieldInventoryItem[] => {
  const occurrenceBySignature = new Map<string, number>();

  return fields.map((field) => {
    const normalizedLabel =
      normalizeText(field.label || field.ariaLabel || field.placeholder || field.key).toLowerCase() ||
      `field-${normalizeText(field.key).toLowerCase()}`;
    const fieldType = toPortalFieldType(field);
    const signatureBase = `${fieldType}::${normalizedLabel}`;
    const occurrenceIndex = (occurrenceBySignature.get(signatureBase) ?? 0) + 1;
    occurrenceBySignature.set(signatureBase, occurrenceIndex);

    return {
      ...field,
      normalizedLabel,
      fieldType,
      occurrenceIndex,
      portalSignature: `${signatureBase}::${occurrenceIndex}`,
    };
  });
};

const toProfileHint = (
  row: typeof portalFieldProfiles.$inferSelect,
): PortalFieldProfileHint => ({
  id: row.id,
  organizationId: row.organizationId,
  portalHost: row.portalHost,
  portalPath: row.portalPath,
  portalUrl: row.portalUrl,
  fieldLabel: row.fieldLabel,
  normalizedLabel: row.normalizedLabel,
  fieldType: row.fieldType as PortalFieldProfileHint["fieldType"],
  tagName: row.tagName,
  inputType: row.inputType,
  occurrenceIndex: row.occurrenceIndex,
  timesSeen: row.timesSeen,
  timesMatched: row.timesMatched,
  lastMappedFieldLabel: row.lastMappedFieldLabel,
  lastFillAction: row.lastFillAction,
  lastConfidence: row.lastConfidence,
});

const emptyLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class PortalSchemaProfileService {
  private readonly logger: LoggerLike;

  constructor(logger?: Partial<LoggerLike>) {
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : emptyLogger.info,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : emptyLogger.warn,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : emptyLogger.error,
    };
  }

  async capture(input: PortalSchemaCaptureInput): Promise<PortalSchemaCaptureResult> {
    const session = await this.resolveSession(input.submissionSessionId);
    const portalUrl = normalizeText(input.portalUrl) || normalizeText(session?.portalUrl);
    if (!portalUrl) {
      throw new Error("Portal schema capture requires a portal URL.");
    }

    const scope = normalizePortalScope(portalUrl);
    const fields = annotatePortalFieldInventory(input.fields);
    const now = new Date().toISOString();
    const organizationId = normalizeText(input.organizationId) || session?.organizationId || null;
    const existingProfiles = await this.loadScopeProfiles(
      scope.portalHost,
      scope.portalPath,
      organizationId,
    );
    const existingBySignature = new Map(
      existingProfiles.map((row) => [
        `${row.fieldType}::${row.normalizedLabel}::${row.occurrenceIndex}`,
        row,
      ]),
    );

    let newProfiles = 0;
    let updatedProfiles = 0;

    for (const field of fields) {
      const existing = existingBySignature.get(field.portalSignature);
      if (existing) {
        await db
          .update(portalFieldProfiles)
          .set({
            portalUrl: scope.portalUrl,
            fieldLabel: field.label,
            tagName: field.tagName,
            inputType: field.type,
            placeholderSample: field.placeholder ?? null,
            ariaLabelSample: field.ariaLabel ?? null,
            timesSeen: existing.timesSeen + 1,
            lastSeenAt: now,
            updatedAt: now,
          })
          .where(eq(portalFieldProfiles.id, existing.id));
        updatedProfiles += 1;
        continue;
      }

      await db.insert(portalFieldProfiles).values({
        id: randomUUID(),
        organizationId,
        portalHost: scope.portalHost,
        portalPath: scope.portalPath,
        portalUrl: scope.portalUrl,
        normalizedLabel: field.normalizedLabel,
        fieldLabel: field.label,
        fieldType: field.fieldType,
        tagName: field.tagName,
        inputType: field.type,
        occurrenceIndex: field.occurrenceIndex,
        placeholderSample: field.placeholder ?? null,
        ariaLabelSample: field.ariaLabel ?? null,
        timesSeen: 1,
        timesMatched: 0,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      newProfiles += 1;
    }

    const snapshotId = randomUUID();
    await db.insert(portalFormSnapshots).values({
      id: snapshotId,
      organizationId,
      submissionSessionId: session?.id ?? input.submissionSessionId ?? null,
      opportunityId: session?.opportunityId ?? null,
      portalUrl: scope.portalUrl,
      portalHost: scope.portalHost,
      portalPath: scope.portalPath,
      fieldCount: fields.length,
      captureSource: normalizeText(input.captureSource) || "Guided Handoff",
      fieldInventory: JSON.stringify(fields),
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "Portal Schema Agent",
      actionDescription: "Captured portal field inventory and refreshed reusable field profiles",
      confidenceLevel: 0.9,
      outputSummary: `Captured ${fields.length} field(s) for ${scope.portalHost}${scope.portalPath} and refreshed ${newProfiles + updatedProfiles} profile record(s).`,
      followUpRequired: false,
    });

    const lookup = await this.getProfileHints(scope.portalUrl, organizationId);
    return {
      snapshotId,
      submissionSessionId: session?.id ?? input.submissionSessionId,
      opportunityId: session?.opportunityId ?? undefined,
      portalUrl: scope.portalUrl,
      portalHost: scope.portalHost,
      portalPath: scope.portalPath,
      fieldCount: fields.length,
      profileSummary: {
        totalProfiles: lookup.profileSummary.totalProfiles,
        newProfiles,
        updatedProfiles,
        matchedProfiles: lookup.profileSummary.matchedProfiles,
        previouslyLearnedMappings: lookup.profileSummary.previouslyLearnedMappings,
      },
      profiles: lookup.profiles,
    };
  }

  async getProfileHints(
    portalUrl: string,
    organizationId?: string | null,
  ): Promise<PortalSchemaProfileLookupResult> {
    const scope = normalizePortalScope(portalUrl);
    const rows = await this.loadScopeProfiles(
      scope.portalHost,
      scope.portalPath,
      normalizeText(organizationId) || null,
    );
    const profiles = rows.map((row) => toProfileHint(row));

    return {
      portalUrl: scope.portalUrl,
      portalHost: scope.portalHost,
      portalPath: scope.portalPath,
      profileSummary: {
        totalProfiles: profiles.length,
        matchedProfiles: profiles.filter((profile) => profile.timesMatched > 0).length,
        previouslyLearnedMappings: profiles.filter((profile) =>
          Boolean(normalizeText(profile.lastMappedFieldLabel)),
        ).length,
      },
      profiles,
    };
  }

  async getProfileHintsForSession(
    submissionSessionId: string,
  ): Promise<PortalSchemaProfileLookupResult> {
    const session = await this.resolveSession(submissionSessionId);
    if (!session) {
      throw new Error("No submission session exists for the provided submissionSessionId.");
    }
    return this.getProfileHints(session.portalUrl, session.organizationId);
  }

  async learnFromMatches(input: PortalMatchLearningInput): Promise<PortalMatchLearningResult> {
    const session = await this.resolveSession(input.submissionSessionId);
    const portalUrl = normalizeText(input.portalUrl) || normalizeText(session?.portalUrl);
    if (!portalUrl) {
      throw new Error("Portal match learning requires a portal URL.");
    }

    const scope = normalizePortalScope(portalUrl);
    const fields = annotatePortalFieldInventory(input.fields);
    const fieldByKey = new Map(fields.map((field) => [field.key, field]));
    const mappingById = new Map(input.mappings.map((mapping) => [mapping.id, mapping]));
    const organizationId = session?.organizationId ?? null;
    const existingProfiles = await this.loadScopeProfiles(
      scope.portalHost,
      scope.portalPath,
      organizationId,
    );
    const existingBySignature = new Map(
      existingProfiles.map((row) => [
        `${row.fieldType}::${row.normalizedLabel}::${row.occurrenceIndex}`,
        row,
      ]),
    );
    const now = new Date().toISOString();
    let updatedProfiles = 0;
    let reusedProfiles = 0;

    for (const match of input.matches) {
      if (!match.portalFieldKey) {
        continue;
      }

      const field = fieldByKey.get(match.portalFieldKey);
      const mapping = mappingById.get(match.mappingId);
      if (!field || !mapping) {
        continue;
      }

      const profile = existingBySignature.get(field.portalSignature);
      if (!profile) {
        continue;
      }

      const wasReusable =
        normalizeText(profile.lastMappedFieldLabel).toLowerCase() ===
        normalizeText(mapping.fieldLabel).toLowerCase();

      await db
        .update(portalFieldProfiles)
        .set({
          portalUrl: scope.portalUrl,
          fieldLabel: field.label,
          tagName: field.tagName,
          inputType: field.type,
          placeholderSample: field.placeholder ?? null,
          ariaLabelSample: field.ariaLabel ?? null,
          timesMatched: profile.timesMatched + 1,
          lastMatchedAt: now,
          lastMappedFieldLabel: mapping.fieldLabel,
          lastFillAction: match.fillAction,
          lastConfidence: match.confidence,
          updatedAt: now,
        })
        .where(eq(portalFieldProfiles.id, profile.id));

      updatedProfiles += 1;
      if (wasReusable) {
        reusedProfiles += 1;
      }
    }

    if (updatedProfiles > 0) {
      await db.insert(agentLogs).values({
        runId: randomUUID(),
        agentName: "Portal Schema Agent",
        actionDescription: "Learned reusable portal field matches from guided handoff",
        confidenceLevel: 0.88,
        outputSummary: `Updated ${updatedProfiles} portal field profile(s) for ${scope.portalHost}${scope.portalPath}.`,
        followUpRequired: false,
      });
    }

    return {
      portalUrl: scope.portalUrl,
      portalHost: scope.portalHost,
      portalPath: scope.portalPath,
      updatedProfiles,
      reusedProfiles,
    };
  }

  private async resolveSession(submissionSessionId?: string) {
    if (!submissionSessionId) {
      return undefined;
    }

    const [session] = await db
      .select()
      .from(submissionSessions)
      .where(eq(submissionSessions.id, submissionSessionId))
      .limit(1);

    if (!session) {
      throw new Error("No submission session exists for the provided submissionSessionId.");
    }

    return session;
  }

  private async loadScopeProfiles(
    portalHost: string,
    portalPath: string,
    organizationId?: string | null,
  ) {
    const normalizedOrganizationId = normalizeText(organizationId) || null;
    return db.select().from(portalFieldProfiles).where(
      and(
        eq(portalFieldProfiles.portalHost, portalHost),
        eq(portalFieldProfiles.portalPath, portalPath),
        normalizedOrganizationId
          ? eq(portalFieldProfiles.organizationId, normalizedOrganizationId)
          : isNull(portalFieldProfiles.organizationId),
      ),
    );
  }
}
