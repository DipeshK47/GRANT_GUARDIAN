"use client";

import Link from "next/link";
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

type SubmissionSessionListResult = {
  opportunityId: string;
  opportunityTitle: string;
  submissionSessions: Array<{
    id: string;
    status: string;
    launchMode: string;
    adapterKey?: string | null;
    portalUrl: string;
    portalReadiness: PortalReadiness;
    launchRequestedAt: string;
    launchTriggeredAt?: string | null;
    finalSubmitAuthorized: boolean;
    reviewerName?: string | null;
    storageStatePresent: boolean;
    updatedAt: string;
  }>;
};

type SubmissionReadiness = {
  readyForSubmission: boolean;
  readyStatus: string;
  stage: string;
  blockerCount: number;
  blockers: string[];
  reviewCoveragePercent: number;
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

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

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

type SubmissionClientProps = {
  opportunityId: string;
  portalReadiness: PortalReadiness;
  organizationId?: string | null;
  defaultReviewer?: string | null;
};

const buildQuery = (organizationId?: string | null) => {
  const query = new URLSearchParams();
  if (organizationId) {
    query.set("organizationId", organizationId);
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
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

export function SubmissionClient({
  opportunityId,
  portalReadiness,
  organizationId,
  defaultReviewer,
}: SubmissionClientProps) {
  const [reviewerName, setReviewerName] = useState(defaultReviewer ?? "");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packet, setPacket] = useState<SubmissionPacketResult | null>(null);
  const [launch, setLaunch] = useState<AutopilotLaunchResult | null>(null);
  const [sessionList, setSessionList] = useState<SubmissionSessionListResult | null>(null);

  const runAction = async (
    key: string,
    action: () => Promise<string>,
  ) => {
    setPendingKey(key);
    setMessage(null);
    setError(null);

    try {
      const nextMessage = await action();
      setMessage(nextMessage);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Submission workflow failed.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const refreshSubmissionSessions = async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/backend/opportunities/${opportunityId}/submission-sessions${buildQuery(organizationId)}`,
      {
        cache: "no-store",
        signal,
      },
    );
    const payload = (await response.json()) as SubmissionSessionListResult & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load submission sessions.");
    }

    setSessionList(payload);
    return payload;
  };

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        await refreshSubmissionSessions(controller.signal);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load submission sessions.",
        );
      }
    };

    void load();
    return () => controller.abort();
  }, [opportunityId, organizationId]);

  const assembleSubmission = async () => {
    await runAction("assemble", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${opportunityId}/assemble-submission`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirmAutopilot: true,
            syncToNotion: true,
          }),
        },
      );
      const payload = (await response.json()) as SubmissionPacketResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to assemble the submission packet.");
      }
      setPacket(payload);
      return `Submission packet assembled.${syncSuffix(payload)}`;
    });
  };

  const launchAutopilot = async (launchBrowser: boolean) => {
    await runAction(launchBrowser ? "browser" : "handoff", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${opportunityId}/launch-autopilot`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirmLaunch: true,
            launchBrowser,
            reviewerName: normalizeText(reviewerName) || undefined,
            reviewerNotes: normalizeText(reviewerNotes) || undefined,
            syncToNotion: true,
          }),
        },
      );
      const payload = (await response.json()) as AutopilotLaunchResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to prepare the submission handoff.");
      }
      setLaunch(payload);
      await refreshSubmissionSessions();
      return `${payload.launchMode} prepared.${syncSuffix(payload)}`;
    });
  };

  const openSessionHref = (submissionSessionId: string) =>
    organizationId
      ? `/opportunities/${opportunityId}/submission-sessions/${submissionSessionId}?organizationId=${encodeURIComponent(
          organizationId,
        )}`
      : `/opportunities/${opportunityId}/submission-sessions/${submissionSessionId}`;

  return (
    <section style={shellCardStyle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
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
          <label style={labelStyle}>Reviewer / submission notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
            value={reviewerNotes}
            onChange={(event) => setReviewerNotes(event.target.value)}
            placeholder="Ready for browser handoff after one final human check."
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button
          style={buttonStyle("primary")}
          onClick={() => void assembleSubmission()}
          disabled={pendingKey !== null}
        >
          {pendingKey === "assemble" ? "Assembling..." : "Assemble submission"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void launchAutopilot(false)}
          disabled={pendingKey !== null}
        >
          {pendingKey === "handoff" ? "Preparing handoff..." : "Prepare handoff"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void launchAutopilot(true)}
          disabled={pendingKey !== null}
        >
          {pendingKey === "browser" ? "Launching browser..." : "Launch browser handoff"}
        </button>
        {message ? <span style={{ color: "#14532d" }}>{message}</span> : null}
        {error ? <span style={{ color: "#991b1b" }}>{error}</span> : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Portal readiness</div>
          <div style={{ fontSize: "1.35rem", marginTop: 8 }}>{portalReadiness.level}</div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {portalReadiness.preferredBrowserUrl ?? "No browser-ready URL yet"}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Submission packet</div>
          <div style={{ fontSize: "1.35rem", marginTop: 8 }}>
            {packet?.adapterPlan.adapterKey ?? "Not assembled yet"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {packet
              ? `Narratives ${packet.completeness.approvedNarrativesIncluded}/${packet.completeness.requiredNarratives} · Attachments ${packet.completeness.approvedAttachmentsIncluded}/${packet.completeness.requiredAttachments}`
              : "Run assembly to see completeness and blockers."}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Latest handoff</div>
          <div style={{ fontSize: "1.35rem", marginTop: 8 }}>
            {launch?.launchMode ?? "No session yet"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {launch
              ? `Session ${launch.submissionSessionId} · ${
                  launch.storageStatePresent ? "browser session ready" : "no saved browser session"
                }`
              : sessionList?.submissionSessions[0]
                ? `Latest session ${sessionList.submissionSessions[0].id} · ${
                    sessionList.submissionSessions[0].storageStatePresent
                      ? "browser session ready"
                      : "no saved browser session"
                  }`
                : "Prepare a handoff or browser launch to create a submission session."}
          </p>
        </article>
      </div>

      {packet?.safetyGate.blockers.length ? (
        <div style={{ marginTop: 18 }}>
          <div style={labelStyle}>Current submission blockers</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#5c5140", lineHeight: 1.7 }}>
            {packet.safetyGate.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Submission sessions</div>
        <p style={{ color: "#5c5140", marginTop: 0, lineHeight: 1.7 }}>
          Each session is the last-mile operating record for the grant. Open one to stage files,
          inspect field mappings, and record the final human authorization from the website.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            style={buttonStyle()}
            onClick={() =>
              void runAction("refresh-sessions", async () => {
                await refreshSubmissionSessions();
                return "Submission sessions refreshed.";
              })
            }
            disabled={pendingKey !== null}
          >
            {pendingKey === "refresh-sessions" ? "Refreshing..." : "Refresh sessions"}
          </button>
          {launch ? (
            <Link href={openSessionHref(launch.submissionSessionId)} style={buttonStyle("primary")}>
              Open latest session
            </Link>
          ) : null}
        </div>

        {sessionList?.submissionSessions.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {sessionList.submissionSessions.map((session) => (
              <article key={session.id} style={{ ...shellCardStyle, padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "1.08rem" }}>
                      {session.launchMode}
                    </h3>
                    <p style={{ margin: 0, color: "#5c5140", lineHeight: 1.7 }}>
                      Session {session.id}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.7 }}>
                      Requested {formatTimestamp(session.launchRequestedAt)}
                      {session.reviewerName ? ` · Reviewer ${session.reviewerName}` : ""}
                    </p>
                  </div>
                  <div
                    style={{
                      borderRadius: 999,
                      padding: "8px 12px",
                      background:
                        session.status === "Final Submit Authorized"
                          ? "rgba(16, 185, 129, 0.12)"
                          : "rgba(15, 118, 110, 0.12)",
                      color:
                        session.status === "Final Submit Authorized" ? "#166534" : "#115e59",
                      alignSelf: "flex-start",
                    }}
                  >
                    {session.status}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                    marginTop: 14,
                  }}
                >
                  <div>
                    <div style={labelStyle}>Portal readiness</div>
                    <div style={{ color: "#2d251a" }}>
                      {session.portalReadiness.level} · {session.portalReadiness.kind}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Browser session</div>
                    <div style={{ color: "#2d251a" }}>
                      {session.storageStatePresent ? "Saved and ready" : "Missing or expired"}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Final confirmation</div>
                    <div style={{ color: "#2d251a" }}>
                      {session.finalSubmitAuthorized ? "Recorded" : "Still pending"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
                  <Link href={openSessionHref(session.id)} style={buttonStyle("primary")}>
                    Open session workspace
                  </Link>
                  <span style={{ color: "#5c5140", alignSelf: "center" }}>
                    {session.portalUrl}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            No submission sessions yet. Assemble the packet and launch a handoff to create the
            session that the team will use for the final portal run.
          </p>
        )}
      </div>
    </section>
  );
}
