export type PortalReadiness = {
  normalizedPortalUrl?: string | null;
  preferredBrowserUrl?: string | null;
  submissionMethod?: string | null;
  level: "Ready" | "Needs Review" | "Blocked";
  kind: string;
  likelyLiveOpportunity: boolean;
  blockers: string[];
  warnings: string[];
  recommendedActions: string[];
};

export type OrganizationSummary = {
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
};

export type OpportunityRecord = {
  id: string;
  organizationId?: string | null;
  funderId: string;
  title: string;
  deadline?: string | null;
  status: string;
  submissionMethod?: string | null;
  sourceUrl?: string | null;
  portalUrl?: string | null;
  portalDiscoveredAt?: string | null;
  rationale?: string | null;
  updatedAt: string;
  portalReadiness: PortalReadiness;
};

export type OnboardingStatus = {
  organizationId: string | null;
  organizationName: string | null;
  setupReadinessPercent: number;
  readyForOpportunityIntake: boolean;
  readyForSubmissionAutomation: boolean;
  organizationProfileCompletenessPercent: number;
  counts: {
    programs: number;
    evidence: number;
    readyDocuments: number;
    budgets: number;
    opportunities: number;
    submissionSessions: number;
  };
  notion: {
    configured: boolean;
    authenticated: boolean;
    workspaceName: string | null;
    bootstrapReady: boolean;
  };
  browserSession: {
    storageStatePath: string | null;
    present: boolean;
    requiredForBrowserPortals: boolean;
  };
  essentialDocuments: {
    has501c3: boolean;
    hasBudgetSupport: boolean;
  };
  steps: Array<{
    key: string;
    label: string;
    status: "complete" | "attention" | "optional";
    summary: string;
    recommendedAction?: string;
    command?: string;
    url?: string;
  }>;
  nextRecommendedAction: string;
};

export type FunderDetail = {
  funder: {
    id: string;
    name: string;
    ein?: string | null;
    website?: string | null;
    givingSummary?: string | null;
    averageGrant?: number | null;
    medianGrant?: number | null;
    grantRange?: string | null;
    grantDnaTopPhrases: string[];
    framingStyles: string[];
    toneSummary: string;
    sourceLine: string;
    lastResearchedAt?: string | null;
  };
  drafts: Array<{
    id: string;
    opportunityId: string;
    opportunityTitle: string;
    questionText: string;
    status: string;
    dnaMatchScore: number;
    dnaSuggestions: string[];
  }>;
};

export type NotionSyncStatus = {
  configured: boolean;
  authenticated: boolean;
  workspaceId?: string;
  workspaceName?: string | null;
  bootstrapReady: boolean;
  lastSyncedAt?: string | null;
  lastOperation?: string | null;
  lastTarget?: string | null;
};

export type PortfolioSnapshot = {
  organizationId: string | null;
  generatedAt: string;
  monthlyStaffHours: number;
  weeklyStaffHours: number;
  rankedOpportunities: Array<{
    id: string;
    organizationId?: string | null;
    funderId: string;
    funderName: string;
    title: string;
    status: string;
    deadline?: string | null;
    fitScore: number;
    evidenceCoveragePercent: number;
    effortEstimateHours: number;
    reportingBurdenScore: number;
    deadlineProximityScore: number;
    priorityScore: number;
    classification: "Pursue Now" | "Revisit Later" | "Skip";
    pursueDecision: "Pursue Now" | "Revisit Later" | "Skip";
    recommendedHoursThisWeek: number;
    analysisReady: boolean;
    nextMove: string;
  }>;
  summary: {
    totalActive: number;
    pursueNow: number;
    revisitLater: number;
    skip: number;
    analysisNeeded: number;
  };
  staffingRecommendation: {
    availableHoursThisWeek: number;
    allocatedHoursThisWeek: number;
    remainingHoursThisWeek: number;
    recommendations: Array<{
      opportunityId: string;
      opportunityTitle: string;
      hours: number;
      classification: "Pursue Now" | "Revisit Later" | "Skip";
    }>;
    summary: string;
  };
  notionSync?: {
    pursueThisWeekPageId: string;
  };
};

