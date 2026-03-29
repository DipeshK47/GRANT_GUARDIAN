type OpportunityIdentityLike = {
  id?: string | null;
  organizationId?: string | null;
  funderId?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  portalUrl?: string | null;
  updatedAt?: string | null;
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const normalizeTitle = (value?: string | null) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/^main street america submission manager\s*-\s*/i, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const isUrlLikeTitle = (value?: string | null) => {
  const normalized = normalizeText(value).toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.includes(".submittable.com/") ||
    normalized.includes("://")
  );
};

export const normalizeOpportunityUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const candidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

  try {
    const url = new URL(candidate);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return normalized.toLowerCase().replace(/\/+$/, "");
  }
};

const sharesUrlIdentity = (
  left: OpportunityIdentityLike,
  right: OpportunityIdentityLike,
) => {
  const leftUrls = [
    normalizeOpportunityUrl(left.sourceUrl),
    normalizeOpportunityUrl(left.portalUrl),
  ].filter(Boolean);
  const rightUrls = new Set(
    [normalizeOpportunityUrl(right.sourceUrl), normalizeOpportunityUrl(right.portalUrl)].filter(
      Boolean,
    ),
  );

  return leftUrls.some((value) => rightUrls.has(value));
};

const sharesTitleIdentity = (
  left: OpportunityIdentityLike,
  right: OpportunityIdentityLike,
) => {
  const leftTitle = normalizeTitle(left.title);
  const rightTitle = normalizeTitle(right.title);

  if (!leftTitle || !rightTitle) {
    return false;
  }

  if (leftTitle === rightTitle) {
    return true;
  }

  const shortestLength = Math.min(leftTitle.length, rightTitle.length);
  if (shortestLength < 24) {
    return false;
  }

  return leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle);
};

export const areLikelySameOpportunity = (
  left: OpportunityIdentityLike,
  right: OpportunityIdentityLike,
) => {
  const leftOrganizationId = normalizeText(left.organizationId);
  const rightOrganizationId = normalizeText(right.organizationId);
  if (leftOrganizationId && rightOrganizationId && leftOrganizationId !== rightOrganizationId) {
    return false;
  }

  if (sharesUrlIdentity(left, right)) {
    return true;
  }

  const leftFunderId = normalizeText(left.funderId);
  const rightFunderId = normalizeText(right.funderId);
  if (leftFunderId && rightFunderId && leftFunderId !== rightFunderId) {
    return false;
  }

  return sharesTitleIdentity(left, right);
};

export const collectRelatedOpportunityRows = <T extends OpportunityIdentityLike>(
  rows: T[],
  target: OpportunityIdentityLike,
) => {
  const related: T[] = [];
  const seen = new Set<string>();
  const queue: OpportunityIdentityLike[] = [target];

  const keyFor = (row: OpportunityIdentityLike, index: number) =>
    row.id ?? `${normalizeText(row.title)}::${normalizeOpportunityUrl(row.sourceUrl)}::${index}`;

  while (queue.length > 0) {
    const seed = queue.shift();
    if (!seed) {
      continue;
    }

    rows.forEach((row, index) => {
      const key = keyFor(row, index);
      if (seen.has(key)) {
        return;
      }

      if (areLikelySameOpportunity(seed, row)) {
        seen.add(key);
        related.push(row);
        queue.push(row);
      }
    });
  }

  return related;
};

const compareTimestampDesc = (left?: string | null, right?: string | null) => {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
};

const canonicalScore = (row: OpportunityIdentityLike) => {
  let score = 0;

  if (!isUrlLikeTitle(row.title)) {
    score += 4;
  }

  if (!normalizeText(row.title).toLowerCase().includes("submission manager")) {
    score += 1;
  }

  if (normalizeOpportunityUrl(row.portalUrl)) {
    score += 2;
  }

  if (normalizeOpportunityUrl(row.sourceUrl)) {
    score += 1;
  }

  return score;
};

export const selectCanonicalOpportunity = <T extends OpportunityIdentityLike>(rows: T[]) =>
  [...rows].sort((left, right) => {
    const scoreDelta = canonicalScore(right) - canonicalScore(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return compareTimestampDesc(left.updatedAt, right.updatedAt);
  })[0];

export const buildOpportunityTitleAliases = (
  rows: OpportunityIdentityLike[],
  fallbackTitle?: string | null,
) => {
  const aliases = new Set<string>();

  if (normalizeText(fallbackTitle)) {
    aliases.add(normalizeText(fallbackTitle));
  }

  for (const row of rows) {
    const title = normalizeText(row.title);
    if (title) {
      aliases.add(title);
    }
  }

  return [...aliases];
};

export const dedupeOpportunities = <T extends OpportunityIdentityLike>(rows: T[]) => {
  const remaining = [...rows];
  const canonicalRows: T[] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (!seed) {
      continue;
    }

    const related = collectRelatedOpportunityRows(remaining, seed);
    const relatedIds = new Set(related.map((row) => row.id).filter(Boolean));
    const group = [seed, ...related];
    const canonical = selectCanonicalOpportunity(group);
    if (canonical) {
      canonicalRows.push(canonical);
    }

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      if (!candidate) {
        continue;
      }

      if (relatedIds.has(candidate.id ?? "")) {
        remaining.splice(index, 1);
      }
    }
  }

  return canonicalRows.sort((left, right) =>
    compareTimestampDesc(left.updatedAt, right.updatedAt),
  );
};
