"use client";

import { useEffect, useState } from "react";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  shellCardStyle,
} from "./opportunity-page-styles";

type PortalReadiness = {
  preferredBrowserUrl?: string | null;
  level: "Ready" | "Needs Review" | "Blocked";
  kind: string;
  blockers: string[];
  warnings: string[];
};

type SubmissionSessionDetailResult = {
  submissionSessionId: string;
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  organizationId?: string | null;
  submissionRecord: {
    id: string;
    method?: string | null;
    adapterKey?: string | null;
    portalReference?: string | null;
    budgetIncluded: boolean;
    narratives: Array<{
      requirementId?: string;
      questionText?: string;
      draftAnswerId?: string;
      wordCount?: number;
      evidenceCitations?: string[];
    }>;
    attachments: Array<{
      requirementId?: string;
      questionText?: string;
      artifactType?: string;
      included?: boolean;
      selectedSources?: Array<{
        id?: string;
        title?: string;
        type?: string;
        status?: string;
      }>;
    }>;
  };
  submissionMethod?: string | null;
  adapterKey?: string | null;
  launchStatus: string;
  launchMode: string;
  portalUrl: string;
  portalReadiness: PortalReadiness;
  launchRequestedAt: string;
  launchTriggeredAt?: string | null;
  launchCommand?: string | null;
  storageStatePath?: string | null;
  storageStatePresent: boolean;
  reviewerName?: string | null;
  reviewerNotes?: string | null;
  finalSubmitAuthorized: boolean;
  finalSubmitAuthorizedAt?: string | null;
  mappingSummary: {
    totalMappings: number;
    narrativeMappings: number;
    attachmentMappings: number;
    manualReviewCount: number;
    uploadReadyCount: number;
  };
  mappings: Array<{
    id: string;
    requirementId?: string | null;
    fieldLabel: string;
    fieldType: string;
    sourceKind: string;
    sourceRecordId?: string | null;
    fillAction: string;
    mappingStatus: string;
    plannedValue?: string | null;
    artifactTitle?: string | null;
    matchedPortalLabel?: string | null;
    confidence?: number | null;
    needsHumanReview: boolean;
    notes?: string | null;
    lastAttemptedAt?: string | null;
  }>;
  artifactSummary: {
    totalArtifacts: number;
    stagedArtifacts: number;
    generatedArtifacts: number;
    missingArtifacts: number;
  };
  artifacts: Array<{
    id: string;
    requirementId: string;
    sourceKind: string;
    sourceRecordId?: string | null;
    artifactTitle: string;
    fileName?: string | null;
    mimeType?: string | null;
    originalPath?: string | null;
    stagedPath?: string | null;
    stagingStatus: string;
    byteSize?: number | null;
    notes?: string | null;
  }>;
  portalProfiles: {
    portalUrl: string;
    portalHost: string;
    portalPath: string;
    profileSummary: {
      totalProfiles: number;
      matchedProfiles: number;
      previouslyLearnedMappings: number;
    };
    profiles: Array<{
      id: string;
      fieldLabel: string;
      fieldType: "Long Text" | "File Upload";
      occurrenceIndex: number;
      timesSeen: number;
      timesMatched: number;
      lastMappedFieldLabel?: string | null;
      lastFillAction?: string | null;
      lastConfidence?: number | null;
    }>;
  };
  actionState: {
    canStageUploadArtifacts: boolean;
    canPrepareFormFill: boolean;
    canAuthorizeFinalSubmit: boolean;
    requiresSecondHumanConfirmation: boolean;
  };
};

type SubmissionUploadStagingResult = {
  artifactSummary: SubmissionSessionDetailResult["artifactSummary"];
  artifacts: SubmissionSessionDetailResult["artifacts"];
  notionSync?: {
    submissionPageId: string;
  };
};

type PortalFieldPlanResult = {
  mappingSummary: SubmissionSessionDetailResult["mappingSummary"];
  mappings: SubmissionSessionDetailResult["mappings"];
  guidedFillCommand: string;
  notionSync?: {
    submissionPageId: string;
  };
};