const appBaseUrl =
  process.env.NEXT_PUBLIC_APP_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:4000";

const normalizeText = (value?: string | string[] | null) =>
  Array.isArray(value) ? (value[0] ?? "").trim() : (value ?? "").trim();

export const normalizeOrganizationId = (value?: string | string[] | null) =>
  normalizeText(value) || null;

const buildServerHeaders = (clerkUserId?: string | null) =>
  clerkUserId
    ? {
        "x-clerk-user-id": clerkUserId,
      }
    : undefined;

export const getOrganizations = async (
  clerkUserId?: string | null,
): Promise<OrganizationSummary[]> => {
  try {
    const response = await fetch(`${appBaseUrl}/organizations`, {
      cache: "no-store",
      headers: buildServerHeaders(clerkUserId),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { organizations?: OrganizationSummary[] };
    return payload.organizations ?? [];
  } catch {
    return [];
  }
};

export const getOpportunities = async (
  clerkUserId?: string | null,
  organizationId?: string | null,
): Promise<OpportunityRecord[]> => {
  try {
    const query = organizationId
      ? `?organizationId=${encodeURIComponent(organizationId)}`
      : "";
    const response = await fetch(`${appBaseUrl}/opportunities${query}`, {
      cache: "no-store",
      headers: buildServerHeaders(clerkUserId),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { opportunities?: OpportunityRecord[] };
    return payload.opportunities ?? [];
  } catch {
    return [];
  }
};

export const getOnboardingStatus = async (
  clerkUserId?: string | null,
  organizationId?: string | null,
): Promise<OnboardingStatus | null> => {
  try {
    const query = organizationId
      ? `?organizationId=${encodeURIComponent(organizationId)}`
      : "";
    const response = await fetch(`${appBaseUrl}/onboarding/status${query}`, {
      cache: "no-store",
      headers: buildServerHeaders(clerkUserId),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as OnboardingStatus;
  } catch {
    return null;
  }
};

export const getPortfolioSnapshot = async (
  clerkUserId: string,
  organizationId?: string | null,
  monthlyStaffHours?: number | null,
): Promise<PortfolioSnapshot | null> => {
  try {
    const query = new URLSearchParams();
    if (organizationId) {
      query.set("organizationId", organizationId);
    }
    if (typeof monthlyStaffHours === "number" && Number.isFinite(monthlyStaffHours)) {
      query.set("monthlyStaffHours", String(monthlyStaffHours));
    }

    const response = await fetch(
      `${appBaseUrl}/portfolio${query.toString() ? `?${query.toString()}` : ""}`,
      {
        cache: "no-store",
        headers: buildServerHeaders(clerkUserId),
      },
    );
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PortfolioSnapshot;
  } catch {
    return null;
  }
};

export const getFunderDetail = async (
  clerkUserId: string,
  funderId: string,
): Promise<FunderDetail | null> => {
  try {
    const response = await fetch(`${appBaseUrl}/funders/${encodeURIComponent(funderId)}`, {
      cache: "no-store",
      headers: buildServerHeaders(clerkUserId),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as FunderDetail;
  } catch {
    return null;
  }
};

export const getNotionSyncStatus = async (
  clerkUserId: string,
): Promise<NotionSyncStatus | null> => {
  try {
    const response = await fetch(`${appBaseUrl}/notion/sync-status`, {
      cache: "no-store",
      headers: buildServerHeaders(clerkUserId),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as NotionSyncStatus;
  } catch {
    return null;
  }
};

export const getOpportunityPageContext = async (
  clerkUserId: string,
  opportunityId: string,
  requestedOrganizationId?: string | null,
) => {
  const [organizations, allOpportunities] = await Promise.all([
    getOrganizations(clerkUserId),
    getOpportunities(clerkUserId),
  ]);

  const opportunity =
    allOpportunities.find((record) => record.id === opportunityId) ?? null;
  const organizationId =
    requestedOrganizationId || opportunity?.organizationId || null;
  const organization =
    organizations.find((record) => record.id === organizationId) ?? null;

  return {
    organizations,
    opportunity,
    organization,
    organizationId,
  };
};
