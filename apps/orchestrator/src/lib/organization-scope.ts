import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";

export const normalizeScopedText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

export const sanitizeScopeSegment = (value?: string | null) => {
  const normalized = normalizeScopedText(value).toLowerCase();
  if (!normalized) {
    return "default";
  }

  const cleaned = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "default";
};

export const resolveOrganizationId = async (
  requestedOrganizationId?: string | null,
  clerkUserId?: string | null,
) => {
  const requested = normalizeScopedText(requestedOrganizationId);
  if (requested) {
    return requested;
  }

  const requestedClerkUserId = normalizeScopedText(clerkUserId);
  if (requestedClerkUserId) {
    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkUserId, requestedClerkUserId))
      .orderBy(asc(organizations.createdAt))
      .limit(1);

    return organization?.id ?? null;
  }

  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);

  return organization?.id ?? null;
};
