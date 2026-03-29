"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

type PortalReadiness = {
  normalizedPortalUrl?: string | null;
  preferredBrowserUrl?: string | null;
  submissionMethod?: string | null;
  level: "Ready" | "Needs Review" | "Blocked";
  kind: string;
  likelyLiveOpportunity: boolean;
  blockers: string[];
  warnings: string[];
  recommendedActions: string[];
  probe?: {
    attempted: boolean;
    reachable: boolean;
    httpStatus?: number;
    finalUrl?: string | null;
    pageTitle?: string | null;
    errorMessage?: string | null;
  };
};

type OnboardingStatus = {
  organizationId: string | null;
  organizationName: string | null;
  setupReadinessPercent: number;
  readyForOpportunityIntake: boolean;
  readyForSubmissionAutomation: boolean;
  counts: {
    programs: number;
    evidence: number;
    readyDocuments: number;
    budgets: number;
    opportunities: number;
    submissionSessions: number;
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

type OpportunityRecord = {
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
  portalReadiness: PortalReadiness;
};

type FunderRecord = {
  id: string;
  name: string;
  ein?: string | null;
  website?: string | null;
  givingSummary?: string | null;
  averageGrant?: number | null;
  medianGrant?: number | null;
  geographicFocus?: string | null;
  updatedAt: string;
};

type OrganizationSummary = {
  id: string;
  legalName: string;
  dbaName?: string | null;
  ein: string;
  mission: string;
  serviceArea?: string | null;
  website?: string | null;
  grantsContact?: string | null;
  profileCompletenessPercent: number;
  createdAt: string;
  updatedAt: string;
};

type DocumentRecord = {
  id: string;
  organizationId?: string | null;
  name: string;
  documentType: string;
  uploadStatus: string;
  fileUrl?: string | null;
  owner?: string | null;
  expirationDate?: string | null;
  updatedAt: string;
};

type ProgramRecord = {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  targetPopulation?: string | null;
  geography?: string | null;
  theoryOfChange?: string | null;
  status?: string | null;
  keyOutcomes?: string | null;
  programBudget?: number | null;
  programLead?: string | null;
  fundingHistory?: string | null;
  updatedAt: string;
};

type EvidenceRecord = {
  id: string;
  programId: string;
  programName: string;
  title: string;
  evidenceType: string;
  content: string;
  sourceDocument?: string | null;
  collectedAt?: string | null;
  reliabilityRating?: number | null;
  tags?: string | null;
  updatedAt: string;
};

type BudgetRecord = {
  id: string;
  programId: string;
  programName: string;
  name: string;
  fiscalYear?: number | null;
  budgetType: string;
  lineItems?: string | null;
  totalRevenue?: number | null;
  totalExpense?: number | null;
  restrictedVsUnrestricted?: string | null;
  updatedAt: string;
};

type IntakeResult = {
  parsed: {
    title: string;
    funderName: string;
    deadline?: string | null;
    submissionMethod?: string | null;
    portalUrl?: string | null;
    requirements: Array<{ questionText: string }>;
  };
  persisted: {
    opportunityId: string;
  };
};

type OrganizationSaveResult = {
  organizationId: string;
  created: boolean;
  profileCompletenessPercent: number;
  organization: OrganizationSummary;
  notionSync?: {
    organizationPageId: string;
  };
};

type OpportunityAnalysisResult = {
  opportunityId: string;
  opportunityTitle: string;
  funderId: string;
  funderName: string;
  scoring: {
    fitScore: number;
    pursueDecision: string;
    evidenceCoveragePercent: number;
    effortEstimateHours: number;
    priorityScore: number;
    deadlineProximityScore: number;
    effortScore: number;
    capacityFlag: string;
    reportingBurdenScore: number;
    componentScores: {
      missionAlignment: number;
      geographyMatch: number;
      programFit: number;
      evidenceCoverage: number;
      deadlineFeasibility: number;
      grantSizeFit: number;
      smallOrgFriendly: number;
      reportingBurden: number;
    };
  };
  coverageBreakdown: {
    green: number;
    amber: number;
    red: number;
  };
  requirementAnalyses: Array<{
    requirementId: string;
    questionText: string;
    requirementType: string;
    coverageStatus: string;
    riskLevel: string;
    linkedSourceIds: string[];
    matchedSources: Array<{
      id: string;
      type: string;
      title: string;
      score: number;
      detail: string;
    }>;
    note: string;
  }>;
  rationale: string;
  notionSync?: {
    opportunityPageId: string;
  };
};

type OpportunityDraftResult = {
  opportunityId: string;
  draftedCount: number;
  preservedCount: number;
  drafts: Array<{
    draftAnswerId?: string;
    requirementId: string;
    questionText: string;
    status: string;
    draftText?: string;
    draftPreview: string;
    wordCount: number;
    dnaMatchScore?: number;
    dnaSuggestions?: string[];
  }>;
  notionSync?: {
    opportunityPageId: string;
    draftPageIds: string[];
  };
};

type DraftAnswerMutationResult = {
  draftAnswerId: string;
  opportunityId: string;
  opportunityTitle: string;
  requirementId: string;
  questionText: string;
  status: string;
  draftText: string;
  wordCount: number;
  evidenceCitations: string[];
  unsupportedClaims: string[];
  dnaMatchScore: number;
  dnaSuggestions: string[];
  notionSync?: {
    opportunityPageId: string;
    draftPageIds: string[];
  };
};

type SubmissionReadiness = {
  readyForSubmission: boolean;
  readyStatus: string;
  stage: string;
  blockerCount: number;
  blockers: string[];
  reviewCoveragePercent: number;
  approvals: {
    requested: number;
    inReview: number;
    changesRequested: number;
    approved: number;
  };
  draftCoverage: {
    totalRequirements: number;
    draftsPresent: number;
    approvedDrafts: number;
    pendingUnsupportedClaims: number;
  };
  taskSummary: {
    open: number;
    blocked: number;
    done: number;
  };
};

type ReviewWorkflowResult = {
  opportunityId: string;
  reviewer: string;
  requestedReviewCount: number;
  preservedReviewCount: number;
  blockingTaskCount: number;
  readiness: SubmissionReadiness;
  notionSync?: {
    reviewPageIds: string[];
    taskPageIds: string[];
    submissionPageId: string;
  };
};

type SubmissionPacketResult = {
  opportunityId: string;
  submissionMethod: string;
  portalUrl?: string | null;
  portalReadiness: PortalReadiness;
  reviewReadiness: SubmissionReadiness;
  completeness: {
    requiredNarratives: number;
    approvedNarrativesIncluded: number;
    requiredAttachments: number;
    approvedAttachmentsIncluded: number;
    missingItems: string[];
  };
  adapterPlan: {
    adapterKey: string;
    readyForHandoff: boolean;
    blockers: string[];
    emailDraft?: {
      to?: string | null;
      subject?: string | null;
      body?: string | null;
    };
  };
  safetyGate: {
    safeToLaunchAutopilot: boolean;
    humanConfirmationRequired: boolean;
    autopilotArmed: boolean;
    blockers: string[];
  };
  notionSync?: {
    submissionPageId: string;
  };
};

type AutopilotLaunchResult = {
  opportunityId: string;
  submissionSessionId: string;
  submissionMethod: string;
  launchMode: string;
  launchStatus: string;
  browserLaunchTriggered: boolean;
  storageStatePresent: boolean;
  launchCommand: string;
  fieldPlan?: {
    totalMappings: number;
    narrativeMappings: number;
    attachmentMappings: number;
    manualReviewCount: number;
    uploadReadyCount: number;
  };
  finalSubmitGate:
    | {
        finalSubmitAuthorized: false;
        requiresSecondConfirmation: true;
        authorizeCommand: string;
      }
    | {
        finalSubmitAuthorized: false;
        requiresSecondConfirmation: false;
        reason: string;
      };
  notionSync?: {
    submissionPageId: string;
  };
};

type ReportingCalendarResult = {
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  cadence: string | null;
  reports: Array<{
    id: string;
    reportName: string;
    dueDate: string;
    reportingPeriod?: string | null;
    status: string;
    owner?: string | null;
    templateLink?: string | null;
    requiredMetrics: string[];
  }>;
  summary: {
    total: number;
    upcoming: number;
    inProgress: number;
    submitted: number;
    overdue: number;
  };
  metricsToTrack: string[];
  reportTemplates: Array<{
    reportId: string;
    reportName: string;
    requirementId: string;
    draftAnswerId: string;
    title: string;
    status: string;
    templateLink?: string | null;
  }>;
  milestoneTasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate?: string | null;
    assignee?: string | null;
  }>;
  notionWorkspaceUrl?: string | null;
  notionSync?: {
    reportingPageIds: string[];
    taskPageIds: string[];
    draftPageIds?: string[];
    reportingWorkspacePageId?: string;
    reportingWorkspacePageUrl?: string;
  };
};

type LessonListResult = {
  funderId: string;
  funderName: string;
  opportunityId?: string | null;
  opportunityTitle?: string | null;
  lessons: Array<{
    id: string;
    opportunityTitle?: string | null;
    feedbackText: string;
    themes: string[];
    recommendations?: string | null;
    appliesNextCycle: boolean;
    rejectionDate: string;
    createdAt: string;
    updatedAt: string;
  }>;
  memorySummary: {
    totalLessons: number;
    reusableLessons: number;
    topThemes: string[];
    recommendationHighlights: string[];
  };
  notionSync?: {
    lessonPageIds: string[];
  };
};

type RecordLessonResult = LessonListResult & {
  lessonId: string;
  opportunityStatus?: string | null;
};

type FunderContrastResult = {
  title: string;
  left: {
    funderId: string;
    funderName: string;
    givingSummary?: string | null;
    averageGrant?: number | null;
    medianGrant?: number | null;
    geographicFocus: string[];
    topCategories: string[];
    visibleGrantRows: number;
  };
  right: {
    funderId: string;
    funderName: string;
    givingSummary?: string | null;
    averageGrant?: number | null;
    medianGrant?: number | null;
    geographicFocus: string[];
    topCategories: string[];
    visibleGrantRows: number;
  };
  primaryDifference: string;
  contrastSummary: string;
  recommendedMove: string;
  contrastSignals: string[];
  notionSync?: {
    contrastPageId: string;
  };
};

type OpportunityWorkbenchResult = {
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  funder: {
    id: string;
    name: string;
    ein?: string | null;
    website?: string | null;
    givingSummary?: string | null;
    averageGrant?: number | null;
    medianGrant?: number | null;
    grantRange?: string | null;
    geographicFocus: string[];
    prioritySignals?: string | null;
    grantDnaTopTerms?: string | null;
    narrativeStyle?: string | null;
    toneNotes?: string | null;
    filingYears: number[];
    parsedFilingCount: number;
    visibleGrantRows: number;
    topGeographies: string[];
    topCategories: string[];
    issueAreaConcentration: string[];
    repeatGranteeBiasPercent: number | null;
    smallOrgFriendlyLabel: string;
    smallOrgFriendlyExplanation: string;
    statedVsActual: {
      stated: string;
      actual: string;
    };
    sourceLine: string;
    grantDnaTopPhrases: string[];
    framingStyles: string[];
    toneSummary: string;
    lastResearchedAt?: string | null;
  };
  analysis: OpportunityAnalysisResult | null;
  drafts: {
    total: number;
    approved: number;
    rows: Array<{
      id: string;
      requirementId: string;
      questionText: string;
      requirementType: string;
      status: string;
      draftText: string;
      wordCount: number;
      evidenceCitations: string[];
      unsupportedClaims: string[];
      dnaMatchScore: number;
      dnaSuggestions: string[];
    }>;
  };
  reviewReadiness: SubmissionReadiness | null;
  lessonsMemory: {
    lessons: Array<{
      id: string;
      opportunityTitle?: string | null;
      feedbackText: string;
      themes: string[];
      recommendations?: string | null;
      appliesNextCycle: boolean;
      rejectionDate: string;
      createdAt: string;
      updatedAt: string;
    }>;
    memorySummary: {
      totalLessons: number;
      reusableLessons: number;
      topThemes: string[];
      recommendationHighlights: string[];
    };
    warningMessage?: string | null;
  };
  submissionHandoff: null | {
    latestSession: {
      submissionSessionId: string;
      launchStatus: string;
      launchMode: string;
      portalUrl: string;
      launchRequestedAt: string;
      launchTriggeredAt?: string | null;
      reviewerName?: string | null;
      finalSubmitAuthorized: boolean;
      waitingForHumanInput: boolean;
    };
    recentLogs: Array<{
      id: string;
      line: string;
      createdAt: string;
      tone: "filled" | "paused" | "info";
    }>;
    checklist: Array<{
      fieldLabel: string;
      state: "filled" | "paused" | "not_reached";
      detail?: string | null;
    }>;
    warning: string;
  };
};

type DashboardProps = {
  initialOrganizations: OrganizationSummary[];
  initialOrganizationId?: string | null;
  initialOpportunityId?: string | null;
  pageMode?: "home" | "opportunity";
};

const WORKSPACE_STORAGE_KEY = "grant-guardian:selected-organization-id";

const shellCardStyle: Record<string, string | number> = {
  border: "1px solid rgba(73, 63, 46, 0.18)",
  borderRadius: 20,
  padding: 24,
  background: "rgba(255,255,255,0.82)",
  boxShadow: "0 20px 50px rgba(58, 43, 25, 0.08)",
  backdropFilter: "blur(8px)",
};

const labelStyle: Record<string, string | number> = {
  display: "block",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b5d46",
  marginBottom: 8,
};

const wrapAnywhereStyle: Record<string, string | number> = {
  minWidth: 0,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const inputStyle: Record<string, string | number> = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(107, 93, 70, 0.22)",
  padding: "12px 14px",
  fontSize: 15,
  background: "#fffdfa",
  color: "#1f2933",
  boxSizing: "border-box",
};

const buttonStyle = (tone: "primary" | "secondary" = "secondary") => ({
  borderRadius: 999,
  border: tone === "primary" ? "1px solid #0f766e" : "1px solid rgba(73, 63, 46, 0.18)",
  background: tone === "primary" ? "#0f766e" : "#fffdf8",
  color: tone === "primary" ? "#f8fffe" : "#2d251a",
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
});

const readinessBadgeStyle = (level: PortalReadiness["level"]) => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  background:
    level === "Ready" ? "#dcfce7" : level === "Needs Review" ? "#ffedd5" : "#fee2e2",
  color: level === "Ready" ? "#14532d" : level === "Needs Review" ? "#9a4d00" : "#991b1b",
});

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const formatTimestamp = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Just now";
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const stripUnsupportedSection = (value?: string | null) =>
  (value ?? "").replace(/\n?\n?UNSUPPORTED:\n[\s\S]*$/i, "").trim();

const normalizeUrlInput = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (/^[a-z]+:\/\//i.test(normalized) || normalized.startsWith("mailto:")) {
    return normalized;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(normalized)) {
    return `https://${normalized}`;
  }

  return normalized;
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolvePromise(reader.result);
        return;
      }

      rejectPromise(new Error("Could not read the selected file."));
    };
    reader.onerror = () => {
      rejectPromise(reader.error ?? new Error("Could not read the selected file."));
    };
    reader.readAsDataURL(file);
  });

const listOrganizations = async () => {
  const response = await fetch("/api/backend/organizations", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load organizations.");
  }

  const payload = await parseJson<{ organizations: OrganizationSummary[] }>(response);
  return payload.organizations;
};

const listOpportunities = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/opportunities?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load opportunities.");
  }

  const payload = await parseJson<{ opportunities: OpportunityRecord[] }>(response);
  return payload.opportunities;
};

const listFunders = async () => {
  const response = await fetch("/api/backend/funders", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load funders.");
  }

  const payload = await parseJson<{ funders: FunderRecord[] }>(response);
  return payload.funders;
};

const listDocuments = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/documents?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load documents.");
  }

  const payload = await parseJson<{ documents: DocumentRecord[] }>(response);
  return payload.documents;
};

const listPrograms = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/programs?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load programs.");
  }

  const payload = await parseJson<{ programs: ProgramRecord[] }>(response);
  return payload.programs;
};

const listEvidence = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/evidence-library?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load evidence.");
  }

  const payload = await parseJson<{ evidence: EvidenceRecord[] }>(response);
  return payload.evidence;
};

const listBudgets = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/budgets?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load budgets.");
  }

  const payload = await parseJson<{ budgets: BudgetRecord[] }>(response);
  return payload.budgets;
};

const loadOnboardingStatus = async (organizationId: string) => {
  const response = await fetch(
    `/api/backend/onboarding/status?organizationId=${encodeURIComponent(organizationId)}`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to load onboarding status.");
  }

  return parseJson<OnboardingStatus>(response);
};

const renderBoolean = (value: boolean) => (value ? "Yes" : "Not yet");

const formatCurrency = (value?: number | null) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "Needs research";

const formatYearRange = (years: number[]) => {
  if (years.length === 0) {
    return "recent years";
  }

  const sorted = [...years].sort((left, right) => left - right);
  return sorted[0] === sorted[sorted.length - 1]
    ? String(sorted[0])
    : `${sorted[0]}-${sorted[sorted.length - 1]}`;
};

const pursueBadgeStyle = (decision: string) => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  background:
    decision === "Pursue Now" ? "#dcfce7" : decision === "Revisit Later" ? "#ffedd5" : "#fee2e2",
  color:
    decision === "Pursue Now" ? "#166534" : decision === "Revisit Later" ? "#9a4d00" : "#991b1b",
});

