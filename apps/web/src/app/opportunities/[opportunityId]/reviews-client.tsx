"use client";

import { useEffect, useState } from "react";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  shellCardStyle,
} from "./opportunity-page-styles";

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

type ReviewsClientProps = {
  opportunityId: string;
  organizationId?: string | null;
  defaultReviewer?: string | null;
};

export function ReviewsClient({
  opportunityId,
  organizationId,
  defaultReviewer,
}: ReviewsClientProps) {
  const [reviewer, setReviewer] = useState(defaultReviewer ?? "");
  const [dueDate, setDueDate] = useState("");
  const [readiness, setReadiness] = useState<SubmissionReadiness | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(
          `/api/backend/opportunities/${opportunityId}/review-readiness`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as SubmissionReadiness & { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to load review readiness.");
        }
        setReadiness(payload);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load review readiness.",
        );
      }
    };

    void load();
    return () => controller.abort();
  }, [opportunityId]);

  const buildReviewQueue = async () => {
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/backend/opportunities/${opportunityId}/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reviewer: normalizeText(reviewer) || undefined,
          dueDate: normalizeText(dueDate) || undefined,
          syncToNotion: true,
        }),
      });
      const payload = (await response.json()) as ReviewWorkflowResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to prepare review workflow.");
      }

      setReadiness(payload.readiness);
      setMessage(
        `Prepared ${payload.requestedReviewCount} requested review(s).${syncSuffix(payload)}`,
      );
    } catch (workflowError) {
      setError(
        workflowError instanceof Error
          ? workflowError.message
          : "Failed to prepare review workflow.",
      );
    } finally {
      setPending(false);
    }
  };

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
          <label style={labelStyle}>Reviewer</label>
          <input
            style={inputStyle}
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="Maya Patel"
          />
        </div>
        <div>
          <label style={labelStyle}>Review due date</label>
          <input
            style={inputStyle}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
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
          Workspace scope: {organizationId ?? "local default scope"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button style={buttonStyle("primary")} onClick={() => void buildReviewQueue()} disabled={pending}>
          {pending ? "Preparing review..." : "Build review queue"}
        </button>
        {message ? <span style={{ color: "#14532d" }}>{message}</span> : null}
        {error ? <span style={{ color: "#991b1b" }}>{error}</span> : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Stage</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {readiness?.stage ?? "Loading..."}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Ready: {readiness?.readyForSubmission ? "Yes" : "Not yet"}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Approvals</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {readiness?.approvals.approved ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Requested: {readiness?.approvals.requested ?? 0} · In review:{" "}
            {readiness?.approvals.inReview ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Draft Coverage</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {readiness?.draftCoverage.approvedDrafts ?? 0}/
            {readiness?.draftCoverage.totalRequirements ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Pending unsupported claims:{" "}
            {readiness?.draftCoverage.pendingUnsupportedClaims ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Tasks</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {readiness?.taskSummary.open ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Blocked: {readiness?.taskSummary.blocked ?? 0} · Done:{" "}
            {readiness?.taskSummary.done ?? 0}
          </p>
        </article>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={labelStyle}>Current blockers</div>
        {readiness?.blockers.length ? (
          <ul style={{ margin: 0, paddingLeft: 20, color: "#5c5140", lineHeight: 1.7 }}>
            {readiness.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#5c5140", margin: 0 }}>
            No blockers are currently preventing submission readiness.
          </p>
        )}
      </div>
    </section>
  );
}