type FinalSubmitAuthorizationResult = {
  reviewerName: string;
  reviewerNotes?: string;
  finalSubmitAuthorizedAt: string;
  notionSync?: {
    submissionPageId: string;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const buildQuery = (organizationId?: string | null) => {
  const query = new URLSearchParams();
  if (organizationId) {
    query.set("organizationId", organizationId);
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
};

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

const formatTimestamp = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Not yet";
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatConfidence = (value?: number | null) => {
  if (typeof value !== "number") {
    return "n/a";
  }

  return `${Math.round(value * 100)}%`;
};

type SubmissionSessionClientProps = {
  opportunityId: string;
  submissionSessionId: string;
  organizationId?: string | null;
  defaultReviewer?: string | null;
};

export function SubmissionSessionClient({
  opportunityId,
  submissionSessionId,
  organizationId,
  defaultReviewer,
}: SubmissionSessionClientProps) {
  const [detail, setDetail] = useState<SubmissionSessionDetailResult | null>(null);
  const [reviewerName, setReviewerName] = useState(defaultReviewer ?? "");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [lastGuidedFillCommand, setLastGuidedFillCommand] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/backend/opportunities/${opportunityId}/submission-sessions/${submissionSessionId}${buildQuery(
        organizationId,
      )}`,
      {
        cache: "no-store",
        signal,
      },
    );
    const payload = (await response.json()) as SubmissionSessionDetailResult & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load the submission session.");
    }

    setDetail(payload);
    return payload;
  };

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      try {
        const payload = await loadDetail(controller.signal);
        setReviewerName((current) =>
          normalizeText(current) ? current : normalizeText(payload.reviewerName) || defaultReviewer || "",
        );
        setReviewerNotes((current) =>
          normalizeText(current) ? current : normalizeText(payload.reviewerNotes) || "",
        );
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the submission session.",
        );
      }
    };

    void run();
    return () => controller.abort();
  }, [defaultReviewer, opportunityId, organizationId, submissionSessionId]);

  const runAction = async (key: string, action: () => Promise<string>) => {
    setPendingKey(key);
    setMessage(null);
    setError(null);

    try {
      const nextMessage = await action();
      setMessage(nextMessage);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Submission session action failed.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const refreshDetail = async () => {
    const payload = await loadDetail();
    setReviewerName((current) =>
      normalizeText(current) ? current : normalizeText(payload.reviewerName) || defaultReviewer || "",
    );
  };

  const stageUploads = async () => {
    await runAction("stage-uploads", async () => {
      const response = await fetch(
        `/api/backend/submission-sessions/${submissionSessionId}/stage-upload-artifacts`,
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
      const payload = (await response.json()) as SubmissionUploadStagingResult & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to stage upload artifacts.");
      }

      await refreshDetail();
      return `Staged ${payload.artifactSummary.totalArtifacts} upload artifact(s).${syncSuffix(payload)}`;
    });
  };

  const prepareFieldPlan = async () => {
    await runAction("prepare-field-plan", async () => {
      const response = await fetch(
        `/api/backend/submission-sessions/${submissionSessionId}/prepare-form-fill`,
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
      const payload = (await response.json()) as PortalFieldPlanResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to prepare the portal field plan.");
      }

      setLastGuidedFillCommand(payload.guidedFillCommand);
      await refreshDetail();
      return `Prepared ${payload.mappingSummary.totalMappings} field mapping(s).${syncSuffix(payload)}`;
    });
  };

  const authorizeFinalSubmit = async () => {
    await runAction("authorize-final-submit", async () => {
      const response = await fetch(
        `/api/backend/submission-sessions/${submissionSessionId}/authorize-final-submit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirmFinalSubmit: true,
            reviewerName: normalizeText(reviewerName) || undefined,
            reviewerNotes: normalizeText(reviewerNotes) || undefined,
            syncToNotion: true,
          }),
        },
      );
      const payload = (await response.json()) as FinalSubmitAuthorizationResult & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to record final submit authorization.");
      }

      await refreshDetail();
      return `Recorded the second human confirmation at ${formatTimestamp(payload.finalSubmitAuthorizedAt)}.${syncSuffix(
        payload,
      )}`;
    });
  };

  return (
    <section style={shellCardStyle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Session status</div>
          <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
            {detail?.launchStatus ?? "Loading..."}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {detail ? `${detail.launchMode} · ${detail.submissionMethod ?? "Unknown method"}` : ""}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Upload packaging</div>
          <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
            {detail ? detail.artifactSummary.totalArtifacts : 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Ready uploads: {detail?.mappingSummary.uploadReadyCount ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Field plan</div>
          <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
            {detail?.mappingSummary.totalMappings ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Manual review fields: {detail?.mappingSummary.manualReviewCount ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Final confirmation</div>
          <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
            {detail?.finalSubmitAuthorized ? "Authorized" : "Pending"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {detail?.finalSubmitAuthorizedAt
              ? `Recorded ${formatTimestamp(detail.finalSubmitAuthorizedAt)}`
              : detail?.actionState.requiresSecondHumanConfirmation
                ? "Second human confirmation still required."
                : "This session does not use the browser final-submit flow."}
          </p>
        </article>
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
          <label style={labelStyle}>Reviewer name</label>
          <input
            style={inputStyle}
            value={reviewerName}
            onChange={(event) => setReviewerName(event.target.value)}
            placeholder="Maya Patel"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Reviewer notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
            value={reviewerNotes}
            onChange={(event) => setReviewerNotes(event.target.value)}
            placeholder="Confirmed staged files, field mappings, and the final human go-ahead."
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button
          style={buttonStyle("primary")}
          onClick={() => void stageUploads()}
          disabled={pendingKey !== null || !detail?.actionState.canStageUploadArtifacts}
        >
          {pendingKey === "stage-uploads" ? "Staging uploads..." : "Stage upload artifacts"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void prepareFieldPlan()}
          disabled={pendingKey !== null || !detail?.actionState.canPrepareFormFill}
        >
          {pendingKey === "prepare-field-plan" ? "Preparing field plan..." : "Prepare field plan"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() =>
            void runAction("refresh-session", async () => {
              await refreshDetail();
              return "Submission session refreshed.";
            })
          }
          disabled={pendingKey !== null}
        >
          {pendingKey === "refresh-session" ? "Refreshing..." : "Refresh session"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void authorizeFinalSubmit()}
          disabled={pendingKey !== null || !detail?.actionState.canAuthorizeFinalSubmit}
        >
          {pendingKey === "authorize-final-submit"
            ? "Recording confirmation..."
            : "Authorize final submit"}
        </button>
        {message ? <span style={{ color: "#14532d" }}>{message}</span> : null}
        {error ? <span style={{ color: "#991b1b" }}>{error}</span> : null}
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Session operating record</div>
        <p style={{ color: "#5c5140", marginTop: 0, lineHeight: 1.7 }}>
          This page is the last-mile checklist for the grant. Stage the local files, prepare the
          field plan, then record the second human confirmation before anyone clicks submit in the
          browser.
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          <article style={{ ...shellCardStyle, padding: 18 }}>
            <div style={labelStyle}>Portal handoff</div>
            <p style={{ marginTop: 0, color: "#5c5140", lineHeight: 1.7 }}>
              {detail?.portalUrl ?? "Loading..."}
            </p>
            <p style={{ margin: "10px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
              Readiness: {detail?.portalReadiness.level ?? "Loading..."} ·{" "}
              {detail?.portalReadiness.kind ?? "unknown"}
            </p>
            <p style={{ margin: "10px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
              Browser session:{" "}
              {detail?.storageStatePresent
                ? "Saved and ready for portal work."
                : "Missing or expired. Re-save the browser session before launch."}
            </p>
            {detail?.launchCommand ? (
              <pre
                style={{
                  margin: "14px 0 0",
                  padding: 14,
                  borderRadius: 16,
                  background: "#f6f1e8",
                  color: "#2d251a",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {detail.launchCommand}
              </pre>
            ) : null}
            {lastGuidedFillCommand ? (
              <pre
                style={{
                  margin: "14px 0 0",
                  padding: 14,
                  borderRadius: 16,
                  background: "#eefbf7",
                  color: "#134e4a",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {lastGuidedFillCommand}
              </pre>
            ) : null}
          </article>

          <article style={{ ...shellCardStyle, padding: 18 }}>
            <div style={labelStyle}>Packet included in this session</div>
            <p style={{ marginTop: 0, color: "#5c5140", lineHeight: 1.7 }}>
              {detail?.submissionRecord.portalReference ?? "No packet summary available yet."}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              <div>
                <div style={labelStyle}>Narratives</div>
                <div style={{ color: "#2d251a" }}>
                  {detail?.submissionRecord.narratives.length ?? 0}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Attachments</div>
                <div style={{ color: "#2d251a" }}>
                  {detail?.submissionRecord.attachments.length ?? 0}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Budget support</div>
                <div style={{ color: "#2d251a" }}>
                  {detail?.submissionRecord.budgetIncluded ? "Included" : "Not included"}
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Upload artifacts</div>
        {detail?.artifacts.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {detail.artifacts.map((artifact) => (
              <article key={artifact.id} style={{ ...shellCardStyle, padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>
                      {artifact.artifactTitle}
                    </h3>
                    <p style={{ margin: 0, color: "#5c5140", lineHeight: 1.7 }}>
                      {artifact.fileName ?? "No staged file name yet"}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                      {artifact.notes ?? "No staging notes yet."}
                    </p>
                  </div>
                  <div
                    style={{
                      borderRadius: 999,
                      padding: "8px 12px",
                      background:
                        artifact.stagingStatus === "Staged"
                          ? "rgba(16, 185, 129, 0.12)"
                          : artifact.stagingStatus === "Generated"
                            ? "rgba(15, 118, 110, 0.12)"
                            : "rgba(220, 38, 38, 0.12)",
                      color:
                        artifact.stagingStatus === "Missing Source"
                          ? "#991b1b"
                          : artifact.stagingStatus === "Generated"
                            ? "#115e59"
                            : "#166534",
                      alignSelf: "flex-start",
                    }}
                  >
                    {artifact.stagingStatus}
                  </div>
                </div>
                <p style={{ margin: "12px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                  Staged path: {artifact.stagedPath ?? "Not staged yet"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            No upload artifacts have been staged yet. Run staging to prepare the actual local files
            the browser handoff will use.
          </p>
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Field plan and profile hints</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <article style={{ ...shellCardStyle, padding: 18 }}>
            <div style={labelStyle}>Profile reuse</div>
            <div style={{ fontSize: "1.35rem", marginTop: 8 }}>
              {detail?.portalProfiles.profileSummary.previouslyLearnedMappings ?? 0}
            </div>
            <p style={{ color: "#5c5140", marginBottom: 0 }}>
              Learned mappings already available for this portal.
            </p>
          </article>
          <article style={{ ...shellCardStyle, padding: 18 }}>
            <div style={labelStyle}>Matched profile hints</div>
            <div style={{ fontSize: "1.35rem", marginTop: 8 }}>
              {detail?.portalProfiles.profileSummary.matchedProfiles ?? 0}
            </div>
            <p style={{ color: "#5c5140", marginBottom: 0 }}>
              Profiles with historical matches on this same portal scope.
            </p>
          </article>
        </div>

        {detail?.mappings.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {detail.mappings.map((mapping) => (
              <article key={mapping.id} style={{ ...shellCardStyle, padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>
                      {mapping.fieldLabel}
                    </h3>
                    <p style={{ margin: 0, color: "#5c5140", lineHeight: 1.7 }}>
                      {mapping.fieldType} · {mapping.fillAction} · {mapping.sourceKind}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                      {mapping.notes ?? "No mapping notes yet."}
                    </p>
                  </div>
                  <div
                    style={{
                      borderRadius: 999,
                      padding: "8px 12px",
                      background: mapping.needsHumanReview
                        ? "rgba(220, 38, 38, 0.12)"
                        : "rgba(16, 185, 129, 0.12)",
                      color: mapping.needsHumanReview ? "#991b1b" : "#166534",
                      alignSelf: "flex-start",
                    }}
                  >
                    {mapping.needsHumanReview ? "Human review" : "Ready"}
                  </div>
                </div>
                <p style={{ margin: "12px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                  Confidence: {formatConfidence(mapping.confidence)}
                  {mapping.artifactTitle ? ` · Artifact ${mapping.artifactTitle}` : ""}
                </p>
                {mapping.plannedValue ? (
                  <pre
                    style={{
                      margin: "12px 0 0",
                      padding: 14,
                      borderRadius: 16,
                      background: "#f6f1e8",
                      color: "#2d251a",
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {mapping.plannedValue}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            No field plan yet. Prepare the form-fill step to see the exact values and uploads that
            will be used for the portal handoff.
          </p>
        )}
      </div>

      {detail?.portalProfiles.profiles.length ? (
        <div style={{ marginTop: 22 }}>
          <div style={labelStyle}>Learned portal profiles</div>
          <div style={{ display: "grid", gap: 14 }}>
            {detail.portalProfiles.profiles.slice(0, 6).map((profile) => (
              <article key={profile.id} style={{ ...shellCardStyle, padding: 18 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>{profile.fieldLabel}</h3>
                <p style={{ margin: 0, color: "#5c5140", lineHeight: 1.7 }}>
                  {profile.fieldType} · seen {profile.timesSeen} time(s) · matched {profile.timesMatched} time(s)
                </p>
                <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                  Last mapped field: {profile.lastMappedFieldLabel ?? "Not learned yet"}
                  {profile.lastFillAction ? ` · ${profile.lastFillAction}` : ""}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
