"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { OrganizationSummary } from "../lib/server-data";
import { NotionConnectionCard } from "../notion-connection-card";

type OnboardingClientProps = {
  initialOrganizations: OrganizationSummary[];
  initialOrganization: OrganizationSummary | null;
  initialStep?: number;
  respectRequestedStep?: boolean;
};

type OpportunityRecord = {
  id: string;
  title: string;
  funderId: string;
};

type OrganizationSaveResult = {
  organizationId: string;
  organization?: OrganizationSummary;
};

type IntakeResult = {
  parsed: {
    title: string;
  };
  persisted: {
    opportunityId: string;
    funderId: string;
  };
};

type OpportunityAnalysisResult = {
  opportunityId: string;
  opportunityTitle: string;
  scoring: {
    fitScore: number;
    pursueDecision: string;
    evidenceCoveragePercent: number;
  };
};

type ProgressStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "complete";
};

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

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

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

export function OnboardingClient({
  initialOrganizations,
  initialOrganization,
  initialStep = 1,
  respectRequestedStep = false,
}: OnboardingClientProps) {
  const router = useRouter();

  const [organizations, setOrganizations] = useState<OrganizationSummary[]>(initialOrganizations);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [furthestStep, setFurthestStep] = useState(initialStep);
  const [manualStepSelection, setManualStepSelection] = useState(Boolean(respectRequestedStep));
  const [notionConnected, setNotionConnected] = useState(false);
  const [organization, setOrganization] = useState<OrganizationSummary | null>(initialOrganization);
  const [workspaceMode, setWorkspaceMode] = useState<"existing" | "new">(
    initialOrganizations.length > 0 ? "existing" : "new",
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    initialOrganization?.id ?? "",
  );
  const [existingOrganizationId, setExistingOrganizationId] = useState(
    initialOrganization?.id ?? initialOrganizations[0]?.id ?? "",
  );
  const [organizationName, setOrganizationName] = useState(initialOrganization?.legalName ?? "");
  const [ein, setEin] = useState(initialOrganization?.ein ?? "");
  const [mission, setMission] = useState(initialOrganization?.mission ?? "");
  const [opportunityUrl, setOpportunityUrl] = useState("");
  const [opportunityText, setOpportunityText] = useState("");
  const [latestOpportunity, setLatestOpportunity] = useState<OpportunityRecord | null>(null);
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<OpportunityAnalysisResult | null>(null);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([
    { key: "parse", label: "Parsing opportunity...", status: "pending" },
    { key: "research", label: "Researching funder...", status: "pending" },
    { key: "fit", label: "Computing fit score...", status: "pending" },
    { key: "evidence", label: "Mapping evidence...", status: "pending" },
  ]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const progressPercent = useMemo(() => (currentStep / 4) * 100, [currentStep]);
  const selectedExistingOrganization =
    organizations.find((record) => record.id === existingOrganizationId) ??
    (workspaceMode === "existing" && organizations.length === 1 ? organizations[0] : null);
  const activeOrganizationId =
    normalizeText(activeWorkspaceId) ||
    normalizeText(organization?.id) ||
    normalizeText(existingOrganizationId) ||
    null;
  const activeOrganization =
    organization ??
    organizations.find((record) => record.id === activeOrganizationId) ??
    organizations.find((record) => record.id === existingOrganizationId) ??
    null;

  const setOrganizationDraft = (nextOrganization: OrganizationSummary | null) => {
    setOrganization(nextOrganization);
    setOrganizationName(nextOrganization?.legalName ?? "");
    setEin(nextOrganization?.ein ?? "");
    setMission(nextOrganization?.mission ?? "");
  };

  useEffect(() => {
    let cancelled = false;

    const loadNotionStatus = async () => {
      try {
        const response = await fetch("/api/backend/auth/notion/status", {
          cache: "no-store",
        });
        const payload = await parseJson<{ authenticated?: boolean; message?: string }>(response);

        if (cancelled) {
          return;
        }

        if (response.ok || response.status === 401) {
          setNotionConnected(Boolean(payload.authenticated && (payload as { bootstrap?: unknown }).bootstrap));
        }
      } catch {
        if (!cancelled) {
          setNotionConnected(false);
        }
      }
    };

    void loadNotionStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLatestOpportunity = async (organizationId: string) => {
    const response = await fetch(
      `/api/backend/opportunities?organizationId=${encodeURIComponent(organizationId)}`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error("Failed to load opportunities for onboarding.");
    }

    const payload = await parseJson<{ opportunities?: OpportunityRecord[] }>(response);
    const firstOpportunity = payload.opportunities?.[0] ?? null;
    setLatestOpportunity(firstOpportunity);
    return firstOpportunity;
  };

  const refreshOrganizations = async () => {
    const response = await fetch("/api/backend/organizations", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Failed to refresh the organization workspaces.");
    }

    const payload = await parseJson<{ organizations?: OrganizationSummary[] }>(response);
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);
    return nextOrganizations;
  };

  useEffect(() => {
    if (workspaceMode !== "existing" || organizations.length === 0) {
      return;
    }

    const hasSelectedWorkspace =
      normalizeText(existingOrganizationId) !== "" &&
      organizations.some((record) => record.id === existingOrganizationId);

    if (hasSelectedWorkspace) {
      return;
    }

    const fallbackOrganization = organizations.find((record) => normalizeText(record.id) !== "");
    if (fallbackOrganization) {
      setExistingOrganizationId(fallbackOrganization.id);
    }
  }, [existingOrganizationId, organizations, workspaceMode]);

  useEffect(() => {
    if (!activeOrganizationId) {
      setLatestOpportunity(null);
      return;
    }

    void loadLatestOpportunity(activeOrganizationId).catch(() => undefined);
  }, [activeOrganizationId]);

  useEffect(() => {
    const derivedStep =
      latestOpportunity?.id && activeOrganizationId && notionConnected
        ? 4
        : activeOrganizationId && notionConnected
          ? 3
          : notionConnected
            ? 2
            : 1;

    setFurthestStep((previousStep) => Math.max(previousStep, initialStep, derivedStep));
    if (manualStepSelection) {
      return;
    }

    if (!respectRequestedStep) {
      setCurrentStep((previousStep) => {
        const targetStep = Math.max(initialStep, derivedStep);
        return previousStep < targetStep ? targetStep : previousStep;
      });
      return;
    }

    setCurrentStep((previousStep) => {
      const targetStep = Math.max(initialStep, derivedStep);
      if (previousStep === furthestStep && previousStep < targetStep) {
        return targetStep;
      }

      return previousStep;
    });
  }, [
    furthestStep,
    initialStep,
    latestOpportunity?.id,
    manualStepSelection,
    notionConnected,
    activeOrganizationId,
    respectRequestedStep,
  ]);

  const advanceTo = (step: number) => {
    startTransition(() => {
      setManualStepSelection(false);
      setFurthestStep((previousStep) => Math.max(previousStep, step));
      setCurrentStep(step);
    });
  };

  const jumpToStep = (step: number) => {
    if (step > furthestStep) {
      return;
    }

    setError(null);
    setMessage(null);
    setManualStepSelection(true);
    setCurrentStep(step);
  };

  const handleSaveOrganization = async () => {
    setPending("organization");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        organization?.id
          ? `/api/backend/organizations/${encodeURIComponent(organization.id)}`
          : "/api/backend/organizations",
        {
          method: organization?.id ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            legalName: organizationName,
            ein,
            mission,
            syncToNotion: true,
          }),
        },
      );
      const payload = await parseJson<OrganizationSaveResult & { message?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.message || "Failed to save the organization profile.");
      }

      const persistedOrganizationId =
        normalizeText(payload.organization?.id) || normalizeText(payload.organizationId);
      if (!persistedOrganizationId) {
        throw new Error("The workspace saved, but Grant Guardian could not recover its id.");
      }

      const refreshedOrganizations = await refreshOrganizations();
      const persistedOrganization =
        payload.organization ??
        refreshedOrganizations.find((record) => record.id === persistedOrganizationId) ??
        null;

      setWorkspaceMode("existing");
      setActiveWorkspaceId(persistedOrganizationId);
      setExistingOrganizationId(persistedOrganizationId);
      if (persistedOrganization) {
        setOrganizationDraft(persistedOrganization);
      }
      setMessage(`Saved ${persistedOrganization?.legalName ?? organizationName}.`);
      advanceTo(3);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to save the organization profile.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleUseExistingOrganization = async () => {
    if (!selectedExistingOrganization) {
      setError("Choose an existing workspace before continuing.");
      return;
    }

    if (!normalizeText(selectedExistingOrganization.id)) {
      setError("That workspace could not be loaded. Refresh and try again.");
      return;
    }

    setPending("workspace");
    setError(null);
    setMessage(null);

    try {
      setWorkspaceMode("existing");
      setActiveWorkspaceId(selectedExistingOrganization.id);
      setOrganizationDraft(selectedExistingOrganization);
      await loadLatestOpportunity(selectedExistingOrganization.id);

      if (selectedExistingOrganization.onboardingCompleted) {
        router.push(`/dashboard?organizationId=${encodeURIComponent(selectedExistingOrganization.id)}`);
        return;
      }

      setMessage(`Opened ${selectedExistingOrganization.legalName}.`);
      advanceTo(3);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to open the selected workspace.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleStartNewWorkspace = () => {
    setWorkspaceMode("new");
    setActiveWorkspaceId("");
    setExistingOrganizationId("");
    setOrganizationDraft(null);
    setLatestOpportunity(null);
    setIntakeResult(null);
    setAnalysisResult(null);
    setMessage(null);
    setError(null);
    setManualStepSelection(true);
    setCurrentStep(2);
    setFurthestStep((previousStep) => Math.max(previousStep, 2));
  };

  const handleRunIntake = async () => {
    setPending("intake");
    setError(null);
    setMessage(null);

    try {
      let organizationIdForIntake = activeOrganizationId;
      if (!organizationIdForIntake) {
        const refreshedOrganizations = await refreshOrganizations();
        const recoveredOrganization =
          refreshedOrganizations.find((record) => record.id === existingOrganizationId) ??
          refreshedOrganizations.find(
            (record) =>
              normalizeText(record.ein) === normalizeText(ein) ||
              normalizeText(record.legalName).toLowerCase() === normalizeText(organizationName).toLowerCase(),
          ) ??
          null;

        if (recoveredOrganization) {
          organizationIdForIntake = recoveredOrganization.id;
          setActiveWorkspaceId(recoveredOrganization.id);
          setExistingOrganizationId(recoveredOrganization.id);
          setOrganizationDraft(recoveredOrganization);
        }
      }

      if (!organizationIdForIntake) {
        throw new Error("Save the organization profile before adding the first opportunity.");
      }

      const response = await fetch("/api/backend/intake/opportunity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: organizationIdForIntake,
          url: normalizeUrlInput(opportunityUrl) || undefined,
          rawText: normalizeText(opportunityText) || undefined,
          syncToNotion: true,
        }),
      });
      const payload = await parseJson<IntakeResult & { message?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.message || "Failed to intake the first opportunity.");
      }

      setIntakeResult(payload);
      setLatestOpportunity({
        id: payload.persisted.opportunityId,
        title: payload.parsed.title,
        funderId: payload.persisted.funderId,
      });
      setMessage(`Captured '${payload.parsed.title}' and moved it into your workspace.`);
      advanceTo(4);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to intake the first opportunity.",
      );
    } finally {
      setPending(null);
    }
  };

  const markProgress = (key: ProgressStep["key"], status: ProgressStep["status"]) => {
    setProgressSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, status } : step)),
    );
  };

  const handleRunAnalysis = async () => {
    const opportunityToAnalyze =
      latestOpportunity ??
      (intakeResult
        ? {
            id: intakeResult.persisted.opportunityId,
            title: intakeResult.parsed.title,
            funderId: intakeResult.persisted.funderId,
          }
        : null);

    if (!opportunityToAnalyze) {
      setError("Add your first opportunity before running the first analysis.");
      return;
    }

    setPending("analysis");
    setError(null);
    setMessage(null);
    setAnalysisResult(null);
    setProgressSteps([
      { key: "parse", label: "Parsing opportunity...", status: "active" },
      { key: "research", label: "Researching funder...", status: "pending" },
      { key: "fit", label: "Computing fit score...", status: "pending" },
      { key: "evidence", label: "Mapping evidence...", status: "pending" },
    ]);

    try {
      if (notionConnected) {
        const bootstrapResponse = await fetch("/api/backend/notion/bootstrap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const bootstrapPayload = await parseJson<{ message?: string }>(bootstrapResponse);
        if (!bootstrapResponse.ok) {
          throw new Error(
            bootstrapPayload.message ||
              "Your Notion workspace is connected, but Grant Guardian could not finish preparing its databases yet.",
          );
        }
      }

      markProgress("parse", "complete");
      markProgress("research", "active");

      const enrichResponse = await fetch(
        `/api/backend/funders/${encodeURIComponent(opportunityToAnalyze.funderId)}/enrich`,
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
      const enrichPayload = await parseJson<{ message?: string }>(enrichResponse);
      if (!enrichResponse.ok) {
        throw new Error(enrichPayload.message || "Failed to research the funder.");
      }

      const parseResponse = await fetch(
        `/api/backend/funders/${encodeURIComponent(opportunityToAnalyze.funderId)}/parse-filings`,
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
      if (!parseResponse.ok) {
        const parsePayload = await parseJson<{ message?: string }>(parseResponse);
        console.warn(
          parsePayload.message ||
            "Filing parsing could not finish during onboarding, so some 990 metrics may still be limited.",
        );
      } else {
        await parseJson(parseResponse);
      }

      markProgress("research", "complete");
      markProgress("fit", "active");

      const analysisResponse = await fetch(
        `/api/backend/opportunities/${encodeURIComponent(opportunityToAnalyze.id)}/analyze`,
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
      const analysisPayload = await parseJson<OpportunityAnalysisResult & { message?: string }>(
        analysisResponse,
      );
      if (!analysisResponse.ok) {
        throw new Error(analysisPayload.message || "Failed to analyze the opportunity.");
      }

      markProgress("fit", "complete");
      markProgress("evidence", "active");
      markProgress("evidence", "complete");
      setAnalysisResult(analysisPayload);
      setMessage("Your first analysis is ready. Review the summary, then open the dashboard.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to run the first analysis.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!activeOrganizationId || !activeOrganization) {
      setError("Save the organization profile before finishing onboarding.");
      return;
    }

    setPending("complete");
    setError(null);

    try {
      const response = await fetch(
        `/api/backend/organizations/${encodeURIComponent(activeOrganizationId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            legalName: activeOrganization.legalName,
            ein: activeOrganization.ein,
            mission: activeOrganization.mission,
            syncToNotion: true,
            onboardingCompleted: true,
          }),
        },
      );
      const payload = await parseJson<{ message?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.message || "Failed to complete onboarding.");
      }

      router.push(`/dashboard?organizationId=${encodeURIComponent(activeOrganizationId)}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to complete onboarding.",
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(196,143,44,0.22), transparent 30%), linear-gradient(180deg, #f7f1e4 0%, #fffdfa 48%, #f5efe5 100%)",
        padding: "40px 20px 80px",
        color: "#1f2933",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <section
          style={{
            ...shellCardStyle,
            background:
              "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,255,255,0.86) 100%)",
          }}
        >
          <p
            style={{
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#916b22",
              fontSize: 12,
              margin: 0,
            }}
          >
            Guided Onboarding
          </p>
          <h1
            style={{
              fontFamily:
                '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "clamp(2.2rem, 4.5vw, 4rem)",
              lineHeight: 1.03,
              margin: "14px 0 14px",
            }}
          >
            Set up Grant Guardian the way a real team will actually use it
          </h1>
          <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 0, maxWidth: 860 }}>
            Connect your own Notion workspace, describe your organization, add one real grant
            opportunity, and run the first full analysis. After that, the dashboard becomes your
            working system instead of a blank control panel.
          </p>

          <div style={{ marginTop: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ color: "#6b5d46", fontSize: 14 }}>Step {currentStep} of 4</div>
              <div style={{ color: "#5e5241", fontSize: 14 }}>
                {currentStep === 1
                  ? "Connect Notion"
                  : currentStep === 2
                    ? "Choose workspace"
                    : currentStep === 3
                      ? "Add first opportunity"
                      : "Run first analysis"}
              </div>
            </div>
            <div
              style={{
                marginTop: 10,
                height: 10,
                borderRadius: 999,
                background: "rgba(73, 63, 46, 0.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: "#0f766e",
                }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 10,
                marginTop: 16,
              }}
            >
              {[
                "Connect Notion",
                "Choose workspace",
                "Add opportunity",
                "Run analysis",
              ].map((title, index) => {
                const stepNumber = index + 1;
                const active = currentStep === stepNumber;
                const complete = currentStep > stepNumber;
                const reachable = stepNumber <= furthestStep;

                return (
                  <button
                    key={title}
                    type="button"
                    onClick={() => jumpToStep(stepNumber)}
                    disabled={!reachable}
                    style={{
                      appearance: "none",
                      textAlign: "left",
                      width: "100%",
                      borderRadius: 16,
                      border: active
                        ? "1px solid rgba(15, 118, 110, 0.22)"
                        : "1px solid rgba(73, 63, 46, 0.14)",
                      background: active ? "rgba(15, 118, 110, 0.08)" : "#fffdf8",
                      padding: 14,
                      cursor: reachable ? "pointer" : "not-allowed",
                      opacity: reachable ? 1 : 0.6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: complete ? "#15803d" : "#6b5d46",
                      }}
                    >
                      {complete ? "Complete" : reachable ? `Step ${stepNumber}` : "Locked"}
                    </div>
                    <div style={{ marginTop: 8, color: "#2d251a" }}>{title}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section style={{ ...shellCardStyle, marginTop: 24 }}>
          {currentStep === 1 ? (
            <>
              <p style={labelStyle}>Step 1</p>
              <h2
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "2rem",
                  margin: "0 0 10px",
                }}
              >
                Connect Notion
              </h2>
              <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
                Grant Guardian keeps all your grant records, drafts, funder intelligence, and task
                lists inside your Notion workspace. Connect it once and everything syncs
                automatically.
              </p>
              <NotionConnectionCard
                onStatusChange={(status) => {
                  const ready = Boolean(status?.authenticated && status?.bootstrap);
                  setNotionConnected(ready);
                }}
              />
            </>
          ) : null}

          {currentStep === 2 ? (
            <>
              <p style={labelStyle}>Step 2</p>
              <h2
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "2rem",
                  margin: "0 0 10px",
                }}
              >
                Tell us about your organization
              </h2>
              <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
                Choose an existing workspace if you already set one up on this machine, or create a
                new one for a different nonprofit team.
              </p>

              {organizations.length > 0 ? (
                <div
                  style={{
                    border: "1px solid rgba(73, 63, 46, 0.14)",
                    borderRadius: 18,
                    padding: 18,
                    background: "#fffdf8",
                    marginTop: 18,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 16,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Choose an existing workspace</label>
                      <select
                        style={inputStyle}
                        value={existingOrganizationId}
                        onChange={(event) => {
                          setExistingOrganizationId(event.target.value);
                          setMessage(null);
                          setError(null);
                        }}
                      >
                        <option value="">Select a workspace</option>
                        {organizations.map((record) => (
                          <option key={record.id} value={record.id}>
                            {record.dbaName || record.legalName}
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
                      {selectedExistingOrganization
                        ? `${selectedExistingOrganization.legalName} is ready to open.`
                        : "Pick a workspace to continue from where you left off."}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      marginTop: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      style={buttonStyle("primary")}
                      onClick={() => void handleUseExistingOrganization()}
                      disabled={!selectedExistingOrganization || pending === "workspace"}
                    >
                      {pending === "workspace" ? "Opening..." : "Use selected workspace"}
                    </button>
                    <button
                      type="button"
                      style={buttonStyle()}
                      onClick={handleStartNewWorkspace}
                    >
                      Create a new workspace
                    </button>
                  </div>
                </div>
              ) : null}

              {workspaceMode === "new" || organizations.length === 0 ? (
                <div
                  style={{
                    border: "1px solid rgba(73, 63, 46, 0.14)",
                    borderRadius: 18,
                    padding: 18,
                    background: "#fffdf8",
                    marginTop: 18,
                  }}
                >
                  <div style={{ ...labelStyle, marginBottom: 10 }}>
                    {organizations.length > 0 ? "Or create a new workspace" : "Create your workspace"}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 16,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Organization name</label>
                      <input
                        style={inputStyle}
                        value={organizationName}
                        onChange={(event) => setOrganizationName(event.target.value)}
                        placeholder="Bright Path Youth Collective"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>EIN</label>
                      <input
                        style={inputStyle}
                        value={ein}
                        onChange={(event) => setEin(event.target.value)}
                        placeholder="12-3456789"
                      />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Mission</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 140, resize: "vertical" }}
                        value={mission}
                        onChange={(event) => setMission(event.target.value)}
                        placeholder="e.g. Bright Path Youth Collective equips low-income middle-school students in South Chicago with literacy coaching, mentoring, and family wraparound support."
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      marginTop: 18,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      style={buttonStyle("primary")}
                      onClick={() => void handleSaveOrganization()}
                      disabled={
                        pending === "organization" ||
                        !normalizeText(organizationName) ||
                        !normalizeText(ein) ||
                        !normalizeText(mission)
                      }
                    >
                      {pending === "organization" ? "Saving..." : "Save organization"}
                    </button>
                    {organizations.length > 0 ? (
                      <button type="button" style={buttonStyle()} onClick={() => setWorkspaceMode("existing")}>
                        Back to existing workspaces
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {currentStep === 3 ? (
            <>
              <p style={labelStyle}>Step 3</p>
              <h2
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "2rem",
                  margin: "0 0 10px",
                }}
              >
                Paste a grant opportunity you're considering
              </h2>
              <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
                You can paste the funder's website URL, a direct link to their RFP, or copy-paste
                the application instructions text. Grant Guardian will extract the questions,
                deadlines, and requirements automatically.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                  marginTop: 18,
                }}
              >
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Opportunity URL</label>
                  <input
                    style={inputStyle}
                    value={opportunityUrl}
                    onChange={(event) => setOpportunityUrl(event.target.value)}
                    placeholder="https://funder.org/grants/apply"
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>RFP text / application instructions</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 160, resize: "vertical" }}
                    value={opportunityText}
                    onChange={(event) => setOpportunityText(event.target.value)}
                    placeholder="Paste the application instructions text here if you do not have a clean URL."
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={buttonStyle("primary")}
                  onClick={() => void handleRunIntake()}
                  disabled={
                    pending === "intake" ||
                    (!normalizeText(opportunityUrl) && !normalizeText(opportunityText))
                  }
                >
                  {pending === "intake" ? "Running intake..." : "Add first opportunity"}
                </button>
                <button type="button" style={buttonStyle()} onClick={() => jumpToStep(2)}>
                  Back to workspace details
                </button>
              </div>
            </>
          ) : null}

          {currentStep === 4 ? (
            <>
              <p style={labelStyle}>Step 4</p>
              <h2
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "2rem",
                  margin: "0 0 10px",
                }}
              >
                Run your first analysis
              </h2>
              <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 760 }}>
                This runs the first real grant pass: intake confirmation, funder research, fit
                scoring, and evidence coverage.
              </p>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={buttonStyle("primary")}
                  onClick={() => void handleRunAnalysis()}
                  disabled={pending === "analysis" || !latestOpportunity?.id}
                >
                  {pending === "analysis" ? "Analyzing..." : "Analyze this opportunity"}
                </button>
                <button type="button" style={buttonStyle()} onClick={() => jumpToStep(3)}>
                  Back to opportunity
                </button>
                {latestOpportunity ? (
                  <span style={{ color: "#5e5241" }}>
                    Opportunity: <strong>{latestOpportunity.title}</strong>
                  </span>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
                {progressSteps.map((step) => (
                  <div
                    key={step.key}
                    style={{
                      borderRadius: 16,
                      border: "1px solid rgba(73, 63, 46, 0.14)",
                      background:
                        step.status === "complete"
                          ? "rgba(22, 163, 74, 0.08)"
                          : step.status === "active"
                            ? "rgba(15, 118, 110, 0.08)"
                            : "#fffdf8",
                      padding: 16,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span>{step.label}</span>
                    <span
                      style={{
                        color:
                          step.status === "complete"
                            ? "#15803d"
                            : step.status === "active"
                              ? "#0f766e"
                              : "#6b5d46",
                      }}
                    >
                      {step.status === "complete"
                        ? "Done"
                        : step.status === "active"
                          ? "Running"
                          : "Waiting"}
                    </span>
                  </div>
                ))}
              </div>

              {analysisResult ? (
                <article style={{ ...shellCardStyle, marginTop: 20, background: "#fffdf8" }}>
                  <p style={labelStyle}>First analysis summary</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 16,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b5d46" }}>
                        Fit score
                      </div>
                      <div style={{ fontSize: "2rem", marginTop: 8 }}>
                        {analysisResult.scoring.fitScore}%
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b5d46" }}>
                        Evidence coverage
                      </div>
                      <div style={{ fontSize: "2rem", marginTop: 8 }}>
                        {analysisResult.scoring.evidenceCoveragePercent}%
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b5d46" }}>
                        Recommendation
                      </div>
                      <div style={{ fontSize: "1.4rem", marginTop: 12 }}>
                        {analysisResult.scoring.pursueDecision}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
                    <button
                      type="button"
                      style={buttonStyle("primary")}
                      onClick={() => void handleCompleteOnboarding()}
                      disabled={pending === "complete"}
                    >
                      {pending === "complete" ? "Opening workspace..." : "Go to your workspace"}
                    </button>
                  </div>
                </article>
              ) : null}
            </>
          ) : null}

          {message ? (
            <p style={{ color: "#14532d", marginTop: 18, marginBottom: 0 }}>{message}</p>
          ) : null}
          {error ? (
            <p style={{ color: "#991b1b", marginTop: 18, marginBottom: 0 }}>{error}</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