const coverageDotStyle = (status: string) => ({
  width: 12,
  height: 12,
  borderRadius: 999,
  background: status === "Green" ? "#15803d" : status === "Amber" ? "#d97706" : "#b91c1c",
  flexShrink: 0,
  marginTop: 6,
});

const classifySmallOrgFriendly = (funder: OpportunityWorkbenchResult["funder"]) => {
  const benchmark = funder.medianGrant ?? funder.averageGrant ?? null;
  if (benchmark === null) {
    return {
      label: "Needs research",
      explanation: "Recipient-level grant sizing is still too thin to estimate how friendly this funder is to smaller nonprofits.",
    };
  }

  if (benchmark <= 25000) {
    return {
      label: "High",
      explanation: "Visible grant sizes cluster in a range that usually works for small nonprofit budgets.",
    };
  }

  if (benchmark <= 100000) {
    return {
      label: "Medium",
      explanation: "This funder appears reachable for smaller teams, but the grant size pattern is not clearly tiny-org focused.",
    };
  }

  return {
    label: "Low",
    explanation: "Typical visible grants are large enough that smaller organizations may need a stronger capacity case.",
  };
};

const computePriorityScore = (analysis: OpportunityAnalysisResult) =>
  Math.round(analysis.scoring.priorityScore);

function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 52px", gap: 10, alignItems: "center" }}>
      <div style={{ color: "#5c5140", fontSize: 14 }}>{label}</div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "rgba(45, 122, 107, 0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            height: "100%",
            background: "linear-gradient(90deg, #2d7a6b 0%, #0f766e 100%)",
          }}
        />
      </div>
      <div style={{ color: "#5c5140", fontSize: 13, textAlign: "right" }}>{Math.round(value)}</div>
    </div>
  );
}

const toDecisionLabel = (decision: string) => {
  if (decision === "Pursue Now") {
    return "Pursue";
  }
  if (decision === "Revisit Later") {
    return "Revisit";
  }
  return decision;
};

const summarizeFitRationale = (analysis: OpportunityAnalysisResult) => {
  const strengths: string[] = [];
  if (analysis.scoring.componentScores.missionAlignment >= 70) {
    strengths.push("strong mission alignment");
  }
  if (analysis.scoring.componentScores.geographyMatch >= 70) {
    strengths.push("solid geography match");
  }
  if (analysis.scoring.componentScores.programFit >= 70) {
    strengths.push("program fit");
  }

  const weakestCandidates: Array<[string, number]> = [
    ["evidence coverage", analysis.scoring.componentScores.evidenceCoverage],
    ["deadline feasibility", analysis.scoring.componentScores.deadlineFeasibility],
    ["small-org friendliness", analysis.scoring.componentScores.smallOrgFriendly],
    ["grant size fit", analysis.scoring.componentScores.grantSizeFit],
  ];
  const weakest = weakestCandidates.sort((left, right) => left[1] - right[1])[0];
  const firstStrength = strengths[0];

  if (firstStrength && weakest) {
    return `${firstStrength.charAt(0).toUpperCase()}${firstStrength.slice(1)}. ${weakest[0]} is the main gap right now.`;
  }

  const firstSentence = analysis.rationale.split(".").map((part) => part.trim()).filter(Boolean)[0];
  return firstSentence ? `${firstSentence}.` : analysis.rationale;
};

function FitScoreCard({
  analysis,
}: {
  analysis: OpportunityAnalysisResult;
}) {
  const componentRows = [
    ["Mission alignment", analysis.scoring.componentScores.missionAlignment],
    ["Program fit", analysis.scoring.componentScores.programFit],
    ["Geography match", analysis.scoring.componentScores.geographyMatch],
    ["Evidence coverage", analysis.scoring.componentScores.evidenceCoverage],
    ["Deadline feasibility", analysis.scoring.componentScores.deadlineFeasibility],
    ["Grant size", analysis.scoring.componentScores.grantSizeFit],
    ["Small-org friendliness", analysis.scoring.componentScores.smallOrgFriendly],
    ["Reporting burden", analysis.scoring.componentScores.reportingBurden],
  ] as const;

  return (
    <article style={{ ...shellCardStyle, padding: 20 }}>
      <div style={labelStyle}>Fit Score</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "2.4rem", fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}>
            {analysis.scoring.fitScore} / 100
          </div>
          <div style={{ color: "#5c5140", marginTop: 6 }}>
            Priority score: {computePriorityScore(analysis)}
          </div>
        </div>
        <div style={pursueBadgeStyle(analysis.scoring.pursueDecision)}>
          {toDecisionLabel(analysis.scoring.pursueDecision)}
        </div>
      </div>
      <p style={{ color: "#5c5140", lineHeight: 1.7, margin: "14px 0 18px" }}>
        {summarizeFitRationale(analysis)}
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {componentRows.map(([label, value]) => (
          <ScoreBar key={label} label={label} value={value} />
        ))}
      </div>
    </article>
  );
}

function FunderIntelligenceCard({
  funder,
  onResearch,
  researchPending,
}: {
  funder: OpportunityWorkbenchResult["funder"];
  onResearch: () => void;
  researchPending: boolean;
}) {
  const smallOrgFriendly = {
    label: funder.smallOrgFriendlyLabel || classifySmallOrgFriendly(funder).label,
    explanation:
      funder.smallOrgFriendlyExplanation || classifySmallOrgFriendly(funder).explanation,
  };
  const statedNarrative =
    normalizeText(funder.statedVsActual?.stated) ||
    normalizeText(funder.prioritySignals) ||
    normalizeText(funder.narrativeStyle) ||
    "Website positioning has not been captured yet for this funder.";
  const actualNarrative =
    normalizeText(funder.statedVsActual?.actual) ||
    normalizeText(funder.givingSummary) ||
    "990-backed giving behavior has not been pulled into the workspace yet.";

  return (
    <article style={{ ...shellCardStyle, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={labelStyle}>IRS 990 Intelligence</div>
          <h3
            style={{
              fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "1.55rem",
              margin: "8px 0 4px",
            }}
          >
            {funder.name}
          </h3>
          <p style={{ color: "#5c5140", margin: 0 }}>EIN {funder.ein ?? "Needs research"}</p>
        </div>
        <button style={buttonStyle("secondary")} onClick={onResearch}>
          {researchPending
            ? "Researching..."
            : funder.visibleGrantRows > 0
              ? "Refresh intelligence"
              : "Research and parse filings"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 18,
        }}
      >
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Average grant</div>
          <div style={{ fontSize: "1.2rem" }}>{formatCurrency(funder.averageGrant)}</div>
        </div>
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Median grant</div>
          <div style={{ fontSize: "1.2rem" }}>{formatCurrency(funder.medianGrant)}</div>
        </div>
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Geographic focus</div>
          <div style={{ fontSize: "1rem" }}>
            {(funder.topGeographies.slice(0, 3).join(", ") || funder.geographicFocus.slice(0, 3).join(", ")) ||
              "Needs parsed rows"}
          </div>
        </div>
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Issue areas</div>
          <div style={{ fontSize: "1rem" }}>
            {funder.issueAreaConcentration.slice(0, 3).join(", ") ||
              funder.topCategories.slice(0, 3).join(", ") ||
              "Needs parsed rows"}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, color: "#5c5140", lineHeight: 1.7 }}>
        <strong style={{ color: "#2d251a" }}>Small-org friendliness: {smallOrgFriendly.label}</strong>{" "}
        {smallOrgFriendly.explanation}
      </div>
      <div style={{ marginTop: 8, color: "#5c5140", lineHeight: 1.7 }}>
        <strong style={{ color: "#2d251a" }}>Repeat grantee bias:</strong>{" "}
        {typeof funder.repeatGranteeBiasPercent === "number"
          ? `${funder.repeatGranteeBiasPercent}% of visible grants went to recipients that appear more than once in the parsed grant rows.`
          : "Need parsed recipient-level rows before this can be quantified."}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginTop: 18,
        }}
      >
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Stated</div>
          <p style={{ color: "#5c5140", lineHeight: 1.7, margin: 0 }}>{statedNarrative}</p>
        </div>
        <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 14, background: "#fffdf8" }}>
          <div style={labelStyle}>Actual</div>
          <p style={{ color: "#5c5140", lineHeight: 1.7, margin: 0 }}>{actualNarrative}</p>
        </div>
      </div>

      <p style={{ color: "#6b5d46", margin: "16px 0 0", fontSize: 13 }}>
        {funder.sourceLine || `Based on 990-PF filings from ${formatYearRange(funder.filingYears)} via ProPublica.`}
      </p>
      <p style={{ color: "#6b5d46", margin: "8px 0 0", fontSize: 13 }}>
        990 PDFs and filing parse history live in <strong>Funder Filings</strong>. Your own uploads
        belong in <strong>Documents</strong>.
      </p>
    </article>
  );
}

