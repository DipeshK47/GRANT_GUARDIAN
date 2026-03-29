"use client";

import { useEffect, useState } from "react";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  shellCardStyle,
} from "./opportunity-page-styles";

type ReportingCadence = "Final Only" | "Semiannual + Final" | "Quarterly + Final";
type ReportingStatus = "Upcoming" | "In Progress" | "Submitted" | "Overdue";

type ReportingCalendarResult = {
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  cadence: ReportingCadence | null;
  reports: Array<{
    id: string;
    reportName: string;
    dueDate: string;
    reportingPeriod?: string | null;
    status: ReportingStatus;
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

type ActivateReportingResult = ReportingCalendarResult & {
  awardDate: string;
  owner?: string | null;
  notionSync?: {
    reportingPageIds: string[];
    taskPageIds: string[];
    draftPageIds?: string[];
    reportingWorkspacePageId?: string;
    reportingWorkspacePageUrl?: string;
  };
};

type UpdateReportingResult = {
  reportId: string;
  opportunityId: string;
  opportunityTitle: string;
  reportName: string;
  dueDate: string;
  status: ReportingStatus;
  owner?: string | null;
  templateLink?: string | null;
  requiredMetrics: string[];
  notionSync?: {
    reportingPageIds: string[];
    taskPageIds: string[];
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const parseListText = (value?: string | null) =>
  (value ?? "")
    .split(/\n|,|\|/)
    .map((item) => normalizeText(item))
    .filter(Boolean);

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

const loadReportingCalendar = async (
  opportunityId: string,
  organizationId?: string | null,
  signal?: AbortSignal,
) => {
  const response = await fetch(
    `/api/backend/opportunities/${opportunityId}/reporting-calendar${buildQuery(organizationId)}`,
    {
      cache: "no-store",
      signal,
    },
  );
  const payload = (await response.json()) as ReportingCalendarResult & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to load reporting calendar.");
  }

  return payload;
};

type ReportingClientProps = {
  opportunityId: string;
  organizationId?: string | null;
  defaultOwner?: string | null;
};

export function ReportingClient({
  opportunityId,
  organizationId,
  defaultOwner,
}: ReportingClientProps) {
  const [owner, setOwner] = useState(defaultOwner ?? "");
  const [awardDate, setAwardDate] = useState("");
  const [cadence, setCadence] = useState<ReportingCadence>("Quarterly + Final");
  const [templateLink, setTemplateLink] = useState("");
  const [requiredMetricsText, setRequiredMetricsText] = useState("");
  const [calendar, setCalendar] = useState<ReportingCalendarResult | null>(null);
  const [statusDrafts, setStatusDrafts] = useState<Record<string, ReportingStatus>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const payload = await loadReportingCalendar(
          opportunityId,
          organizationId,
          controller.signal,
        );
        setCalendar(payload);
        setStatusDrafts(
          Object.fromEntries(payload.reports.map((report) => [report.id, report.status])),
        );
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load reporting calendar.",
        );
      }
    };

    void load();
    return () => controller.abort();
  }, [opportunityId, organizationId]);

  const refreshCalendar = async () => {
    const payload = await loadReportingCalendar(opportunityId, organizationId);
    setCalendar(payload);
    setStatusDrafts(
      Object.fromEntries(payload.reports.map((report) => [report.id, report.status])),
    );
  };

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
          : "Reporting workflow failed.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const activateReporting = async () => {
    await runAction("activate-reporting", async () => {
      const response = await fetch(
        `/api/backend/opportunities/${opportunityId}/activate-reporting`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId: organizationId ?? undefined,
            owner: normalizeText(owner) || undefined,
            awardDate: normalizeText(awardDate) || undefined,
            cadence,
            templateLink: normalizeText(templateLink) || undefined,
            requiredMetrics: parseListText(requiredMetricsText),
            syncToNotion: true,
          }),
        },
      );
      const payload = (await response.json()) as ActivateReportingResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to activate reporting workflow.");
      }

      setCalendar(payload);
      setStatusDrafts(
        Object.fromEntries(payload.reports.map((report) => [report.id, report.status])),
      );
      return `Activated ${payload.cadence ?? cadence} reporting.${syncSuffix(payload)}`;
    });
  };

  const updateReportStatus = async (reportId: string) => {
    await runAction(`report-${reportId}`, async () => {
      const response = await fetch(`/api/backend/reporting-calendar/${reportId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: organizationId ?? undefined,
          status: statusDrafts[reportId],
          syncToNotion: true,
        }),
      });
      const payload = (await response.json()) as UpdateReportingResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update the reporting entry.");
      }

      setCalendar((current) =>
        current
          ? {
              ...current,
              reports: current.reports.map((report) =>
                report.id === reportId
                  ? {
                      ...report,
                      status: payload.status,
                      owner: payload.owner,
                      templateLink: payload.templateLink,
                      requiredMetrics: payload.requiredMetrics,
                    }
                  : report,
              ),
              summary: {
                total: current.reports.length,
                upcoming: current.reports.filter((report) =>
                  (report.id === reportId ? payload.status : report.status) === "Upcoming",
                ).length,
                inProgress: current.reports.filter((report) =>
                  (report.id === reportId ? payload.status : report.status) === "In Progress",
                ).length,
                submitted: current.reports.filter((report) =>
                  (report.id === reportId ? payload.status : report.status) === "Submitted",
                ).length,
                overdue: current.reports.filter((report) =>
                  (report.id === reportId ? payload.status : report.status) === "Overdue",
                ).length,
              },
            }
          : current,
      );
      return `Updated ${payload.reportName}.${syncSuffix(payload)}`;
    });
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
          <label style={labelStyle}>Owner</label>
          <input
            style={inputStyle}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Maya Patel"
          />
        </div>
        <div>
          <label style={labelStyle}>Award date</label>
          <input
            style={inputStyle}
            type="date"
            value={awardDate}
            onChange={(event) => setAwardDate(event.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Cadence</label>
          <select
            style={inputStyle}
            value={cadence}
            onChange={(event) => setCadence(event.target.value as ReportingCadence)}
          >
            <option value="Quarterly + Final">Quarterly + Final</option>
            <option value="Semiannual + Final">Semiannual + Final</option>
            <option value="Final Only">Final Only</option>
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Template link</label>
          <input
            style={inputStyle}
            value={templateLink}
            onChange={(event) => setTemplateLink(event.target.value)}
            placeholder="https://notion.so/report-template"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Required metrics</label>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
            value={requiredMetricsText}
            onChange={(event) => setRequiredMetricsText(event.target.value)}
            placeholder="Students served&#10;Reading growth&#10;Caregiver engagement"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button
          style={buttonStyle("primary")}
          onClick={() => void activateReporting()}
          disabled={pendingKey !== null}
        >
          {pendingKey === "activate-reporting"
            ? "Activating reporting..."
            : "Activate reporting"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void runAction("refresh-reporting", async () => {
            await refreshCalendar();
            return "Reporting calendar refreshed.";
          })}
          disabled={pendingKey !== null}
        >
          {pendingKey === "refresh-reporting" ? "Refreshing..." : "Refresh calendar"}
        </button>
        {message ? <span style={{ color: "#14532d" }}>{message}</span> : null}
        {error ? <span style={{ color: "#991b1b" }}>{error}</span> : null}
        {(calendar?.notionSync?.reportingWorkspacePageUrl ?? calendar?.notionWorkspaceUrl) ? (
          <a
            href={calendar?.notionSync?.reportingWorkspacePageUrl ?? calendar?.notionWorkspaceUrl ?? "#"}
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Opportunity status</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {calendar?.opportunityStatus ?? "Loading..."}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Cadence: {calendar?.cadence ?? "Not activated yet"}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Upcoming reports</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {calendar?.summary.upcoming ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            In progress: {calendar?.summary.inProgress ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Submitted</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {calendar?.summary.submitted ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Overdue: {calendar?.summary.overdue ?? 0}
          </p>
        </article>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Reporting calendar</div>
        {calendar?.reports.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {calendar.reports.map((report) => (
              <article key={report.id} style={{ ...shellCardStyle, padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>{report.reportName}</h3>
                    <p style={{ margin: 0, color: "#5c5140", lineHeight: 1.6 }}>
                      Due {report.dueDate}
                      {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#5c5140", lineHeight: 1.6 }}>
                      Owner: {(report.owner ?? owner) || "Unassigned"}
                    </p>
                  </div>
                  <div
                    style={{
                      borderRadius: 999,
                      padding: "8px 12px",
                      background:
                        report.status === "Submitted"
                          ? "rgba(16, 185, 129, 0.12)"
                          : report.status === "In Progress"
                            ? "rgba(15, 118, 110, 0.12)"
                            : report.status === "Overdue"
                              ? "rgba(220, 38, 38, 0.12)"
                              : "rgba(148, 163, 184, 0.12)",
                      color:
                        report.status === "Submitted"
                          ? "#166534"
                          : report.status === "In Progress"
                            ? "#115e59"
                            : report.status === "Overdue"
                              ? "#991b1b"
                              : "#475569",
                      alignSelf: "flex-start",
                    }}
                  >
                    {report.status}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(180px, 220px) auto",
                    gap: 12,
                    marginTop: 14,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={labelStyle}>Update status</label>
                    <select
                      style={inputStyle}
                      value={statusDrafts[report.id] ?? report.status}
                      onChange={(event) =>
                        setStatusDrafts((current) => ({
                          ...current,
                          [report.id]: event.target.value as ReportingStatus,
                        }))
                      }
                    >
                      <option value="Upcoming">Upcoming</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Overdue">Overdue</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button
                      style={buttonStyle()}
                      onClick={() => void updateReportStatus(report.id)}
                      disabled={pendingKey !== null}
                    >
                      {pendingKey === `report-${report.id}` ? "Saving..." : "Save status"}
                    </button>
                    <span style={{ color: "#5c5140", alignSelf: "center" }}>
                      Metrics: {report.requiredMetrics.join(", ") || "No metrics added yet"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            No reporting deadlines yet. Activate reporting to create the calendar and sync it to
            Notion.
          </p>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Promised metrics to track</div>
          <div style={{ display: "grid", gap: 8 }}>
            {(calendar?.metricsToTrack.length
              ? calendar.metricsToTrack
              : ["No promised metrics extracted yet."]).map((metric) => (
              <div
                key={metric}
                style={{
                  borderRadius: 12,
                  background: "#fffdf8",
                  border: "1px solid rgba(73, 63, 46, 0.12)",
                  padding: 10,
                  color: "#2d251a",
                }}
              >
                {metric}
              </div>
            ))}
          </div>
        </article>

        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Draft report templates</div>
          <div style={{ display: "grid", gap: 10 }}>
            {calendar?.reportTemplates.length ? (
              calendar.reportTemplates.map((template) => (
                <div
                  key={template.draftAnswerId}
                  style={{
                    borderRadius: 12,
                    background: "#fffdf8",
                    border: "1px solid rgba(73, 63, 46, 0.12)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#2d251a" }}>{template.reportName}</div>
                  <div style={{ color: "#6b5d46", fontSize: 13, marginTop: 4 }}>{template.status}</div>
                  {template.templateLink ? (
                    <a
                      href={template.templateLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#0f766e", textDecoration: "none", marginTop: 8, display: "inline-block" }}
                    >
                      Open template
                    </a>
                  ) : null}
                </div>
              ))
            ) : (
              <p style={{ color: "#5c5140", margin: 0 }}>
                No report templates have been seeded yet.
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