function GrantDNACard({
  funder,
  drafts,
}: {
  funder: OpportunityWorkbenchResult["funder"];
  drafts: OpportunityWorkbenchResult["drafts"]["rows"];
}) {
  const topPhrases = funder.grantDnaTopPhrases.length
    ? funder.grantDnaTopPhrases
        .map((phrase) =>
          typeof phrase === "string"
            ? phrase.trim()
            : typeof phrase === "object" && phrase && "term" in phrase
              ? String((phrase as { term?: unknown }).term ?? "").trim()
              : String(phrase).trim(),
        )
        .filter(Boolean)
    : normalizeText(funder.grantDnaTopTerms)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  const framingStyles = funder.framingStyles.length
    ? funder.framingStyles
    : normalizeText(funder.narrativeStyle)
        .split("·")
        .map((part) => part.trim())
        .filter(Boolean);
  const toneSummary =
    normalizeText(funder.toneSummary) ||
    normalizeText(funder.toneNotes) ||
    "Grant DNA will get sharper as more funder language is captured from the website, RFP, and filings.";

  return (
    <article style={{ ...shellCardStyle, padding: 20, marginTop: 20 }}>
      <div style={labelStyle}>Grant DNA</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
          gap: 18,
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "1.55rem",
              margin: "8px 0 10px",
            }}
          >
            {funder.name}
          </h3>
          <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
            <strong style={{ color: "#2d251a" }}>Framing style:</strong>{" "}
            {framingStyles.join(" · ") || "Still learning this funder’s framing style"}
          </div>
          <p style={{ color: "#5c5140", lineHeight: 1.7, margin: "12px 0 0" }}>{toneSummary}</p>
          <div style={{ marginTop: 14 }}>
            <Link href={`/funders/${funder.id}`} style={{ ...buttonStyle(), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Open funder page
            </Link>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {topPhrases.length > 0 ? (
              topPhrases.slice(0, 18).map((phrase, index) => (
                <span
                  key={`${phrase}-${index}`}
                  style={{
                    borderRadius: 999,
                    padding: "7px 12px",
                    fontSize: 13,
                    background: "#eef8f6",
                    color: "#0f5d56",
                    border: "1px solid rgba(45, 122, 107, 0.18)",
                  }}
                >
                  {phrase}
                </span>
              ))
            ) : (
              <span style={{ color: "#6b5d46" }}>
                Research this funder to capture their repeated terms and phrases.
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ ...labelStyle, marginBottom: 10 }}>Draft Alignment</div>
          {drafts.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {drafts.slice(0, 4).map((draft) => (
                <div
                  key={draft.id}
                  style={{
                    border: "1px solid rgba(73, 63, 46, 0.14)",
                    borderRadius: 16,
                    padding: 14,
                    background: "#fffdf8",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong style={{ color: "#2d251a", lineHeight: 1.5 }}>
                      {draft.questionText}
                    </strong>
                    <span
                      style={{
                        borderRadius: 999,
                        padding: "6px 10px",
                        background:
                          draft.dnaMatchScore >= 70
                            ? "#dcfce7"
                            : draft.dnaMatchScore >= 40
                              ? "#ffedd5"
                              : "#fee2e2",
                        color:
                          draft.dnaMatchScore >= 70
                            ? "#166534"
                            : draft.dnaMatchScore >= 40
                              ? "#9a4d00"
                              : "#991b1b",
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      DNA match {Math.round(draft.dnaMatchScore)}%
                    </span>
                  </div>
                  <div style={{ color: "#5c5140", marginTop: 10, lineHeight: 1.7 }}>
                    {draft.dnaSuggestions.length > 0 ? (
                      draft.dnaSuggestions.slice(0, 2).map((suggestion) => (
                        <div key={suggestion}>• {suggestion}</div>
                      ))
                    ) : (
                      <div>This answer already reflects the funder’s language reasonably well.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                border: "1px solid rgba(73, 63, 46, 0.14)",
                borderRadius: 16,
                padding: 14,
                background: "#fffdf8",
                color: "#5c5140",
                lineHeight: 1.7,
              }}
            >
              Generate drafts to see answer-level DNA scores and language suggestions here.
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function SubmittableHandoffLog({
  handoff,
}: {
  handoff: NonNullable<OpportunityWorkbenchResult["submissionHandoff"]>;
}) {
  const statusBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    background: handoff.latestSession.waitingForHumanInput ? "#ffedd5" : "#dcfce7",
    color: handoff.latestSession.waitingForHumanInput ? "#9a4d00" : "#166534",
  };

  return (
    <section style={{ ...shellCardStyle, marginTop: 20, padding: 20 }}>
      <div style={labelStyle}>Submittable Handoff</div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "1.7rem",
              margin: "8px 0 4px",
            }}
          >
            {handoff.latestSession.waitingForHumanInput
              ? "Waiting for human input"
              : handoff.latestSession.launchStatus}
          </h3>
          <p style={{ color: "#5c5140", lineHeight: 1.7, margin: 0 }}>
            {handoff.latestSession.launchMode} · Session {handoff.latestSession.submissionSessionId}
          </p>
        </div>
        <span style={statusBadgeStyle}>
          {handoff.latestSession.waitingForHumanInput ? "Waiting for human input" : "Active handoff"}
        </span>
      </div>

      <div
        style={{
          marginTop: 16,
          borderRadius: 16,
          border: "1px solid rgba(185, 28, 28, 0.14)",
          background: "#fef2f2",
          padding: 14,
          color: "#991b1b",
          lineHeight: 1.7,
        }}
      >
        <strong>Guardrail:</strong> {handoff.warning}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 18,
          marginTop: 18,
        }}
      >
        <div>
          <div style={labelStyle}>Recent browser actions</div>
          <div style={{ display: "grid", gap: 10 }}>
            {handoff.recentLogs.length > 0 ? (
              handoff.recentLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(73, 63, 46, 0.12)",
                    background: "#fffdf8",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      color:
                        log.tone === "filled"
                          ? "#166534"
                          : log.tone === "paused"
                            ? "#9a4d00"
                            : "#5c5140",
                      lineHeight: 1.7,
                    }}
                  >
                    {log.line}
                  </div>
                  <div style={{ color: "#8a7b63", fontSize: 12, marginTop: 6 }}>
                    {formatTimestamp(log.createdAt)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
                Launch the browser handoff to see what Grant Guardian filled and where it paused.
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Field checklist</div>
          <div style={{ display: "grid", gap: 10 }}>
            {handoff.checklist.length > 0 ? (
              handoff.checklist.map((item) => {
                const badgeStyle = {
                  borderRadius: 999,
                  padding: "5px 9px",
                  fontSize: 12,
                  background:
                    item.state === "filled"
                      ? "#dcfce7"
                      : item.state === "paused"
                        ? "#ffedd5"
                        : "#f3f4f6",
                  color:
                    item.state === "filled"
                      ? "#166534"
                      : item.state === "paused"
                        ? "#9a4d00"
                        : "#6b7280",
                };

                return (
                  <div
                    key={`${item.fieldLabel}-${item.state}`}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(73, 63, 46, 0.12)",
                      background: "#fffdf8",
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <strong style={{ color: "#2d251a", lineHeight: 1.5 }}>{item.fieldLabel}</strong>
                      <span style={badgeStyle}>
                        {item.state === "filled"
                          ? "Filled"
                          : item.state === "paused"
                            ? "Paused"
                            : "Not reached"}
                      </span>
                    </div>
                    {normalizeText(item.detail) ? (
                      <div style={{ color: "#5c5140", lineHeight: 1.6, marginTop: 8 }}>
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
                The checklist will appear after the latest session maps and touches portal fields.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReportingWorkspaceCard({
  reporting,
  opportunityId,
}: {
  reporting: ReportingCalendarResult;
  opportunityId: string;
}) {
  const notionWorkspaceUrl =
    reporting.notionSync?.reportingWorkspacePageUrl ?? reporting.notionWorkspaceUrl ?? null;

  return (
    <section
      style={{
        ...shellCardStyle,
        marginTop: 18,
        border: "1px solid rgba(22, 101, 52, 0.18)",
        background: "#f0fdf4",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={labelStyle}>Reporting workspace</div>
          <h3
            style={{
              fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "1.8rem",
              margin: "8px 0 4px",
            }}
          >
            Awarded
          </h3>
          <p style={{ color: "#166534", lineHeight: 1.7, margin: 0 }}>
            The grant is in post-award mode now. Track deadlines, promised metrics, and seeded
            report drafts from here.
          </p>
        </div>
        <span
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            padding: "7px 12px",
            background: "#dcfce7",
            color: "#166534",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Awarded
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 18,
          marginTop: 18,
        }}
      >
        <div>
          <div style={labelStyle}>Reporting timeline</div>
          <div style={{ display: "grid", gap: 10 }}>
            {reporting.reports.map((report) => (
              <div
                key={report.id}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(22, 101, 52, 0.12)",
                  background: "#ffffff",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <strong style={{ color: "#1f2933" }}>{report.reportName}</strong>
                  <span style={{ color: "#166534", fontSize: 13 }}>{report.status}</span>
                </div>
                <div style={{ color: "#4b5563", marginTop: 6, lineHeight: 1.6 }}>
                  Due {report.dueDate}
                  {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <div style={labelStyle}>Promised metrics to track</div>
            <div style={{ display: "grid", gap: 8 }}>
              {(reporting.metricsToTrack.length > 0 ? reporting.metricsToTrack : ["No promised metrics extracted yet."])
                .map((metric) => (
                  <div
                    key={metric}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(22, 101, 52, 0.12)",
                      background: "#ffffff",
                      padding: 10,
                      color: "#1f2933",
                    }}
                  >
                    {metric}
                  </div>
                ))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>Draft report templates</div>
            <div style={{ display: "grid", gap: 8 }}>
              {reporting.reportTemplates.length > 0 ? (
                reporting.reportTemplates.map((template) => (
                  <div
                    key={template.draftAnswerId}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(22, 101, 52, 0.12)",
                      background: "#ffffff",
                      padding: 10,
                    }}
                  >
                    <div style={{ color: "#1f2933", fontWeight: 600 }}>{template.reportName}</div>
                    <div style={{ color: "#6b5d46", fontSize: 13, marginTop: 4 }}>
                      {template.status}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                      <Link
                        href={`/opportunities/${opportunityId}/reporting`}
                        style={{ color: "#0f766e", textDecoration: "none", fontWeight: 600 }}
                      >
                        Open reporting page
                      </Link>
                      {template.templateLink ? (
                        <a
                          href={template.templateLink}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#0f766e", textDecoration: "none", fontWeight: 600 }}
                        >
                          Open template
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
                  Reporting templates will appear after the reporting workspace is activated.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href={`/opportunities/${opportunityId}/reporting`}
              style={{
                ...buttonStyle("primary"),
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Open reporting page
            </Link>
            {notionWorkspaceUrl ? (
              <a
                href={notionWorkspaceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  ...buttonStyle(),
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                View in Notion
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function DraftAnswersPanel({
  drafts,
  selectedOrganizationId,
  recentEvidence,
  recentDocuments,
  recentPrograms,
  recentBudgets,
  editingDraftId,
  draftEditorValue,
  onStartEdit,
  onCancelEdit,
  onEditorChange,
  onSaveEdit,
  onApprove,
  pendingKey,
}: {
  drafts: OpportunityWorkbenchResult["drafts"]["rows"];
  selectedOrganizationId?: string | null;
  recentEvidence: EvidenceRecord[];
  recentDocuments: DocumentRecord[];
  recentPrograms: ProgramRecord[];
  recentBudgets: BudgetRecord[];
  editingDraftId: string | null;
  draftEditorValue: string;
  onStartEdit: (draftId: string, draftText: string) => void;
  onCancelEdit: () => void;
  onEditorChange: (value: string) => void;
  onSaveEdit: (draftId: string) => void;
  onApprove: (draftId: string) => void;
  pendingKey: string | null;
}) {
  const dashboardBase = selectedOrganizationId
    ? `/dashboard?organizationId=${encodeURIComponent(selectedOrganizationId)}`
    : "/dashboard";
  const resolveCitationHref = (citation: string) => {
    const normalized = normalizeText(citation).toLowerCase();
    if (!normalized) {
      return dashboardBase;
    }
    if (recentDocuments.some((item) => normalizeText(item.name).toLowerCase() === normalized)) {
      return `${dashboardBase}#document-vault`;
    }
    if (
      recentEvidence.some((item) => normalizeText(item.title).toLowerCase() === normalized) ||
      recentPrograms.some((item) => normalizeText(item.name).toLowerCase() === normalized) ||
      recentBudgets.some((item) => normalizeText(item.name).toLowerCase() === normalized)
    ) {
      return `${dashboardBase}#program-context`;
    }
    return dashboardBase;
  };

  return (
    <section style={{ ...shellCardStyle, marginTop: 20, padding: 20 }}>
      <div style={labelStyle}>Draft Answers</div>
      <h3
        style={{
          fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
          fontSize: "1.7rem",
          margin: "8px 0 10px",
        }}
      >
        Grounded answers with evidence references
      </h3>
      <p style={{ color: "#5c5140", lineHeight: 1.7, marginTop: 0 }}>
        Each answer stays tied to the workspace evidence Grant Guardian found. Unsupported claims
        stay flagged until new proof is added or the answer is revised.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        {drafts.length === 0 ? (
          <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
            Generate drafts to review grounded answers, evidence references, and DNA alignment
            here.
          </div>
        ) : null}

        {drafts.map((draft) => {
          const isEditing = editingDraftId === draft.id;
          const hasUnsupported = draft.unsupportedClaims.length > 0;

          return (
            <article
              key={draft.id}
              style={{
                border: "1px solid rgba(73, 63, 46, 0.14)",
                borderRadius: 18,
                padding: 16,
                background: "#fffdf8",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong style={{ color: "#2d251a", lineHeight: 1.5 }}>{draft.questionText}</strong>
                  <div style={{ color: "#6b5d46", marginTop: 8 }}>
                    {draft.requirementType} · {draft.status}
                  </div>
                </div>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "6px 10px",
                    background:
                      draft.dnaMatchScore >= 70
                        ? "#dcfce7"
                        : draft.dnaMatchScore >= 40
                          ? "#ffedd5"
                          : "#fee2e2",
                    color:
                      draft.dnaMatchScore >= 70
                        ? "#166534"
                        : draft.dnaMatchScore >= 40
                          ? "#9a4d00"
                          : "#991b1b",
                    fontSize: 12,
                    alignSelf: "flex-start",
                  }}
                >
                  DNA match {Math.round(draft.dnaMatchScore)}%
                </span>
              </div>

              <div style={{ marginTop: 14 }}>
                {isEditing ? (
                  <textarea
                    style={{ ...inputStyle, minHeight: 170, resize: "vertical" }}
                    value={draftEditorValue}
                    onChange={(event) => onEditorChange(event.target.value)}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid rgba(73, 63, 46, 0.12)",
                      borderRadius: 14,
                      padding: 14,
                      background: "#ffffff",
                      color: "#2d251a",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.7,
                    }}
                  >
                    {stripUnsupportedSection(draft.draftText)}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={labelStyle}>Evidence references</div>
                {draft.evidenceCitations.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {draft.evidenceCitations.map((citation) => (
                      <Link
                        key={`${draft.id}-${citation}`}
                        href={resolveCitationHref(citation)}
                        style={{
                          borderRadius: 999,
                          padding: "7px 12px",
                          fontSize: 13,
                          background: "#eef8f6",
                          color: "#0f5d56",
                          border: "1px solid rgba(45, 122, 107, 0.18)",
                          textDecoration: "none",
                        }}
                      >
                        {citation}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#6b5d46" }}>No evidence references are linked yet.</div>
                )}
              </div>

              {draft.dnaSuggestions.length > 0 ? (
                <div style={{ marginTop: 14, color: "#5c5140", lineHeight: 1.7 }}>
                  <div style={labelStyle}>DNA suggestions</div>
                  {draft.dnaSuggestions.slice(0, 2).map((suggestion) => (
                    <div key={suggestion}>• {suggestion}</div>
                  ))}
                </div>
              ) : null}

              {hasUnsupported ? (
                <div
                  style={{
                    marginTop: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(185, 28, 28, 0.18)",
                    background: "#fef2f2",
                    color: "#991b1b",
                    padding: 14,
                    lineHeight: 1.7,
                  }}
                >
                  <strong>UNSUPPORTED</strong>
                  {draft.unsupportedClaims.map((claim) => (
                    <div key={claim}>• {claim}</div>
                  ))}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                {isEditing ? (
                  <>
                    <button
                      style={buttonStyle("primary")}
                      onClick={() => onSaveEdit(draft.id)}
                      disabled={pendingKey !== null}
                    >
                      {pendingKey === `save-draft:${draft.id}` ? "Saving..." : "Save edit"}
                    </button>
                    <button style={buttonStyle()} onClick={onCancelEdit} disabled={pendingKey !== null}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    style={buttonStyle()}
                    onClick={() => onStartEdit(draft.id, draft.draftText)}
                    disabled={pendingKey !== null}
                  >
                    Edit
                  </button>
                )}
                <button
                  style={buttonStyle("primary")}
                  onClick={() => onApprove(draft.id)}
                  disabled={pendingKey !== null || hasUnsupported}
                >
                  {pendingKey === `approve-draft:${draft.id}` ? "Approving..." : "Approve"}
                </button>
                {hasUnsupported ? (
                  <span style={{ color: "#991b1b", alignSelf: "center" }}>
                    Resolve unsupported sections before approval.
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceCoveragePanel({
  analysis,
}: {
  analysis: OpportunityAnalysisResult;
}) {
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const totalQuestions = analysis.requirementAnalyses.length;
  const coveredQuestions =
    analysis.coverageBreakdown.green + analysis.coverageBreakdown.amber;

  return (
    <section style={{ ...shellCardStyle, marginTop: 20, padding: 20 }}>
      <div style={labelStyle}>Evidence Coverage</div>
      <h3
        style={{
          fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
          fontSize: "1.7rem",
          margin: "8px 0 10px",
        }}
      >
        {coveredQuestions} of {totalQuestions} questions covered by evidence
      </h3>
      <div
        style={{
          height: 12,
          borderRadius: 999,
          background: "rgba(45, 122, 107, 0.12)",
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: `${analysis.scoring.evidenceCoveragePercent}%`,
            height: "100%",
            background: "linear-gradient(90deg, #2d7a6b 0%, #0f766e 100%)",
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {analysis.requirementAnalyses.map((requirement) => (
          <article
            key={requirement.requirementId}
            style={{
              border: "1px solid rgba(73, 63, 46, 0.14)",
              borderRadius: 16,
              padding: 14,
              background: "#fffdf8",
              display: "grid",
              gridTemplateColumns: "16px 1fr",
              gap: 12,
            }}
          >
            <div style={coverageDotStyle(requirement.coverageStatus)} />
            <div>
              <div style={{ color: "#2d251a", fontWeight: 600 }}>{requirement.questionText}</div>
              <p style={{ color: "#5c5140", lineHeight: 1.7, margin: "8px 0 0" }}>
                {requirement.coverageStatus === "Green"
                  ? "Covered by the evidence items below."
                  : requirement.coverageStatus === "Amber"
                    ? `Partial evidence exists and still needs support. ${requirement.note}`
                    : "No evidence found — task created to fill this gap."}
              </p>
              {requirement.matchedSources.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 10,
                  }}
                >
                  {requirement.matchedSources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() =>
                        setExpandedRequirementId((current) =>
                          current === `${requirement.requirementId}:${source.id}`
                            ? null
                            : `${requirement.requirementId}:${source.id}`,
                        )
                      }
                      style={{
                        borderRadius: 999,
                        border: "1px solid rgba(45, 122, 107, 0.18)",
                        background: "#ffffff",
                        color: "#0f766e",
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                      title={source.detail}
                    >
                      {source.title}
                    </button>
                  ))}
                </div>
              ) : null}
              {requirement.matchedSources.map((source) => {
                const isExpanded =
                  expandedRequirementId === `${requirement.requirementId}:${source.id}`;
                if (!isExpanded) {
                  return null;
                }

                return (
                  <div
                    key={`${source.id}-detail`}
                    style={{
                      marginTop: 10,
                      borderRadius: 14,
                      border: "1px solid rgba(73, 63, 46, 0.14)",
                      background: "#ffffff",
                      padding: 12,
                      color: "#5c5140",
                      lineHeight: 1.6,
                    }}
                  >
                    <strong style={{ color: "#2d251a" }}>{source.title}</strong> · {source.type} ·{" "}
                    {Math.round(source.score * 100)}% match
                    <div style={{ marginTop: 6 }}>{source.detail}</div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={labelStyle}>Missing evidence</div>
        {analysis.requirementAnalyses.filter((item) => item.coverageStatus !== "Green").length > 0 ? (
          <ul style={{ color: "#5c5140", lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
            {analysis.requirementAnalyses
              .filter((item) => item.coverageStatus !== "Green")
              .map((item) => (
                <li key={item.requirementId}>
                  <strong>{item.questionText}</strong>:{" "}
                  {item.coverageStatus === "Amber"
                    ? "Partial evidence exists, but the answer still needs more support. A follow-up task was created to strengthen this response."
                    : "No evidence found yet. A task was created to fill this gap."}
                </li>
              ))}
          </ul>
        ) : (
          <p style={{ color: "#14532d", margin: 0 }}>
            Every current question has at least partial evidence coverage.
          </p>
        )}
      </div>
    </section>
  );
}

export function HomeClient({
  initialOrganizations,
  initialOrganizationId = null,
  initialOpportunityId = null,
  pageMode = "home",
}: DashboardProps) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>(initialOrganizations);
  const [funders, setFunders] = useState<FunderRecord[]>([]);
  const [workspacePickerId, setWorkspacePickerId] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [hasResolvedSelection, setHasResolvedSelection] = useState(false);
  const [workspacePending, setWorkspacePending] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceRecord[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetRecord[]>([]);
  const [intakeUrl, setIntakeUrl] = useState("");
  const [intakeText, setIntakeText] = useState("");
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [portalInputs, setPortalInputs] = useState<Record<string, string>>({});
  const [methodInputs, setMethodInputs] = useState<Record<string, string>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [createLegalName, setCreateLegalName] = useState("");
  const [createEin, setCreateEin] = useState("");
  const [createMission, setCreateMission] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [documentNameInput, setDocumentNameInput] = useState("");
  const [documentTypeInput, setDocumentTypeInput] = useState("501(c)(3)");
  const [documentOwnerInput, setDocumentOwnerInput] = useState("");
  const [documentExpirationInput, setDocumentExpirationInput] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentPending, setDocumentPending] = useState(false);
  const [documentMessage, setDocumentMessage] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [programNameInput, setProgramNameInput] = useState("");
  const [programTargetPopulationInput, setProgramTargetPopulationInput] = useState("");
  const [programGeographyInput, setProgramGeographyInput] = useState("");
  const [programOutcomesInput, setProgramOutcomesInput] = useState("");
  const [programBudgetInput, setProgramBudgetInput] = useState("");
  const [programLeadInput, setProgramLeadInput] = useState("");
  const [programPending, setProgramPending] = useState(false);
  const [programMessage, setProgramMessage] = useState<string | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [evidenceProgramIdInput, setEvidenceProgramIdInput] = useState("");
  const [evidenceTitleInput, setEvidenceTitleInput] = useState("");
  const [evidenceTypeInput, setEvidenceTypeInput] = useState("Metric");
  const [evidenceSummaryInput, setEvidenceSummaryInput] = useState("");
  const [evidenceSourceDocumentInput, setEvidenceSourceDocumentInput] = useState("");
  const [evidenceCollectedAtInput, setEvidenceCollectedAtInput] = useState("");
  const [evidenceQualityInput, setEvidenceQualityInput] = useState("85");
  const [evidenceTagsInput, setEvidenceTagsInput] = useState("");
  const [evidencePending, setEvidencePending] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [budgetProgramIdInput, setBudgetProgramIdInput] = useState("");
  const [budgetNameInput, setBudgetNameInput] = useState("");
  const [budgetFiscalYearInput, setBudgetFiscalYearInput] = useState("");
  const [budgetTypeInput, setBudgetTypeInput] = useState("Program");
  const [budgetRevenueInput, setBudgetRevenueInput] = useState("");
  const [budgetExpenseInput, setBudgetExpenseInput] = useState("");
  const [budgetNotesInput, setBudgetNotesInput] = useState("");
  const [budgetPending, setBudgetPending] = useState(false);
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [workflowPendingKey, setWorkflowPendingKey] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftEditorValue, setDraftEditorValue] = useState("");
  const [workbenchResults, setWorkbenchResults] = useState<
    Record<string, OpportunityWorkbenchResult>
  >({});
  const [analysisResults, setAnalysisResults] = useState<Record<string, OpportunityAnalysisResult>>(
    {},
  );
  const [draftResults, setDraftResults] = useState<Record<string, OpportunityDraftResult>>({});
  const [reviewReadinessSnapshots, setReviewReadinessSnapshots] = useState<
    Record<string, SubmissionReadiness>
  >({});
  const [reviewResults, setReviewResults] = useState<Record<string, ReviewWorkflowResult>>({});
  const [submissionResults, setSubmissionResults] = useState<
    Record<string, SubmissionPacketResult>
  >({});
  const [autopilotResults, setAutopilotResults] = useState<Record<string, AutopilotLaunchResult>>(
    {},
  );
  const [reportingResults, setReportingResults] = useState<
    Record<string, ReportingCalendarResult>
  >({});
  const [lessonResults, setLessonResults] = useState<Record<string, LessonListResult>>({});
  const [selectedLeftFunderId, setSelectedLeftFunderId] = useState("");
  const [selectedRightFunderId, setSelectedRightFunderId] = useState("");
  const [contrastResult, setContrastResult] = useState<FunderContrastResult | null>(null);
  const [contrastPending, setContrastPending] = useState(false);
  const [contrastError, setContrastError] = useState<string | null>(null);
  const [contrastMessage, setContrastMessage] = useState<string | null>(null);
  const [reviewerNameInput, setReviewerNameInput] = useState("");
  const [reviewDueDateInput, setReviewDueDateInput] = useState("");
  const [launchReviewerNotes, setLaunchReviewerNotes] = useState("");
  const [reportingOwnerInput, setReportingOwnerInput] = useState("");
  const [reportingCadenceInput, setReportingCadenceInput] = useState("Quarterly + Final");
  const [lessonFeedbackInput, setLessonFeedbackInput] = useState("");
  const [showRejectionComposer, setShowRejectionComposer] = useState(false);
  const workspaceSelectRef = useRef<HTMLSelectElement | null>(null);

  const selectedOrganization = useMemo(
    () =>
      organizations.find((organization) => organization.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId],
  );

  const sortedOpportunities = useMemo(
    () =>
      [...opportunities].sort((left, right) => {
        const leftScore =
          left.portalReadiness.level === "Blocked"
            ? 2
            : left.portalReadiness.level === "Needs Review"
              ? 1
              : 0;
        const rightScore =
          right.portalReadiness.level === "Blocked"
            ? 2
            : right.portalReadiness.level === "Needs Review"
              ? 1
              : 0;
        return rightScore - leftScore;
      }),
    [opportunities],
  );

  const selectedOpportunity = useMemo(
    () => opportunities.find((opportunity) => opportunity.id === selectedOpportunityId) ?? null,
    [opportunities, selectedOpportunityId],
  );

  const recentDocuments = useMemo(
    () =>
      [...documents].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.updatedAt || "") || 0;
        return rightTime - leftTime;
      }),
    [documents],
  );

  const recentPrograms = useMemo(
    () =>
      [...programs].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.updatedAt || "") || 0;
        return rightTime - leftTime;
      }),
    [programs],
  );

  const recentEvidence = useMemo(
    () =>
      [...evidenceItems].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.updatedAt || "") || 0;
        return rightTime - leftTime;
      }),
    [evidenceItems],
  );

  const recentBudgets = useMemo(
    () =>
      [...budgetItems].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.updatedAt || "") || 0;
        return rightTime - leftTime;
      }),
    [budgetItems],
  );

  const selectedWorkbench = useMemo(
    () =>
      selectedOpportunityId ? workbenchResults[selectedOpportunityId] ?? null : null,
    [selectedOpportunityId, workbenchResults],
  );

  const selectedLessonsMemory = useMemo(
    () =>
      selectedOpportunity
        ? lessonResults[selectedOpportunity.id]
          ? {
              lessons: lessonResults[selectedOpportunity.id]!.lessons,
              memorySummary: lessonResults[selectedOpportunity.id]!.memorySummary,
              warningMessage: selectedWorkbench?.lessonsMemory.warningMessage ?? null,
            }
          : selectedWorkbench?.lessonsMemory ?? null
        : null,
    [lessonResults, selectedOpportunity, selectedWorkbench],
  );

  const selectedAnalysis = useMemo(
    () =>
      selectedOpportunity
        ? analysisResults[selectedOpportunity.id] ?? selectedWorkbench?.analysis ?? null
        : null,
    [analysisResults, selectedOpportunity, selectedWorkbench],
  );

  const selectedReviewReadiness = useMemo(
    () =>
      selectedOpportunity
        ? reviewReadinessSnapshots[selectedOpportunity.id] ?? selectedWorkbench?.reviewReadiness ?? null
        : null,
    [reviewReadinessSnapshots, selectedOpportunity, selectedWorkbench],
  );

  const selectedReporting = useMemo(
    () =>
      selectedOpportunity
        ? reportingResults[selectedOpportunity.id] ?? null
        : null,
    [reportingResults, selectedOpportunity],
  );

  const isOpportunityMode = pageMode === "opportunity";

  const visiblePortalOpportunities = useMemo(() => {
    if (!isOpportunityMode || !selectedOpportunityId) {
      return sortedOpportunities;
    }

    return sortedOpportunities.filter((opportunity) => opportunity.id === selectedOpportunityId);
  }, [isOpportunityMode, selectedOpportunityId, sortedOpportunities]);

  const selectedOrganizationHref = selectedOrganizationId
    ? `/opportunities?organizationId=${encodeURIComponent(selectedOrganizationId)}`
    : "/opportunities";

  const buildOpportunityHref = (opportunity: OpportunityRecord) => {
    const organizationQuery = opportunity.organizationId
      ? `?organizationId=${encodeURIComponent(opportunity.organizationId)}`
      : "";
    return `/opportunities/${opportunity.id}${organizationQuery}`;
  };

  useEffect(() => {
    if (hasResolvedSelection) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const requestedOrganizationId = normalizeText(query.get("organizationId"));
    const storedOrganizationId = normalizeText(window.localStorage.getItem(WORKSPACE_STORAGE_KEY));
    const preferredOrganizationId =
      requestedOrganizationId ||
      normalizeText(initialOrganizationId) ||
      storedOrganizationId;

    if (
      preferredOrganizationId &&
      organizations.some((organization) => organization.id === preferredOrganizationId)
    ) {
      setWorkspacePickerId(preferredOrganizationId);
      setSelectedOrganizationId(preferredOrganizationId);
    }

    setHasResolvedSelection(true);
  }, [hasResolvedSelection, initialOrganizationId, organizations]);

  useEffect(() => {
    setPortalInputs((current) => {
      const next = { ...current };
      for (const opportunity of opportunities) {
        next[opportunity.id] = current[opportunity.id] ?? opportunity.portalUrl ?? "";
      }
      return next;
    });

    setMethodInputs((current) => {
      const next = { ...current };
      for (const opportunity of opportunities) {
        next[opportunity.id] =
          current[opportunity.id] ?? opportunity.submissionMethod ?? "Submittable";
      }
      return next;
    });
  }, [opportunities]);

  useEffect(() => {
    if (!hasResolvedSelection) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    if (selectedOrganizationId) {
      query.set("organizationId", selectedOrganizationId);
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, selectedOrganizationId);
    } else {
      query.delete("organizationId");
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }

    const nextUrl = query.toString()
      ? `${window.location.pathname}?${query.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [hasResolvedSelection, selectedOrganizationId]);

  useEffect(() => {
    if (!hasResolvedSelection) {
      return;
    }

    if (!selectedOrganizationId) {
      setOnboarding(null);
      setOpportunities([]);
      setDocuments([]);
      setPrograms([]);
      setEvidenceItems([]);
      setBudgetItems([]);
      setWorkspacePending(false);
      return;
    }

    let cancelled = false;
    setWorkspacePending(true);

    Promise.all([
      loadOnboardingStatus(selectedOrganizationId),
      listOpportunities(selectedOrganizationId),
      listDocuments(selectedOrganizationId),
      listPrograms(selectedOrganizationId),
      listEvidence(selectedOrganizationId),
      listBudgets(selectedOrganizationId),
      listFunders(),
    ])
      .then(
        ([
          nextOnboarding,
          nextOpportunities,
          nextDocuments,
          nextPrograms,
          nextEvidence,
          nextBudgets,
          nextFunders,
        ]) => {
        if (cancelled) {
          return;
        }

        setOnboarding(nextOnboarding);
        setOpportunities(nextOpportunities);
        setDocuments(nextDocuments);
        setPrograms(nextPrograms);
        setEvidenceItems(nextEvidence);
        setBudgetItems(nextBudgets);
        setFunders(nextFunders);
        },
      )
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setWorkspaceMessage(
          error instanceof Error ? error.message : "Failed to load the selected workspace.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspacePending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasResolvedSelection, selectedOrganizationId]);

  const refreshOrganizations = async () => {
    const nextOrganizations = await listOrganizations();
    setOrganizations(nextOrganizations);
    return nextOrganizations;
  };

  const refreshDashboard = async () => {
    if (!selectedOrganizationId) {
      return;
    }

    const [
      nextOnboarding,
      nextOpportunities,
      nextDocuments,
      nextPrograms,
      nextEvidence,
      nextBudgets,
      nextOrganizations,
      nextFunders,
    ] = await Promise.all([
      loadOnboardingStatus(selectedOrganizationId),
      listOpportunities(selectedOrganizationId),
      listDocuments(selectedOrganizationId),
      listPrograms(selectedOrganizationId),
      listEvidence(selectedOrganizationId),
      listBudgets(selectedOrganizationId),
      refreshOrganizations(),
      listFunders(),
    ]);
    setOrganizations(nextOrganizations);
    setOnboarding(nextOnboarding);
    setOpportunities(nextOpportunities);
    setDocuments(nextDocuments);
    setPrograms(nextPrograms);
    setEvidenceItems(nextEvidence);
    setBudgetItems(nextBudgets);
    setFunders(nextFunders);
  };

  useEffect(() => {
    if (opportunities.length === 0) {
      setSelectedOpportunityId(null);
      setEditingDraftId(null);
      setDraftEditorValue("");
      return;
    }

    const preferredOpportunityId = normalizeText(initialOpportunityId);
    if (
      preferredOpportunityId &&
      opportunities.some((opportunity) => opportunity.id === preferredOpportunityId)
    ) {
      if (selectedOpportunityId !== preferredOpportunityId) {
        setSelectedOpportunityId(preferredOpportunityId);
      }
      return;
    }

    if (
      selectedOpportunityId &&
      opportunities.some((opportunity) => opportunity.id === selectedOpportunityId)
    ) {
      return;
    }

    setSelectedOpportunityId(opportunities[0]?.id ?? null);
  }, [initialOpportunityId, opportunities, selectedOpportunityId]);

  useEffect(() => {
    setEditingDraftId(null);
    setDraftEditorValue("");
    setShowRejectionComposer(false);
    setLessonFeedbackInput("");
  }, [selectedOpportunityId]);

  useEffect(() => {
    const defaultOwner =
      normalizeText(selectedOrganization?.grantsContact) ||
      normalizeText(selectedOrganization?.legalName) ||
      "";
    if (!reviewerNameInput && defaultOwner) {
      setReviewerNameInput(defaultOwner);
    }
    if (!reportingOwnerInput && defaultOwner) {
      setReportingOwnerInput(defaultOwner);
    }
    if (!documentOwnerInput && defaultOwner) {
      setDocumentOwnerInput(defaultOwner);
    }
  }, [selectedOrganization, reviewerNameInput, reportingOwnerInput, documentOwnerInput]);

  useEffect(() => {
    if (programs.length === 0) {
      setEvidenceProgramIdInput("");
      setBudgetProgramIdInput("");
      return;
    }

    if (!evidenceProgramIdInput || !programs.some((program) => program.id === evidenceProgramIdInput)) {
      setEvidenceProgramIdInput(programs[0]!.id);
    }

    if (!budgetProgramIdInput || !programs.some((program) => program.id === budgetProgramIdInput)) {
      setBudgetProgramIdInput(programs[0]!.id);
    }
  }, [budgetProgramIdInput, evidenceProgramIdInput, programs]);

  useEffect(() => {
    if (!selectedOpportunity?.funderId || funders.length === 0) {
      return;
    }

    if (!selectedLeftFunderId) {
      setSelectedLeftFunderId(selectedOpportunity.funderId);
    }

    if (!selectedRightFunderId) {
      const alternative =
        funders.find((funder) => funder.id !== selectedOpportunity.funderId)?.id ?? "";
      if (alternative) {
        setSelectedRightFunderId(alternative);
      }
    }
  }, [selectedOpportunity, funders, selectedLeftFunderId, selectedRightFunderId]);

  const openWorkspace = (explicitOrganizationId?: string | null) => {
    const nextOrganizationId =
      normalizeText(explicitOrganizationId) ||
      normalizeText(workspaceSelectRef.current?.value) ||
      normalizeText(workspacePickerId) ||
      null;
    setWorkspaceMessage(null);
    setSelectedOrganizationId(nextOrganizationId);
    setWorkspacePickerId(nextOrganizationId ?? "");
  };

  const handleCreateOrganization = async () => {
    setCreatePending(true);
    setCreateError(null);
    setWorkspaceMessage(null);

    try {
      const response = await fetch("/api/backend/organizations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          legalName: normalizeText(createLegalName),
          ein: normalizeText(createEin),
          mission: normalizeText(createMission),
          syncToNotion: true,
        }),
      });
      const payload = await parseJson<{ message?: string } & Partial<OrganizationSaveResult>>(
        response,
      );
      if (!response.ok || !payload.organizationId || !payload.organization) {
        throw new Error(payload.message ?? "Failed to create the workspace.");
      }

      const nextOrganizations = await refreshOrganizations();
      setOrganizations(nextOrganizations);
      setWorkspacePickerId(payload.organizationId);
      setSelectedOrganizationId(payload.organizationId);
      setCreateLegalName("");
      setCreateEin("");
      setCreateMission("");
      setWorkspaceMessage(
        `Workspace ready: ${payload.organization.legalName}. You can start intake once the rest of onboarding is filled in.${syncSuffix(payload)}`,
      );
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create the workspace.");
    } finally {
      setCreatePending(false);
    }
  };

  const handleProgramSave = async () => {
    if (!selectedOrganizationId) {
      return;
    }

    setProgramPending(true);
    setProgramError(null);
    setProgramMessage(null);

    try {
      const response = await fetch("/api/backend/programs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          name: normalizeText(programNameInput),
          targetPopulation: normalizeText(programTargetPopulationInput) || undefined,
          geography: normalizeText(programGeographyInput) || undefined,
          keyOutcomes: normalizeText(programOutcomesInput) || undefined,
          programBudget: normalizeText(programBudgetInput)
            ? Number(programBudgetInput)
            : undefined,
          programLead: normalizeText(programLeadInput) || undefined,
          status: "High",
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{
        message?: string;
        program?: ProgramRecord;
        notionSync?: {
          programPageId: string;
        };
      }>(response);
      if (!response.ok || !payload.program) {
        throw new Error(payload.message ?? "Failed to save the program.");
      }

      setProgramNameInput("");
      setProgramTargetPopulationInput("");
      setProgramGeographyInput("");
      setProgramOutcomesInput("");
      setProgramBudgetInput("");
      setProgramLeadInput("");
      await refreshDashboard();
      setProgramMessage(
        `Saved program ${payload.program.name}. Rerun analysis after adding enough context.${syncSuffix(payload)}`,
      );
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : "Failed to save the program.");
    } finally {
      setProgramPending(false);
    }
  };

  const handleEvidenceSave = async () => {
    if (!selectedOrganizationId) {
      return;
    }

    setEvidencePending(true);
    setEvidenceError(null);
    setEvidenceMessage(null);

    try {
      const response = await fetch("/api/backend/evidence-library", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          programId: evidenceProgramIdInput,
          title: normalizeText(evidenceTitleInput),
          evidenceType: evidenceTypeInput,
          content: normalizeText(evidenceSummaryInput),
          sourceDocument: normalizeText(evidenceSourceDocumentInput) || undefined,
          collectedAt: normalizeText(evidenceCollectedAtInput) || undefined,
          reliabilityRating: normalizeText(evidenceQualityInput)
            ? Number(evidenceQualityInput) / 100
            : undefined,
          tags: normalizeText(evidenceTagsInput) || undefined,
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{
        message?: string;
        evidence?: EvidenceRecord;
        notionSync?: {
          evidencePageId: string;
        };
      }>(response);
      if (!response.ok || !payload.evidence) {
        throw new Error(payload.message ?? "Failed to save the evidence record.");
      }

      setEvidenceTitleInput("");
      setEvidenceSummaryInput("");
      setEvidenceSourceDocumentInput("");
      setEvidenceCollectedAtInput("");
      setEvidenceQualityInput("85");
      setEvidenceTagsInput("");
      await refreshDashboard();
      setEvidenceMessage(
        `Saved evidence item ${payload.evidence.title}. Rerun analysis and drafting to use it.${syncSuffix(payload)}`,
      );
    } catch (error) {
      setEvidenceError(
        error instanceof Error ? error.message : "Failed to save the evidence record.",
      );
    } finally {
      setEvidencePending(false);
    }
  };

  const handleBudgetSave = async () => {
    if (!selectedOrganizationId) {
      return;
    }

    setBudgetPending(true);
    setBudgetError(null);
    setBudgetMessage(null);

    try {
      const response = await fetch("/api/backend/budgets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          programId: budgetProgramIdInput,
          name: normalizeText(budgetNameInput),
          fiscalYear: normalizeText(budgetFiscalYearInput)
            ? Number(budgetFiscalYearInput)
            : undefined,
          budgetType: budgetTypeInput,
          totalRevenue: normalizeText(budgetRevenueInput)
            ? Number(budgetRevenueInput)
            : undefined,
          totalExpense: normalizeText(budgetExpenseInput)
            ? Number(budgetExpenseInput)
            : undefined,
          lineItems: normalizeText(budgetNotesInput) || undefined,
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{
        message?: string;
        budget?: BudgetRecord;
        notionSync?: {
          budgetPageId: string;
        };
      }>(response);
      if (!response.ok || !payload.budget) {
        throw new Error(payload.message ?? "Failed to save the budget.");
      }

      setBudgetNameInput("");
      setBudgetFiscalYearInput("");
      setBudgetRevenueInput("");
      setBudgetExpenseInput("");
      setBudgetNotesInput("");
      await refreshDashboard();
      setBudgetMessage(
        `Saved budget ${payload.budget.name}. Budget-linked requirements can now use it.${syncSuffix(payload)}`,
      );
    } catch (error) {
      setBudgetError(error instanceof Error ? error.message : "Failed to save the budget.");
    } finally {
      setBudgetPending(false);
    }
  };

  const handleDocumentUpload = async () => {
    if (!selectedOrganizationId || !documentFile) {
      return;
    }

    setDocumentPending(true);
    setDocumentError(null);
    setDocumentMessage(null);

    try {
      const contentBase64 = await readFileAsDataUrl(documentFile);
      const response = await fetch("/api/backend/documents/upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          name: normalizeText(documentNameInput) || documentFile.name,
          documentType: normalizeText(documentTypeInput) || "Other",
          fileName: documentFile.name,
          contentBase64,
          mimeType: documentFile.type || undefined,
          owner: normalizeText(documentOwnerInput) || undefined,
          expirationDate: normalizeText(documentExpirationInput) || undefined,
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{
        message?: string;
        name?: string;
        notionSync?: {
          documentPageId: string;
        };
      }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to upload the document.");
      }

      setDocumentNameInput("");
      setDocumentTypeInput("501(c)(3)");
      setDocumentExpirationInput("");
      setDocumentFile(null);
      await refreshDashboard();
      if (selectedOpportunityId) {
        await loadWorkbench(selectedOpportunityId);
      }
      setDocumentMessage(
        `Uploaded ${payload.name ?? documentFile.name} to this workspace.${syncSuffix(payload)}`,
      );
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : "Failed to upload the document.",
      );
    } finally {
      setDocumentPending(false);
    }
  };

  const handleIntake = async () => {
    if (!selectedOrganizationId) {
      setIntakeError("Choose or create a workspace before intake.");
      return;
    }

    setFormPending(true);
    setIntakeError(null);
    setIntakeStatus(null);

    try {
      const normalizedIntakeUrl = normalizeUrlInput(intakeUrl);
      const response = await fetch("/api/backend/intake/opportunity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          url: normalizedIntakeUrl || undefined,
          rawText: normalizeText(intakeText) || undefined,
          syncToNotion: true,
        }),
      });

      if (!response.ok) {
        const payload = await parseJson<{ message?: string }>(response);
        throw new Error(payload.message ?? "Opportunity intake failed.");
      }

      const payload = await parseJson<IntakeResult>(response);
      setIntakeStatus(
        `Created '${payload.parsed.title}' with ${payload.parsed.requirements.length} requirement(s). Synced to Notion.`,
      );
      setIntakeUrl("");
      setIntakeText("");
      await refreshDashboard();
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : "Opportunity intake failed.");
    } finally {
      setFormPending(false);
    }
  };

  const runRowAction = (opportunityId: string, action: () => Promise<string>) => {
    setRowMessages((current) => ({ ...current, [opportunityId]: "" }));
    setRowErrors((current) => ({ ...current, [opportunityId]: "" }));

    startTransition(() => {
      action()
        .then(async (message) => {
          setRowMessages((current) => ({ ...current, [opportunityId]: message }));
          await refreshDashboard();
        })
        .catch((error) => {
          setRowErrors((current) => ({
            ...current,
            [opportunityId]:
              error instanceof Error ? error.message : "Something went wrong for this opportunity.",
          }));
        });
    });
  };

  const updatePortal = (opportunityId: string) =>
    runRowAction(opportunityId, async () => {
      const normalizedPortalUrl = normalizeUrlInput(portalInputs[opportunityId]);
      setPortalInputs((current) => ({
        ...current,
        [opportunityId]: normalizedPortalUrl,
      }));

      const response = await fetch(`/api/backend/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          portalUrl: normalizedPortalUrl,
          submissionMethod: methodInputs[opportunityId],
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{
        message?: string;
        portalUrl?: string | null;
        portalReadiness?: PortalReadiness;
      }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save portal confirmation.");
      }

      if (payload.portalUrl) {
        setPortalInputs((current) => ({
          ...current,
          [opportunityId]: payload.portalUrl ?? normalizedPortalUrl,
        }));
      }

      return `Saved portal URL. Current readiness: ${payload.portalReadiness?.level ?? "Updated"}.${syncSuffix(payload)}`;
    });

  const rediscoverPortal = (opportunityId: string) =>
    runRowAction(opportunityId, async () => {
      const response = await fetch(`/api/backend/opportunities/${opportunityId}/discover-portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          syncToNotion: true,
        }),
      });
      const payload = await parseJson<{
        message?: string;
        discoveredPortalUrl?: string | null;
        notes?: string[];
      }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Portal rediscovery failed.");
      }

      if (payload.discoveredPortalUrl) {
        setPortalInputs((current) => ({
          ...current,
          [opportunityId]: payload.discoveredPortalUrl ?? "",
        }));
      }

      return payload.discoveredPortalUrl
        ? `Rediscovered portal: ${payload.discoveredPortalUrl}${syncSuffix(payload)}`
        : payload.notes?.[0] ?? "No confident portal was rediscovered.";
    });

  const probePortal = (opportunityId: string) =>
    runRowAction(opportunityId, async () => {
      const response = await fetch(
        `/api/backend/opportunities/${opportunityId}/portal-readiness?probe=true`,
        {
          cache: "no-store",
        },
      );
      const payload = await parseJson<{
        message?: string;
        portalReadiness?: PortalReadiness;
      }>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Portal readiness probe failed.");
      }

      const probe = payload.portalReadiness?.probe;
      if (probe?.attempted) {
        return probe.reachable
          ? `Live probe succeeded with HTTP ${probe.httpStatus ?? "?"}.`
          : `Live probe could not reach the portal${probe.httpStatus ? ` (HTTP ${probe.httpStatus})` : ""}.`;
      }

      return `Portal readiness is ${payload.portalReadiness?.level ?? "unknown"}.`;
    });

  const syncSuffix = (payload: unknown) => {
    if (
      payload &&
      typeof payload === "object" &&
      "notionSync" in payload &&
      (payload as { notionSync?: unknown }).notionSync
    ) {
      return " Synced to Notion.";
    }

    return "";
  };

  const loadReviewReadiness = async (opportunityId: string) => {
    const response = await fetch(`/api/backend/opportunities/${opportunityId}/review-readiness`, {
      cache: "no-store",
    });
    const payload = await parseJson<{ message?: string } & SubmissionReadiness>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load review readiness.");
    }

    setReviewReadinessSnapshots((current) => ({
      ...current,
      [opportunityId]: payload,
    }));
  };

  const loadWorkbench = async (opportunityId: string) => {
    const response = await fetch(`/api/backend/opportunities/${opportunityId}/workbench`, {
      cache: "no-store",
    });
    const payload = await parseJson<{ message?: string } & OpportunityWorkbenchResult>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load the opportunity workbench.");
    }

    setWorkbenchResults((current) => ({
      ...current,
      [opportunityId]: payload,
    }));
  };

  const loadReportingCalendar = async (opportunityId: string) => {
    if (!selectedOrganizationId) {
      return;
    }

    const response = await fetch(
      `/api/backend/opportunities/${opportunityId}/reporting-calendar?organizationId=${encodeURIComponent(selectedOrganizationId)}`,
      {
        cache: "no-store",
      },
    );
    const payload = await parseJson<{ message?: string } & ReportingCalendarResult>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load reporting calendar.");
    }

    setReportingResults((current) => ({
      ...current,
      [opportunityId]: payload,
    }));
  };

  const loadLessons = async (opportunityId: string) => {
    if (!selectedOrganizationId) {
      return;
    }

    const response = await fetch(
      `/api/backend/opportunities/${opportunityId}/lessons?organizationId=${encodeURIComponent(selectedOrganizationId)}`,
      {
        cache: "no-store",
      },
    );
    const payload = await parseJson<{ message?: string } & LessonListResult>(response);
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load lessons.");
    }

    setLessonResults((current) => ({
      ...current,
      [opportunityId]: payload,
    }));
  };

  useEffect(() => {
    if (!selectedOpportunityId || !selectedOrganizationId) {
      return;
    }

    void Promise.all([
      loadWorkbench(selectedOpportunityId),
      loadReviewReadiness(selectedOpportunityId),
      loadReportingCalendar(selectedOpportunityId),
      loadLessons(selectedOpportunityId),
    ]).catch(() => undefined);
  }, [selectedOpportunityId, selectedOrganizationId]);

  useEffect(() => {
    if (!selectedOpportunityId || !selectedWorkbench?.submissionHandoff?.latestSession) {
      return;
    }

    const status = normalizeText(selectedWorkbench.submissionHandoff.latestSession.launchStatus);
    const shouldPoll =
      status === "Browser Launch Triggered" ||
      status === "Guided Fill In Progress" ||
      status === "Waiting for Human Input";

    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadWorkbench(selectedOpportunityId).catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [selectedOpportunityId, selectedWorkbench?.submissionHandoff?.latestSession?.launchStatus, selectedWorkbench?.submissionHandoff?.latestSession?.submissionSessionId]);

  const runOpportunityWorkflow = async (
    pendingKey: string,
    action: () => Promise<string>,
  ) => {
    setWorkflowPendingKey(pendingKey);
    setWorkflowError(null);
    setWorkflowMessage(null);

    try {
      const message = await action();
      setWorkflowMessage(message);
      await refreshDashboard();
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Workflow action failed.");
    } finally {
      setWorkflowPendingKey(null);
    }
  };

  const runFunderResearch = async () => {
    if (!selectedOpportunity) {
      return;
    }

    await runOpportunityWorkflow("funder-research", async () => {
      const enrichResponse = await fetch(
        `/api/backend/funders/${selectedOpportunity.funderId}/enrich`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            syncToNotion: true,
          }),
        },
      );

      const enrichPayload = await parseJson<{
        message?: string;
        resolvedOrganization?: {
          name: string;
        };
        metrics?: {
          privateFoundationFilings: number;
        };
        filings?: Array<{
          filingType?: string | null;
        }>;
        notionSync?: unknown;
      }>(enrichResponse);
      if (!enrichResponse.ok) {
        throw new Error(enrichPayload.message ?? "Funder research failed.");
      }

      const parseResponse = await fetch(
        `/api/backend/funders/${selectedOpportunity.funderId}/parse-filings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            limit: 3,
            force: true,
            syncToNotion: true,
          }),
        },
      );

      const parsePayload = await parseJson<{
        aggregate?: {
          extractedGrantRows: number;
          parsedFilingCount: number;
        };
        message?: string;
      }>(parseResponse);

      const parseSummary = parseResponse.ok
        ? ` Parsed ${parsePayload.aggregate?.extractedGrantRows ?? 0} visible grant row(s) across ${parsePayload.aggregate?.parsedFilingCount ?? 0} filing(s).`
        : " Filing parsing could not finish yet, so some 990 metrics may still be limited.";

      await refreshDashboard();
      await loadWorkbench(selectedOpportunity.id);

      const filingLabel =
        [...new Set((enrichPayload.filings ?? []).map((filing) => filing.filingType).filter(Boolean))].join("/") ||
        "ProPublica";
      return `Researched ${enrichPayload.resolvedOrganization?.name ?? selectedOpportunity.title} across ${enrichPayload.metrics?.privateFoundationFilings ?? 0} ${filingLabel} filing(s).${parseSummary}${syncSuffix(enrichPayload)}`;
    });
  };

  const runAnalysis = async () => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow("analysis", async () => {
      const response = await fetch(`/api/backend/opportunities/${selectedOpportunityId}/analyze`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{ message?: string } & OpportunityAnalysisResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Opportunity analysis failed.");
      }

      setAnalysisResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      await loadWorkbench(selectedOpportunityId);

      return `Analyzed ${payload.opportunityTitle} at ${payload.scoring.fitScore}% fit with ${payload.scoring.evidenceCoveragePercent}% evidence coverage.${syncSuffix(payload)}`;
    });
  };

  const runDrafting = async () => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow("drafting", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/draft-answers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            syncToNotion: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & OpportunityDraftResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Draft generation failed.");
      }

      setDraftResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      await loadWorkbench(selectedOpportunityId);

      return `Draft workflow prepared ${payload.draftedCount} new draft(s) and preserved ${payload.preservedCount}.${syncSuffix(payload)}`;
    });
  };

  const saveDraftEdit = async (draftId: string) => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow(`save-draft:${draftId}`, async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/draft-answers/${draftId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            draftText: draftEditorValue,
            syncToNotion: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & DraftAnswerMutationResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save the draft edit.");
      }

      setEditingDraftId(null);
      setDraftEditorValue("");
      await loadWorkbench(selectedOpportunityId);

      return `Saved "${payload.questionText}" for review.${syncSuffix(payload)}`;
    });
  };

  const approveDraftAnswer = async (draftId: string) => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow(`approve-draft:${draftId}`, async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/draft-answers/${draftId}/approve`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            syncToNotion: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & DraftAnswerMutationResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to approve the draft answer.");
      }

      await loadWorkbench(selectedOpportunityId);
      return `Approved "${payload.questionText}".${syncSuffix(payload)}`;
    });
  };

  const runReviewWorkflow = async () => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow("review", async () => {
      const response = await fetch(`/api/backend/opportunities/${selectedOpportunityId}/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reviewer: normalizeText(reviewerNameInput) || undefined,
          dueDate: normalizeText(reviewDueDateInput) || undefined,
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{ message?: string } & ReviewWorkflowResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Review workflow failed.");
      }

      setReviewResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      setReviewReadinessSnapshots((current) => ({
        ...current,
        [selectedOpportunityId]: payload.readiness,
      }));
      await loadWorkbench(selectedOpportunityId);

      return `Review queue prepared with ${payload.requestedReviewCount} requested review(s).${syncSuffix(payload)}`;
    });
  };

  const runSubmissionAssembly = async () => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow("submission", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/assemble-submission`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            syncToNotion: true,
            confirmAutopilot: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & SubmissionPacketResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Submission assembly failed.");
      }

      setSubmissionResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));

      return `Submission packet prepared with ${payload.completeness.approvedNarrativesIncluded}/${payload.completeness.requiredNarratives} narratives and ${payload.completeness.approvedAttachmentsIncluded}/${payload.completeness.requiredAttachments} attachments.${syncSuffix(payload)}`;
    });
  };

  const launchAutopilot = async (launchBrowser: boolean) => {
    if (!selectedOpportunityId) {
      return;
    }

    await runOpportunityWorkflow(launchBrowser ? "launch-browser" : "launch-handoff", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/launch-autopilot`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirmLaunch: true,
            launchBrowser,
            reviewerName: normalizeText(reviewerNameInput) || undefined,
            reviewerNotes: normalizeText(launchReviewerNotes) || undefined,
            syncToNotion: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & AutopilotLaunchResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Submission handoff failed.");
      }

      setAutopilotResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      await loadWorkbench(selectedOpportunityId);

      return `${payload.launchMode} prepared for session ${payload.submissionSessionId}.${syncSuffix(payload)}`;
    });
  };

  const activateReporting = async () => {
    if (!selectedOpportunityId || !selectedOrganizationId) {
      return;
    }

    await runOpportunityWorkflow("reporting", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${selectedOpportunityId}/activate-reporting`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId: selectedOrganizationId,
            owner: normalizeText(reportingOwnerInput) || undefined,
            cadence: reportingCadenceInput,
            syncToNotion: true,
          }),
        },
      );

      const payload = await parseJson<{ message?: string } & ReportingCalendarResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to activate reporting.");
      }

      setReportingResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      setOpportunities((current) =>
        current.map((opportunity) =>
          opportunity.id === selectedOpportunityId
            ? {
                ...opportunity,
                status: "Awarded",
              }
            : opportunity,
        ),
      );
      await loadWorkbench(selectedOpportunityId);

      return `Reporting calendar activated with ${payload.summary.total} report milestone(s).${syncSuffix(payload)}`;
    });
  };

  const recordLesson = async () => {
    if (!selectedOpportunityId || !selectedOrganizationId) {
      return;
    }

    await runOpportunityWorkflow("lesson", async () => {
      const response = await fetch(`/api/backend/opportunities/${selectedOpportunityId}/lessons`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          feedbackText: normalizeText(lessonFeedbackInput),
          markOpportunityRejected: selectedOpportunity?.status !== "Rejected",
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{ message?: string } & RecordLessonResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to record lesson.");
      }

      setLessonResults((current) => ({
        ...current,
        [selectedOpportunityId]: payload,
      }));
      setOpportunities((current) =>
        current.map((opportunity) =>
          opportunity.id === selectedOpportunityId && payload.opportunityStatus
            ? {
                ...opportunity,
                status: payload.opportunityStatus,
              }
            : opportunity,
        ),
      );
      setLessonFeedbackInput("");
      setShowRejectionComposer(false);
      await refreshDashboard();
      await loadWorkbench(selectedOpportunityId);

      return `Recorded a reusable lesson with ${payload.memorySummary.topThemes.length} top theme(s).${syncSuffix(payload)}`;
    });
  };

  const runContrast = async () => {
    if (!selectedLeftFunderId || !selectedRightFunderId) {
      setContrastError("Choose two funders to compare.");
      return;
    }

    setContrastPending(true);
    setContrastError(null);
    setContrastMessage(null);

    try {
      const response = await fetch("/api/backend/funders/contrast", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leftFunderId: selectedLeftFunderId,
          rightFunderId: selectedRightFunderId,
          syncToNotion: true,
        }),
      });

      const payload = await parseJson<{ message?: string } & FunderContrastResult>(response);
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to compare funders.");
      }

      setContrastResult(payload);
      setContrastMessage(`Prepared a 990 contrast for ${payload.title}.${syncSuffix(payload)}`);
    } catch (error) {
      setContrastError(error instanceof Error ? error.message : "Failed to compare funders.");
    } finally {
      setContrastPending(false);
    }
  };

  return (
    <>
      <section
        style={{
          ...shellCardStyle,
          marginBottom: 24,
          padding: 18,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ color: "#5e5241", lineHeight: 1.6 }}>
          {isOpportunityMode
            ? "Opportunity detail view: work one grant from portal confirmation through lessons without losing the larger workspace context."
            : "Dashboard view: switch workspaces, finish onboarding, intake new opportunities, and move into dedicated grant routes when the team is ready."}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/" style={buttonStyle()}>
            Workspace home
          </Link>
          <Link href={selectedOrganizationHref} style={buttonStyle()}>
            Opportunity library
          </Link>
          {isOpportunityMode && selectedOpportunity ? (
            <Link href={buildOpportunityHref(selectedOpportunity)} style={buttonStyle("primary")}>
              Refresh this opportunity route
            </Link>
          ) : null}
        </div>
      </section>

      <section style={shellCardStyle}>
        <p
          style={{
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#916b22",
            fontSize: 12,
            margin: 0,
          }}
        >
          Workspace
        </p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: "12px 0 10px",
          }}
        >
          Open the right workspace, understand what matters next, and move with confidence
        </h2>
        <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
          This section is the local operating base for the nonprofit behind the grants. Choose the
          workspace that owns the next opportunity, complete the core setup, and use the guided
          steps below to move into intake, review, submission, reporting, and lessons.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginTop: 20,
          }}
        >
          <div>
            <label style={labelStyle}>Current workspace</label>
            <select
              style={inputStyle}
              ref={workspaceSelectRef}
              autoComplete="off"
              value={workspacePickerId}
              onChange={(event) => {
                setWorkspaceMessage(null);
                setWorkspacePickerId(event.target.value);
              }}
            >
              <option value="">Choose a workspace</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.dbaName || organization.legalName}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              ...inputStyle,
              minHeight: 48,
              display: "flex",
              alignItems: "center",
              color: "#5e5241",
            }}
            >
            {selectedOrganization
              ? `${selectedOrganization.legalName} • ${selectedOrganization.profileCompletenessPercent}% profile complete`
              : workspacePickerId
                ? "Workspace selected in the picker. Click Open workspace to load its data."
              : organizations.length > 0
                ? "Pick an existing workspace or create a new one below."
                : "No workspace exists yet. Create the first one below."}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          <button
            style={buttonStyle("primary")}
            onClick={() => openWorkspace()}
            disabled={!workspacePickerId}
          >
            Open workspace
          </button>
          <button
            style={buttonStyle()}
            onClick={() => {
              setWorkspaceMessage(null);
              setWorkspacePickerId("");
              setSelectedOrganizationId(null);
            }}
          >
            Clear selection
          </button>
        </div>

        {organizations.length > 0 && !selectedOrganizationId ? (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 16,
              background: "#fff8ef",
              border: "1px solid rgba(145, 107, 34, 0.16)",
              color: "#5e5241",
              lineHeight: 1.7,
            }}
          >
            Existing workspaces were found on this local machine, but none will be auto-opened.
            That keeps a first-time user from landing inside old demo data by accident.
          </div>
        ) : null}

        <div
          style={{
            marginTop: 20,
            paddingTop: 20,
            borderTop: "1px solid rgba(73, 63, 46, 0.12)",
          }}
        >
          <p style={{ ...labelStyle, marginBottom: 14 }}>Create a new workspace</p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <div>
              <label style={labelStyle}>Organization name</label>
              <input
                style={inputStyle}
                value={createLegalName}
                onChange={(event) => setCreateLegalName(event.target.value)}
                placeholder="Bright Path Youth Collective"
              />
            </div>
            <div>
              <label style={labelStyle}>EIN</label>
              <input
                style={inputStyle}
                value={createEin}
                onChange={(event) => setCreateEin(event.target.value)}
                placeholder="12-3456789"
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Mission</label>
              <textarea
                style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
                value={createMission}
                onChange={(event) => setCreateMission(event.target.value)}
                placeholder="What your nonprofit does and who it serves."
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button
              style={buttonStyle("primary")}
              onClick={handleCreateOrganization}
              disabled={
                createPending ||
                !normalizeText(createLegalName) ||
                !normalizeText(createEin) ||
                !normalizeText(createMission)
              }
            >
              {createPending ? "Creating workspace..." : "Create workspace"}
            </button>
            {workspaceMessage ? <span style={{ color: "#14532d" }}>{workspaceMessage}</span> : null}
            {createError ? <span style={{ color: "#991b1b" }}>{createError}</span> : null}
          </div>
        </div>
      </section>

      {!isOpportunityMode ? (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginTop: 24,
          }}
        >
          <article style={shellCardStyle}>
            <div style={labelStyle}>Setup Readiness</div>
            <div style={{ fontSize: "2.6rem", marginTop: 8 }}>
              {selectedOrganizationId && onboarding ? `${onboarding.setupReadinessPercent}%` : "Pick one"}
            </div>
            <p style={{ marginBottom: 0, color: "#5c5140" }}>
              {selectedOrganizationId
                ? onboarding?.organizationName ?? "Loading workspace..."
                : "Choose the workspace that will own the next 40 opportunities."}
            </p>
          </article>
          <article style={shellCardStyle}>
            <div style={labelStyle}>Intake Ready</div>
            <div style={{ fontSize: "2rem", marginTop: 10 }}>
              {selectedOrganizationId && onboarding
                ? renderBoolean(onboarding.readyForOpportunityIntake)
                : "Not yet"}
            </div>
            <p style={{ marginBottom: 0, color: "#5c5140" }}>
              Programs: {onboarding?.counts.programs ?? 0} · Evidence: {onboarding?.counts.evidence ?? 0}
            </p>
          </article>
          <article style={shellCardStyle}>
            <div style={labelStyle}>Submission Ready</div>
            <div style={{ fontSize: "2rem", marginTop: 10 }}>
              {selectedOrganizationId && onboarding
                ? renderBoolean(onboarding.readyForSubmissionAutomation)
                : "Not yet"}
            </div>
            <p style={{ marginBottom: 0, color: "#5c5140" }}>
              Ready docs: {onboarding?.counts.readyDocuments ?? 0} · Opps:{" "}
              {onboarding?.counts.opportunities ?? 0}
            </p>
          </article>
          <article style={shellCardStyle}>
            <div style={labelStyle}>Next Best Move</div>
            <p style={{ margin: "10px 0 0", lineHeight: 1.7 }}>
              {selectedOrganizationId
                ? onboarding?.nextRecommendedAction ?? "Loading the selected workspace."
                : "Create the first workspace or choose an existing one before intake begins."}
            </p>
          </article>
        </section>
      ) : null}

      {!isOpportunityMode ? (
        <section id="program-context" style={{ ...shellCardStyle, marginTop: 24 }}>
          <p
            style={{
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#916b22",
              fontSize: 12,
              margin: 0,
            }}
          >
            Program Context
          </p>
          <h2
            style={{
              fontFamily:
                '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "2rem",
              margin: "12px 0 10px",
            }}
          >
            Give Grant Guardian the real operating context it needs to score and draft well
          </h2>
          <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 900 }}>
            A new workspace stays thin until you add the nonprofit&apos;s programs, reusable
            evidence, and structured budget facts. These records feed fit scoring, evidence
            coverage, grounded drafts, and the missing-evidence task list.
          </p>
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(15, 118, 110, 0.16)",
              background: "rgba(240, 253, 250, 0.85)",
              padding: 14,
              color: "#14532d",
              lineHeight: 1.7,
              marginTop: 14,
              maxWidth: 900,
            }}
          >
            A strong first-pass workspace usually has at least <strong>1 program</strong>,{" "}
            <strong>2 evidence items</strong>, and <strong>1 structured budget</strong>. Until
            then, the fit score is directionally useful but still preliminary.
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              marginTop: 20,
            }}
          >
            <article style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 18, padding: 18, background: "#fffdf8" }}>
              <div style={labelStyle}>Programs</div>
              <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 0 }}>
                Add the core programs this team actually runs. One good program record is better
                than ten vague ones.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Program name</label>
                  <input
                    style={inputStyle}
                    value={programNameInput}
                    onChange={(event) => setProgramNameInput(event.target.value)}
                    placeholder="After-school literacy coaching"
                    disabled={!selectedOrganizationId || programPending}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Target population</label>
                  <input
                    style={inputStyle}
                    value={programTargetPopulationInput}
                    onChange={(event) => setProgramTargetPopulationInput(event.target.value)}
                    placeholder="Low-income students in grades 6-12"
                    disabled={!selectedOrganizationId || programPending}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Geography</label>
                  <input
                    style={inputStyle}
                    value={programGeographyInput}
                    onChange={(event) => setProgramGeographyInput(event.target.value)}
                    placeholder="Chicago, Cook County"
                    disabled={!selectedOrganizationId || programPending}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Outcomes / proof points</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 92, resize: "vertical" }}
                    value={programOutcomesInput}
                    onChange={(event) => setProgramOutcomesInput(event.target.value)}
                    placeholder="84% high-school graduation rate and 2,400 students served since 2014."
                    disabled={!selectedOrganizationId || programPending}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Program budget</label>
                    <input
                      style={inputStyle}
                      inputMode="decimal"
                      value={programBudgetInput}
                      onChange={(event) => setProgramBudgetInput(event.target.value)}
                      placeholder="160000"
                      disabled={!selectedOrganizationId || programPending}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Program lead</label>
                    <input
                      style={inputStyle}
                      value={programLeadInput}
                      onChange={(event) => setProgramLeadInput(event.target.value)}
                      placeholder="Maya Patel"
                      disabled={!selectedOrganizationId || programPending}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                <button
                  style={buttonStyle("primary")}
                  onClick={() => void handleProgramSave()}
                  disabled={!selectedOrganizationId || !normalizeText(programNameInput) || programPending}
                >
                  {programPending ? "Saving program..." : "Save program"}
                </button>
                {programMessage ? <span style={{ color: "#14532d" }}>{programMessage}</span> : null}
                {programError ? <span style={{ color: "#991b1b" }}>{programError}</span> : null}
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={labelStyle}>Current programs</div>
                {recentPrograms.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {recentPrograms.map((program) => (
                      <div key={program.id} style={{ border: "1px solid rgba(73, 63, 46, 0.12)", borderRadius: 14, padding: 12, background: "#ffffff" }}>
                        <strong>{program.name}</strong>
                        <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                          {[program.targetPopulation, program.geography].filter(Boolean).join(" · ") || "No target population or geography saved yet."}
                        </div>
                        {program.keyOutcomes ? (
                          <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                            {program.keyOutcomes}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "#5e5241", lineHeight: 1.7, marginBottom: 0 }}>
                    No programs yet. Add at least one before trusting the fit score too much.
                  </p>
                )}
              </div>
            </article>

            <article style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 18, padding: 18, background: "#fffdf8" }}>
              <div style={labelStyle}>Evidence Library</div>
              <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 0 }}>
                Store outcomes, metrics, testimonials, and proof points that can actually ground
                future proposal answers.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Program</label>
                  <select
                    style={inputStyle}
                    value={evidenceProgramIdInput}
                    onChange={(event) => setEvidenceProgramIdInput(event.target.value)}
                    disabled={!selectedOrganizationId || programs.length === 0 || evidencePending}
                  >
                    <option value="">Choose a program first</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Evidence title</label>
                  <input
                    style={inputStyle}
                    value={evidenceTitleInput}
                    onChange={(event) => setEvidenceTitleInput(event.target.value)}
                    placeholder="84% graduation rate among participants"
                    disabled={!selectedOrganizationId || evidencePending}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 140px", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Evidence type</label>
                    <select
                      style={inputStyle}
                      value={evidenceTypeInput}
                      onChange={(event) => setEvidenceTypeInput(event.target.value)}
                      disabled={!selectedOrganizationId || evidencePending}
                    >
                      <option value="Metric">Metric</option>
                      <option value="Outcome">Outcome</option>
                      <option value="Testimonial">Testimonial</option>
                      <option value="Case Study">Case Study</option>
                      <option value="Research">Research</option>
                      <option value="Budget Fact">Budget Fact</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Quality score</label>
                    <input
                      style={inputStyle}
                      inputMode="numeric"
                      value={evidenceQualityInput}
                      onChange={(event) => setEvidenceQualityInput(event.target.value)}
                      placeholder="85"
                      disabled={!selectedOrganizationId || evidencePending}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Summary</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
                    value={evidenceSummaryInput}
                    onChange={(event) => setEvidenceSummaryInput(event.target.value)}
                    placeholder="Summarize the proof in 1-3 grounded sentences."
                    disabled={!selectedOrganizationId || evidencePending}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Source document</label>
                    <input
                      style={inputStyle}
                      value={evidenceSourceDocumentInput}
                      onChange={(event) => setEvidenceSourceDocumentInput(event.target.value)}
                      placeholder="FY25 Outcomes Memo"
                      disabled={!selectedOrganizationId || evidencePending}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Collected at</label>
                    <input
                      style={inputStyle}
                      type="date"
                      value={evidenceCollectedAtInput}
                      onChange={(event) => setEvidenceCollectedAtInput(event.target.value)}
                      disabled={!selectedOrganizationId || evidencePending}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Tags</label>
                  <input
                    style={inputStyle}
                    value={evidenceTagsInput}
                    onChange={(event) => setEvidenceTagsInput(event.target.value)}
                    placeholder="literacy, outcomes, evaluation"
                    disabled={!selectedOrganizationId || evidencePending}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                <button
                  style={buttonStyle("primary")}
                  onClick={() => void handleEvidenceSave()}
                  disabled={
                    !selectedOrganizationId ||
                    !evidenceProgramIdInput ||
                    !normalizeText(evidenceTitleInput) ||
                    !normalizeText(evidenceSummaryInput) ||
                    evidencePending
                  }
                >
                  {evidencePending ? "Saving evidence..." : "Save evidence"}
                </button>
                {evidenceMessage ? <span style={{ color: "#14532d" }}>{evidenceMessage}</span> : null}
                {evidenceError ? <span style={{ color: "#991b1b" }}>{evidenceError}</span> : null}
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={labelStyle}>Current evidence</div>
                {recentEvidence.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {recentEvidence.map((item) => (
                      <div key={item.id} style={{ border: "1px solid rgba(73, 63, 46, 0.12)", borderRadius: 14, padding: 12, background: "#ffffff" }}>
                        <strong>{item.title}</strong>
                        <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                          {item.programName} · {item.evidenceType}
                          {typeof item.reliabilityRating === "number"
                            ? ` · ${Math.round(item.reliabilityRating * 100)}% quality`
                            : ""}
                        </div>
                        <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                          {item.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "#5e5241", lineHeight: 1.7, marginBottom: 0 }}>
                    No evidence items yet. That&apos;s why narrative drafts still fall back to
                    blockers or weak placeholders.
                  </p>
                )}
              </div>
            </article>

            <article style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 18, padding: 18, background: "#fffdf8" }}>
              <div style={labelStyle}>Structured Budgets</div>
              <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 0 }}>
                Capture the budget facts the analysis, submission prep, and reporting flows need.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Program</label>
                  <select
                    style={inputStyle}
                    value={budgetProgramIdInput}
                    onChange={(event) => setBudgetProgramIdInput(event.target.value)}
                    disabled={!selectedOrganizationId || programs.length === 0 || budgetPending}
                  >
                    <option value="">Choose a program first</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Budget name</label>
                  <input
                    style={inputStyle}
                    value={budgetNameInput}
                    onChange={(event) => setBudgetNameInput(event.target.value)}
                    placeholder="FY26 After-school Literacy Budget"
                    disabled={!selectedOrganizationId || budgetPending}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Fiscal year</label>
                    <input
                      style={inputStyle}
                      inputMode="numeric"
                      value={budgetFiscalYearInput}
                      onChange={(event) => setBudgetFiscalYearInput(event.target.value)}
                      placeholder="2026"
                      disabled={!selectedOrganizationId || budgetPending}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Budget type</label>
                    <select
                      style={inputStyle}
                      value={budgetTypeInput}
                      onChange={(event) => setBudgetTypeInput(event.target.value)}
                      disabled={!selectedOrganizationId || budgetPending}
                    >
                      <option value="Program">Program</option>
                      <option value="Project">Project</option>
                      <option value="Operating">Operating</option>
                      <option value="Capital">Capital</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Total revenue</label>
                    <input
                      style={inputStyle}
                      inputMode="decimal"
                      value={budgetRevenueInput}
                      onChange={(event) => setBudgetRevenueInput(event.target.value)}
                      placeholder="180000"
                      disabled={!selectedOrganizationId || budgetPending}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Total expense</label>
                    <input
                      style={inputStyle}
                      inputMode="decimal"
                      value={budgetExpenseInput}
                      onChange={(event) => setBudgetExpenseInput(event.target.value)}
                      placeholder="160000"
                      disabled={!selectedOrganizationId || budgetPending}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Notes / line items</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
                    value={budgetNotesInput}
                    onChange={(event) => setBudgetNotesInput(event.target.value)}
                    placeholder="Key line items, narrative notes, or budget framing."
                    disabled={!selectedOrganizationId || budgetPending}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                <button
                  style={buttonStyle("primary")}
                  onClick={() => void handleBudgetSave()}
                  disabled={
                    !selectedOrganizationId ||
                    !budgetProgramIdInput ||
                    !normalizeText(budgetNameInput) ||
                    budgetPending
                  }
                >
                  {budgetPending ? "Saving budget..." : "Save budget"}
                </button>
                {budgetMessage ? <span style={{ color: "#14532d" }}>{budgetMessage}</span> : null}
                {budgetError ? <span style={{ color: "#991b1b" }}>{budgetError}</span> : null}
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={labelStyle}>Current budgets</div>
                {recentBudgets.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {recentBudgets.map((budget) => (
                      <div key={budget.id} style={{ border: "1px solid rgba(73, 63, 46, 0.12)", borderRadius: 14, padding: 12, background: "#ffffff" }}>
                        <strong>{budget.name}</strong>
                        <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                          {budget.programName} · {budget.budgetType}
                          {budget.fiscalYear ? ` · FY${budget.fiscalYear}` : ""}
                        </div>
                        <div style={{ color: "#5e5241", marginTop: 6, lineHeight: 1.6 }}>
                          Revenue {formatCurrency(budget.totalRevenue)} · Expense {formatCurrency(budget.totalExpense)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "#5e5241", lineHeight: 1.7, marginBottom: 0 }}>
                    No structured budgets yet. Budget documents help, but structured budget rows
                    make the automation paths smarter.
                  </p>
                )}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {!isOpportunityMode ? (
        <section id="document-vault" style={{ ...shellCardStyle, marginTop: 24 }}>
          <p
            style={{
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#916b22",
              fontSize: 12,
              margin: 0,
            }}
          >
            Document Vault
          </p>
          <h2
            style={{
              fontFamily:
                '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "2rem",
              margin: "12px 0 10px",
            }}
          >
            Add this team&apos;s real documents before you expect grounded drafts
          </h2>
          <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 860 }}>
            This vault is for your nonprofit&apos;s own files like the 501(c)(3) letter, budgets,
            board lists, audits, and letters of support. Funder 990 PDFs do not belong here; they
            stay in <strong>Funder Filings</strong> as outside research artifacts.
          </p>
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(15, 118, 110, 0.16)",
              background: "rgba(240, 253, 250, 0.85)",
              padding: 14,
              color: "#14532d",
              lineHeight: 1.7,
              marginTop: 14,
              maxWidth: 860,
            }}
          >
            Start with three files most teams already have: the <strong>501(c)(3)</strong> letter,
            one <strong>budget</strong>, and the current <strong>board roster</strong>.
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
              marginTop: 20,
            }}
          >
            <div>
              <label style={labelStyle}>Document name</label>
              <input
                style={inputStyle}
                value={documentNameInput}
                onChange={(event) => setDocumentNameInput(event.target.value)}
                placeholder="FY26 Organizational Budget"
                disabled={!selectedOrganizationId || documentPending}
              />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                style={inputStyle}
                value={documentTypeInput}
                onChange={(event) => setDocumentTypeInput(event.target.value)}
                disabled={!selectedOrganizationId || documentPending}
              >
                <option value="501(c)(3)">501(c)(3)</option>
                <option value="Budget">Budget</option>
                <option value="Board List">Board List</option>
                <option value="Audit">Audit</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <input
                style={inputStyle}
                value={documentOwnerInput}
                onChange={(event) => setDocumentOwnerInput(event.target.value)}
                placeholder="Maya Patel"
                disabled={!selectedOrganizationId || documentPending}
              />
            </div>
            <div>
              <label style={labelStyle}>Expiration date</label>
              <input
                style={inputStyle}
                type="date"
                value={documentExpirationInput}
                onChange={(event) => setDocumentExpirationInput(event.target.value)}
                disabled={!selectedOrganizationId || documentPending}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Choose file</label>
              <input
                style={{
                  ...inputStyle,
                  padding: "12px 14px",
                }}
                type="file"
                onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                disabled={!selectedOrganizationId || documentPending}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button
              style={buttonStyle("primary")}
              onClick={() => void handleDocumentUpload()}
              disabled={!selectedOrganizationId || !documentFile || documentPending}
            >
              {documentPending ? "Uploading..." : "Upload document"}
            </button>
            {documentMessage ? <span style={{ color: "#14532d" }}>{documentMessage}</span> : null}
            {documentError ? <span style={{ color: "#991b1b" }}>{documentError}</span> : null}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={labelStyle}>Current workspace documents</div>
            {selectedOrganizationId ? (
              recentDocuments.length > 0 ? (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {recentDocuments.map((document) => (
                    <div
                      key={document.id}
                      style={{
                        border: "1px solid rgba(88, 75, 49, 0.14)",
                        borderRadius: 16,
                        padding: 14,
                        background: "#fffdf8",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <strong>{document.name}</strong>
                          <div style={{ color: "#5e5241", marginTop: 6 }}>
                            {document.documentType} · {document.uploadStatus}
                            {document.owner ? ` · Owner: ${document.owner}` : ""}
                          </div>
                        </div>
                        {document.fileUrl ? (
                          <a href={document.fileUrl} target="_blank" rel="noreferrer" style={{ ...buttonStyle(), textDecoration: "none" }}>
                            Open file
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 10 }}>
                  No documents are attached to this workspace yet. Upload the 501(c)(3) letter,
                  budget, and board roster here so requirements stop showing up as blocked.
                </p>
              )
            ) : (
              <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 10 }}>
                Choose a workspace first, then upload the nonprofit&apos;s core files here.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {!isOpportunityMode ? (
        <section id="opportunity-intake" style={{ ...shellCardStyle, marginTop: 24 }}>
        <p
          style={{
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#916b22",
            fontSize: 12,
            margin: 0,
          }}
        >
          Frontend Intake
        </p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: "12px 0 10px",
          }}
        >
          Turn one link or one pasted RFP into a real working opportunity
        </h2>
        <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
          This is where a small team stops copying text between tabs and starts building a usable
          record. Paste the opportunity URL or RFP text, let the backend discover the likely
          portal, then confirm or correct that portal link before any browser handoff is allowed.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 16,
            marginTop: 20,
          }}
        >
          <div>
            <label style={labelStyle}>Opportunity URL</label>
            <input
              style={inputStyle}
              value={intakeUrl}
              onChange={(event) => setIntakeUrl(event.target.value)}
              placeholder="https://funder.org/grants/apply"
              disabled={!selectedOrganizationId}
            />
          </div>
          <div>
            <label style={labelStyle}>Organization</label>
            <div
              style={{
                ...inputStyle,
                minHeight: 48,
                display: "flex",
                alignItems: "center",
                color: "#5e5241",
              }}
            >
              {selectedOrganization?.legalName ?? "Choose a workspace above first"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Or paste RFP text / application instructions</label>
          <textarea
            style={{ ...inputStyle, minHeight: 140, resize: "vertical" }}
            value={intakeText}
            onChange={(event) => setIntakeText(event.target.value)}
            placeholder="Paste the RFP text, application instructions, or the email notice here."
            disabled={!selectedOrganizationId}
          />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          <button
            style={buttonStyle("primary")}
            onClick={handleIntake}
            disabled={
              !selectedOrganizationId ||
              formPending ||
              (!normalizeText(intakeUrl) && !normalizeText(intakeText))
            }
          >
            {formPending ? "Running intake..." : "Run intake"}
          </button>
          {intakeStatus ? <span style={{ color: "#14532d" }}>{intakeStatus}</span> : null}
          {intakeError ? <span style={{ color: "#991b1b" }}>{intakeError}</span> : null}
          {workspacePending ? <span style={{ color: "#5e5241" }}>Loading workspace…</span> : null}
        </div>
        </section>
      ) : null}

      <section
        style={{
          ...shellCardStyle,
          marginTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <p style={{ ...labelStyle, marginBottom: 6 }}>Portal Confirmation Queue</p>
            <h2
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                fontSize: "2rem",
                margin: 0,
              }}
            >
              {isOpportunityMode
                ? "Confirm this opportunity's portal before any browser handoff"
                : "Opportunity portals that still need one careful human decision"}
            </h2>
          </div>
          <button
            style={buttonStyle()}
            onClick={() => void refreshDashboard()}
            disabled={!selectedOrganizationId}
          >
            Refresh dashboard
          </button>
        </div>

        {!selectedOrganizationId ? (
          <div style={{ marginTop: 20, color: "#5e5241", lineHeight: 1.7 }}>
            Choose a workspace first. Once a workspace is selected, its opportunities and portal
            confirmation queue will load here.
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
          {selectedOrganizationId && visiblePortalOpportunities.length === 0 ? (
            <div style={{ color: "#5e5241" }}>
              {isOpportunityMode
                ? "This opportunity is not available in the current workspace."
                : "No opportunities yet. Run intake above to create the first one for this workspace."}
            </div>
          ) : null}
          {selectedOrganizationId
            ? visiblePortalOpportunities.map((opportunity) => (
                <article
                  key={opportunity.id}
                  style={{
                    border: "1px solid rgba(88, 75, 49, 0.14)",
                    borderRadius: 18,
                    padding: 18,
                    background: "#fffdf8",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ ...wrapAnywhereStyle, maxWidth: 760, flex: "1 1 460px" }}>
                      <h3 style={{ ...wrapAnywhereStyle, margin: 0, fontSize: "1.1rem" }}>
                        {opportunity.title}
                      </h3>
                      <p style={{ margin: "8px 0 0", color: "#5e5241", lineHeight: 1.6 }}>
                        {opportunity.rationale || "No intake summary saved yet."}
                      </p>
                    </div>
                    <div style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 0 }}>
                      <span style={readinessBadgeStyle(opportunity.portalReadiness.level)}>
                        {opportunity.portalReadiness.level}
                      </span>
                      <span style={{ color: "#6b5d46", fontSize: 13 }}>
                        {opportunity.portalReadiness.kind}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                      marginTop: 14,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Detected submission method</label>
                      <select
                        style={inputStyle}
                        value={
                          methodInputs[opportunity.id] ??
                          opportunity.submissionMethod ??
                          "Submittable"
                        }
                        onChange={(event) =>
                          setMethodInputs((current) => ({
                            ...current,
                            [opportunity.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="Submittable">Submittable</option>
                        <option value="Portal">Portal</option>
                        <option value="Email">Email</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Confirmed portal URL</label>
                      <input
                        style={inputStyle}
                        value={portalInputs[opportunity.id] ?? ""}
                        onChange={(event) =>
                          setPortalInputs((current) => ({
                            ...current,
                            [opportunity.id]: event.target.value,
                          }))
                        }
                        placeholder="Paste or confirm the application URL here"
                      />
                    </div>
                  </div>

                  {opportunity.portalReadiness.level === "Blocked" ? (
                    <p style={{ color: "#5e5241", lineHeight: 1.7, margin: "14px 0 0" }}>
                      We found this opportunity but couldn&apos;t confirm the application portal
                      URL. Paste the direct application link below to unblock it.
                    </p>
                  ) : null}

                  <div style={{ marginTop: 12, color: "#5e5241", fontSize: 14, lineHeight: 1.6 }}>
                    <div style={wrapAnywhereStyle}>
                      Source URL: {opportunity.sourceUrl ?? "No source URL saved"}
                    </div>
                    <div style={wrapAnywhereStyle}>
                      Preferred browser URL:{" "}
                      {opportunity.portalReadiness.preferredBrowserUrl ?? "Not ready"}
                    </div>
                    {opportunity.portalReadiness.blockers.length > 0 ? (
                      <div style={{ color: "#991b1b", marginTop: 8 }}>
                        {opportunity.portalReadiness.blockers.join(" ")}
                      </div>
                    ) : null}
                    {opportunity.portalReadiness.warnings.length > 0 ? (
                      <div style={{ color: "#9a4d00", marginTop: 8 }}>
                        {opportunity.portalReadiness.warnings.join(" ")}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    {!isOpportunityMode ? (
                      <>
                        <button
                          style={buttonStyle()}
                          onClick={() => setSelectedOpportunityId(opportunity.id)}
                        >
                          Focus here
                        </button>
                        <Link href={buildOpportunityHref(opportunity)} style={buttonStyle()}>
                          Open page
                        </Link>
                      </>
                    ) : null}
                    <button
                      style={buttonStyle("primary")}
                      onClick={() => updatePortal(opportunity.id)}
                    >
                      Save portal
                    </button>
                    <button style={buttonStyle()} onClick={() => rediscoverPortal(opportunity.id)}>
                      Rediscover from source
                    </button>
                    <button style={buttonStyle()} onClick={() => probePortal(opportunity.id)}>
                      Run live probe
                    </button>
                  </div>

                  {rowMessages[opportunity.id] ? (
                    <p style={{ color: "#14532d", margin: "12px 0 0" }}>
                      {rowMessages[opportunity.id]}
                    </p>
                  ) : null}
                  {rowErrors[opportunity.id] ? (
                    <p style={{ color: "#991b1b", margin: "12px 0 0" }}>
                      {rowErrors[opportunity.id]}
                    </p>
                  ) : null}

                  {opportunity.portalReadiness.recommendedActions.length > 0 ? (
                    <ul style={{ margin: "14px 0 0", color: "#5e5241", paddingLeft: 20 }}>
                      {opportunity.portalReadiness.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            : null}
        </div>
      </section>

      <section style={{ ...shellCardStyle, marginTop: 24 }}>
        <p
          style={{
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#916b22",
            fontSize: 12,
            margin: 0,
          }}
        >
          Opportunity Workbench
        </p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: "12px 0 10px",
          }}
        >
          {isOpportunityMode
            ? "Run the full workflow for this one opportunity"
            : "Run the real grant workflow from the website, with Notion turned on by default"}
        </h2>
        <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 860 }}>
          {isOpportunityMode
            ? "This route keeps one grant in focus. Portal confirmation, analysis, review, submission prep, reporting, and lessons all stay in one place with Notion syncing on each major action."
            : "This panel is the bridge from “interesting backend” to “usable local product.” Choose an opportunity, run analysis, draft, review, submission prep, reporting, and rejection memory from here, and keep Notion synced as the visible operating layer."}
        </p>

        {!selectedOrganizationId ? (
          <div style={{ marginTop: 18, color: "#5e5241", lineHeight: 1.7 }}>
            Choose a workspace first. Then the website can operate on that team&apos;s opportunities
            instead of acting like a demo shell.
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                marginTop: 18,
              }}
            >
              {isOpportunityMode ? (
                <div
                  style={{
                    ...inputStyle,
                    minHeight: 48,
                    display: "flex",
                    alignItems: "center",
                    color: "#5e5241",
                  }}
                >
                  {selectedOpportunity?.title ?? "Loading selected opportunity..."}
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>Selected opportunity</label>
                  <select
                    style={inputStyle}
                    value={selectedOpportunityId ?? ""}
                    onChange={(event) => setSelectedOpportunityId(event.target.value || null)}
                  >
                    <option value="">Choose an opportunity</option>
                    {sortedOpportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Reviewer / owner</label>
                <input
                  style={inputStyle}
                  value={reviewerNameInput}
                  onChange={(event) => setReviewerNameInput(event.target.value)}
                  placeholder="Maya Patel"
                />
              </div>
              <div>
                <label style={labelStyle}>Review due date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={reviewDueDateInput}
                  onChange={(event) => setReviewDueDateInput(event.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Reporting cadence</label>
                <select
                  style={inputStyle}
                  value={reportingCadenceInput}
                  onChange={(event) => setReportingCadenceInput(event.target.value)}
                >
                  <option value="Quarterly + Final">Quarterly + Final</option>
                  <option value="Semiannual + Final">Semiannual + Final</option>
                  <option value="Final Only">Final Only</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Submission / reviewer notes</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                  value={launchReviewerNotes}
                  onChange={(event) => setLaunchReviewerNotes(event.target.value)}
                  placeholder="Ready for browser handoff after one final human check."
                />
              </div>
            </div>

            {selectedOpportunity ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 14,
                    marginTop: 18,
                  }}
                >
                  <div style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Status</div>
                    <div style={{ fontSize: "1.4rem", marginTop: 8 }}>{selectedOpportunity.status}</div>
                    <p style={{ marginBottom: 0, color: "#5c5140" }}>
                      {selectedOpportunity.submissionMethod ?? "Unknown method"}
                    </p>
                  </div>
                  <div style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Portal readiness</div>
                    <div style={{ marginTop: 8 }}>
                      <span style={readinessBadgeStyle(selectedOpportunity.portalReadiness.level)}>
                        {selectedOpportunity.portalReadiness.level}
                      </span>
                    </div>
                    <p style={{ marginBottom: 0, color: "#5c5140" }}>
                      {selectedOpportunity.portalReadiness.kind}
                    </p>
                  </div>
                  <div style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Review stage</div>
                    <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                      {reviewReadinessSnapshots[selectedOpportunity.id]?.stage ??
                        "Analysis not run yet."}
                    </div>
                    {(reviewReadinessSnapshots[selectedOpportunity.id]?.blockerCount ?? 0) > 0 ? (
                      <p style={{ marginBottom: 0, color: "#5c5140" }}>
                        Blockers: {reviewReadinessSnapshots[selectedOpportunity.id]?.blockerCount ?? 0}
                      </p>
                    ) : null}
                  </div>
                  <div style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Next step</div>
                    <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.6 }}>
                      {selectedOpportunity.portalReadiness.level === "Ready"
                        ? "Run the analysis to see your fit score and check which questions you already have evidence for."
                        : "Confirm the portal first, then run the deeper workflow."}
                    </p>
                  </div>
                </div>

                {selectedOpportunity.status === "Awarded" ? (
                  <div style={{ marginTop: 18 }}>
                    <ReportingWorkspaceCard
                      reporting={
                        selectedReporting ?? {
                          opportunityId: selectedOpportunity.id,
                          opportunityTitle: selectedOpportunity.title,
                          opportunityStatus: "Awarded",
                          cadence: null,
                          reports: [],
                          summary: {
                            total: 0,
                            upcoming: 0,
                            inProgress: 0,
                            submitted: 0,
                            overdue: 0,
                          },
                          metricsToTrack: [],
                          reportTemplates: [],
                          milestoneTasks: [],
                        }
                      }
                      opportunityId={selectedOpportunity.id}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                    <button
                      style={buttonStyle("primary")}
                      onClick={() => void runAnalysis()}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "analysis" ? "Analyzing..." : "Analyze opportunity"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void runDrafting()}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "drafting" ? "Drafting..." : "Generate drafts"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void runReviewWorkflow()}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "review" ? "Preparing review..." : "Build review queue"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void runSubmissionAssembly()}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "submission" ? "Assembling..." : "Assemble submission"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void launchAutopilot(false)}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "launch-handoff"
                        ? "Preparing handoff..."
                        : "Prepare handoff"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void launchAutopilot(true)}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "launch-browser"
                        ? "Launching browser..."
                        : "Launch browser handoff"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => void activateReporting()}
                      disabled={workflowPendingKey !== null}
                    >
                      {workflowPendingKey === "reporting"
                        ? "Activating reporting..."
                        : "Activate reporting"}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => setShowRejectionComposer((current) => !current)}
                      disabled={workflowPendingKey !== null}
                    >
                      {selectedOpportunity.status === "Rejected"
                        ? showRejectionComposer
                          ? "Hide rejection form"
                          : "Log rejection feedback"
                        : showRejectionComposer
                          ? "Cancel rejection flow"
                          : "Mark as rejected"}
                    </button>
                  </div>
                )}

                {(showRejectionComposer || selectedOpportunity.status === "Rejected") ? (
                  <article
                    style={{
                      ...shellCardStyle,
                      padding: 18,
                      marginTop: 16,
                      border: "1px solid rgba(217, 119, 6, 0.18)",
                      background: "#fffaf0",
                    }}
                  >
                    <div style={labelStyle}>Rejection feedback</div>
                    <p style={{ color: "#5c5140", lineHeight: 1.7, marginTop: 0 }}>
                      {selectedOpportunity.status === "Rejected"
                        ? "This opportunity is already marked as rejected. Log what happened so Grant Guardian can surface the lesson next time this funder appears."
                        : "Before marking this opportunity as rejected, capture the funder's feedback so the next cycle starts with a real lesson instead of a vague loss."}
                    </p>
                    <textarea
                      style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
                      value={lessonFeedbackInput}
                      onChange={(event) => setLessonFeedbackInput(event.target.value)}
                      placeholder="Reviewer said the proposal aligned with the funder's goals, but the evaluation plan needed clearer benchmarks and staffing coverage looked thin."
                    />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                      <button
                        style={buttonStyle("primary")}
                        onClick={() => void recordLesson()}
                        disabled={workflowPendingKey !== null || !normalizeText(lessonFeedbackInput)}
                      >
                        {workflowPendingKey === "lesson"
                          ? "Saving rejection memory..."
                          : selectedOpportunity.status === "Rejected"
                            ? "Log rejection feedback"
                            : "Mark rejected and log feedback"}
                      </button>
                      <button
                        style={buttonStyle()}
                        onClick={() => {
                          setShowRejectionComposer(false);
                          setLessonFeedbackInput("");
                        }}
                        disabled={workflowPendingKey !== null}
                      >
                        Clear
                      </button>
                    </div>
                  </article>
                ) : null}

                {workflowMessage ? (
                  <p style={{ color: "#14532d", margin: "14px 0 0" }}>{workflowMessage}</p>
                ) : null}
                {workflowError ? (
                  <p style={{ color: "#991b1b", margin: "14px 0 0" }}>{workflowError}</p>
                ) : null}

                {selectedLessonsMemory?.warningMessage ? (
                  <div
                    style={{
                      marginTop: 18,
                      borderRadius: 18,
                      border: "1px solid rgba(217, 119, 6, 0.2)",
                      background: "#fff7ed",
                      padding: 16,
                      color: "#9a4d00",
                      lineHeight: 1.7,
                    }}
                  >
                    <strong>Rejection memory:</strong> {selectedLessonsMemory.warningMessage}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    gap: 16,
                    marginTop: 20,
                  }}
                >
                  {selectedAnalysis ? (
                    <FitScoreCard analysis={selectedAnalysis} />
                  ) : (
                    <article style={{ ...shellCardStyle, padding: 20 }}>
                      <div style={labelStyle}>Fit Score</div>
                      <p style={{ color: "#5c5140", lineHeight: 1.7, marginBottom: 0 }}>
                        Run analysis to replace the generic research state with a real fit score,
                        pursue decision, and component breakdown.
                      </p>
                    </article>
                  )}

                  {selectedWorkbench ? (
                    <FunderIntelligenceCard
                      funder={selectedWorkbench.funder}
                      onResearch={() => void runFunderResearch()}
                      researchPending={workflowPendingKey === "funder-research"}
                    />
                  ) : null}
                </div>

                {selectedWorkbench ? (
                  <GrantDNACard
                    funder={selectedWorkbench.funder}
                    drafts={selectedWorkbench.drafts.rows}
                  />
                ) : null}

                {selectedAnalysis ? <EvidenceCoveragePanel analysis={selectedAnalysis} /> : null}

                {selectedWorkbench ? (
                  <DraftAnswersPanel
                    drafts={selectedWorkbench.drafts.rows}
                    selectedOrganizationId={selectedOrganizationId}
                    recentEvidence={recentEvidence}
                    recentDocuments={recentDocuments}
                    recentPrograms={recentPrograms}
                    recentBudgets={recentBudgets}
                    editingDraftId={editingDraftId}
                    draftEditorValue={draftEditorValue}
                    onStartEdit={(draftId, draftText) => {
                      setEditingDraftId(draftId);
                      setDraftEditorValue(stripUnsupportedSection(draftText));
                    }}
                    onCancelEdit={() => {
                      setEditingDraftId(null);
                      setDraftEditorValue("");
                    }}
                    onEditorChange={setDraftEditorValue}
                    onSaveEdit={(draftId) => void saveDraftEdit(draftId)}
                    onApprove={(draftId) => void approveDraftAnswer(draftId)}
                    pendingKey={workflowPendingKey}
                  />
                ) : null}

                {selectedWorkbench?.submissionHandoff ? (
                  <SubmittableHandoffLog handoff={selectedWorkbench.submissionHandoff} />
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 16,
                    marginTop: 20,
                  }}
                >
                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Drafting snapshot</div>
                    {draftResults[selectedOpportunity.id] ? (
                      <>
                        <div style={{ fontSize: "1.5rem", marginTop: 8 }}>
                          {draftResults[selectedOpportunity.id]!.drafts.length} answer(s)
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          New drafts: {draftResults[selectedOpportunity.id]!.draftedCount} ·
                          Preserved approved: {draftResults[selectedOpportunity.id]!.preservedCount}
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          {draftResults[selectedOpportunity.id]!.drafts[0]?.draftPreview ??
                            "Drafts are ready in Notion."}
                        </p>
                      </>
                    ) : selectedWorkbench?.drafts.total ? (
                      <>
                        <div style={{ fontSize: "1.5rem", marginTop: 8 }}>
                          {selectedWorkbench.drafts.total} answer(s)
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Approved: {selectedWorkbench.drafts.approved} · Needs review:{" "}
                          {selectedWorkbench.drafts.total - selectedWorkbench.drafts.approved}
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          {selectedWorkbench.drafts.rows[0]?.draftText.slice(0, 200) ??
                            "Drafts are ready in Notion."}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Generate drafts to review grounded answer previews here.
                      </p>
                    )}
                  </article>

                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Review readiness</div>
                    {(
                      reviewReadinessSnapshots[selectedOpportunity.id] ??
                      selectedWorkbench?.reviewReadiness
                    ) ? (
                      <>
                        <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                          {
                            (
                              reviewReadinessSnapshots[selectedOpportunity.id] ??
                              selectedWorkbench?.reviewReadiness
                            )!.stage
                          }
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Ready:{" "}
                          {(
                            reviewReadinessSnapshots[selectedOpportunity.id] ??
                            selectedWorkbench?.reviewReadiness
                          )!.readyForSubmission
                            ? "Yes"
                            : "Not yet"}{" "}
                          · Review coverage:{" "}
                          {
                            (
                              reviewReadinessSnapshots[selectedOpportunity.id] ??
                              selectedWorkbench?.reviewReadiness
                            )!.reviewCoveragePercent
                          }
                          %
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          Open tasks:{" "}
                          {
                            (
                              reviewReadinessSnapshots[selectedOpportunity.id] ??
                              selectedWorkbench?.reviewReadiness
                            )!.taskSummary.open
                          }
                          {(
                            reviewReadinessSnapshots[selectedOpportunity.id] ??
                            selectedWorkbench?.reviewReadiness
                          )!.taskSummary.blocked > 0
                            ? ` · Blocked: ${
                                (
                                  reviewReadinessSnapshots[selectedOpportunity.id] ??
                                  selectedWorkbench?.reviewReadiness
                                )!.taskSummary.blocked
                              }`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Review readiness will appear after the workspace loads or a review queue is built.
                      </p>
                    )}
                  </article>

                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Submission handoff</div>
                    {submissionResults[selectedOpportunity.id] ? (
                      <>
                        <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                          {submissionResults[selectedOpportunity.id]!.adapterPlan.adapterKey}
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Narratives:{" "}
                          {submissionResults[selectedOpportunity.id]!.completeness.approvedNarrativesIncluded}/
                          {submissionResults[selectedOpportunity.id]!.completeness.requiredNarratives} ·
                          Attachments:{" "}
                          {submissionResults[selectedOpportunity.id]!.completeness.approvedAttachmentsIncluded}/
                          {submissionResults[selectedOpportunity.id]!.completeness.requiredAttachments}
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          {submissionResults[selectedOpportunity.id]!.safetyGate.safeToLaunchAutopilot
                            ? "Safe to launch the guarded handoff."
                            : submissionResults[selectedOpportunity.id]!.safetyGate.blockers.join(" ")}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Assemble submission to see packet completeness and the active adapter plan.
                      </p>
                    )}
                  </article>

                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Autopilot session</div>
                    {autopilotResults[selectedOpportunity.id] ? (
                      <>
                        <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                          {autopilotResults[selectedOpportunity.id]!.launchMode}
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Session: {autopilotResults[selectedOpportunity.id]!.submissionSessionId}
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          {autopilotResults[selectedOpportunity.id]!.finalSubmitGate
                            .requiresSecondConfirmation
                            ? "Second human confirmation is still required before final submit."
                            : "No browser final-submit path is required for this adapter."}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Launch a handoff to create a reusable submission session from the website.
                      </p>
                    )}
                  </article>

                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Reporting calendar</div>
                    {reportingResults[selectedOpportunity.id] ? (
                      <>
                        <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                          {reportingResults[selectedOpportunity.id]!.summary.total} milestone(s)
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Upcoming: {reportingResults[selectedOpportunity.id]!.summary.upcoming} · In
                          progress: {reportingResults[selectedOpportunity.id]!.summary.inProgress}
                        </p>
                        <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                          Next due: {reportingResults[selectedOpportunity.id]!.reports[0]?.reportName ??
                            "No reports yet"}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Activate reporting to generate the post-award calendar and matching tasks.
                      </p>
                    )}
                  </article>

                  <article style={{ ...shellCardStyle, padding: 18 }}>
                    <div style={labelStyle}>Lessons memory</div>
                    {selectedLessonsMemory ? (
                      <>
                        <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
                          {selectedLessonsMemory.memorySummary.totalLessons} lesson(s)
                        </div>
                        <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                          Top themes:{" "}
                          {selectedLessonsMemory.memorySummary.topThemes.join(", ") ||
                            "No reusable themes yet"}
                        </p>
                        {selectedLessonsMemory.lessons.length > 0 ? (
                          <div style={{ display: "grid", gap: 12 }}>
                            {selectedLessonsMemory.lessons.slice(0, 2).map((lesson) => (
                              <div
                                key={lesson.id}
                                style={{
                                  borderRadius: 14,
                                  border: "1px solid rgba(73, 63, 46, 0.12)",
                                  background: "#fffdf8",
                                  padding: 12,
                                }}
                              >
                                <div style={{ fontWeight: 600, color: "#2d251a" }}>
                                  {lesson.opportunityTitle ?? selectedOpportunity.title}
                                </div>
                                <div style={{ color: "#6b5d46", fontSize: 13, marginTop: 4 }}>
                                  Rejection date: {lesson.rejectionDate.slice(0, 10)}
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                                  {lesson.themes.map((theme) => (
                                    <span
                                      key={`${lesson.id}-${theme}`}
                                      style={{
                                        borderRadius: 999,
                                        padding: "4px 9px",
                                        fontSize: 12,
                                        background: "#fff7ed",
                                        color: "#9a4d00",
                                      }}
                                    >
                                      {theme}
                                    </span>
                                  ))}
                                </div>
                                <p style={{ color: "#5c5140", lineHeight: 1.6, margin: "10px 0 0" }}>
                                  {lesson.recommendations ??
                                    "After each grant decision (win or loss), log what happened here. Over time Grant Guardian surfaces patterns to make future applications stronger."}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                            After each grant decision (win or loss), log what happened here. Over time Grant Guardian surfaces patterns to make future applications stronger.
                          </p>
                        )}
                      </>
                    ) : (
                      <p style={{ color: "#5c5140", marginBottom: 0 }}>
                        Lessons and rejection memory for this opportunity will appear here.
                      </p>
                    )}
                  </article>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 18, color: "#5e5241" }}>
                Choose an opportunity to open the workbench.
              </div>
            )}
          </>
        )}
      </section>

      {!isOpportunityMode ? (
        <section style={{ ...shellCardStyle, marginTop: 24 }}>
        <p
          style={{
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#916b22",
            fontSize: 12,
            margin: 0,
          }}
        >
          Funder Contrast
        </p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: "12px 0 10px",
          }}
        >
          Show why similar-sounding funders still need different strategy
        </h2>
        <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 820 }}>
          This turns the 990 intelligence into a visible coaching tool. Compare two funders, write
          the contrast to Notion, and make the difference obvious before anyone recycles the wrong
          ask, budget, or evidence posture.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            marginTop: 18,
          }}
        >
          <div>
            <label style={labelStyle}>Left funder</label>
            <select
              style={inputStyle}
              value={selectedLeftFunderId}
              onChange={(event) => setSelectedLeftFunderId(event.target.value)}
            >
              <option value="">Choose a funder</option>
              {funders.map((funder) => (
                <option key={funder.id} value={funder.id}>
                  {funder.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Right funder</label>
            <select
              style={inputStyle}
              value={selectedRightFunderId}
              onChange={(event) => setSelectedRightFunderId(event.target.value)}
            >
              <option value="">Choose a funder</option>
              {funders.map((funder) => (
                <option key={funder.id} value={funder.id}>
                  {funder.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          <button
            style={buttonStyle("primary")}
            onClick={() => void runContrast()}
            disabled={contrastPending || !selectedLeftFunderId || !selectedRightFunderId}
          >
            {contrastPending ? "Building contrast..." : "Build funder contrast"}
          </button>
          {contrastMessage ? <span style={{ color: "#14532d" }}>{contrastMessage}</span> : null}
          {contrastError ? <span style={{ color: "#991b1b" }}>{contrastError}</span> : null}
        </div>

        {contrastResult ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
              marginTop: 18,
            }}
          >
            <article style={{ ...shellCardStyle, padding: 18 }}>
              <div style={labelStyle}>{contrastResult.left.funderName}</div>
              <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                Visible grant rows: {contrastResult.left.visibleGrantRows}
              </p>
              <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                {contrastResult.left.givingSummary ?? "No summary yet."}
              </p>
            </article>
            <article style={{ ...shellCardStyle, padding: 18 }}>
              <div style={labelStyle}>{contrastResult.right.funderName}</div>
              <p style={{ color: "#5c5140", lineHeight: 1.6 }}>
                Visible grant rows: {contrastResult.right.visibleGrantRows}
              </p>
              <p style={{ color: "#5c5140", lineHeight: 1.6, marginBottom: 0 }}>
                {contrastResult.right.givingSummary ?? "No summary yet."}
              </p>
            </article>
            <article style={{ ...shellCardStyle, padding: 18, gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Primary difference</div>
              <p style={{ color: "#1f2933", fontSize: "1.05rem", lineHeight: 1.7 }}>
                {contrastResult.primaryDifference}
              </p>
              <p style={{ color: "#5c5140", lineHeight: 1.7 }}>{contrastResult.contrastSummary}</p>
              <p style={{ color: "#5c5140", lineHeight: 1.7, marginBottom: 0 }}>
                Recommended move: {contrastResult.recommendedMove}
              </p>
              <ul style={{ margin: "14px 0 0", color: "#5c5140", paddingLeft: 20 }}>
                {contrastResult.contrastSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </article>
          </div>
        ) : null}
        </section>
      ) : null}
    </>
  );
}
