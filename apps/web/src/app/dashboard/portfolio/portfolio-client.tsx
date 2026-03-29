"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioSnapshot } from "../../lib/server-data";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  shellCardStyle,
} from "../../opportunities/[opportunityId]/opportunity-page-styles";

const badgeStyle = (classification: "Pursue Now" | "Revisit Later" | "Skip") => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  background:
    classification === "Pursue Now"
      ? "#dcfce7"
      : classification === "Revisit Later"
        ? "#ffedd5"
        : "#fee2e2",
  color:
    classification === "Pursue Now"
      ? "#14532d"
      : classification === "Revisit Later"
        ? "#9a4d00"
        : "#991b1b",
});

const mutedTextStyle: Record<string, string | number> = {
  color: "#5e5241",
  lineHeight: 1.7,
};

const round = (value: number, precision = 1) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "No deadline saved";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const loadPortfolioSnapshot = async (
  organizationId?: string | null,
  monthlyStaffHours?: number,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams();
  if (organizationId) {
    query.set("organizationId", organizationId);
  }
  if (typeof monthlyStaffHours === "number" && Number.isFinite(monthlyStaffHours)) {
    query.set("monthlyStaffHours", String(monthlyStaffHours));
  }

  const response = await fetch(`/api/backend/portfolio${query.toString() ? `?${query.toString()}` : ""}`, {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as PortfolioSnapshot & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to load the portfolio optimizer.");
  }

  return payload;
};

const syncPortfolioSnapshot = async (organizationId?: string | null, monthlyStaffHours?: number) => {
  const response = await fetch("/api/backend/portfolio/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      organizationId: organizationId ?? undefined,
      monthlyStaffHours,
    }),
  });
  const payload = (await response.json()) as PortfolioSnapshot & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to sync the portfolio plan to Notion.");
  }

  return payload;
};

function PortfolioScatterChart({
  opportunities,
}: {
  opportunities: PortfolioSnapshot["rankedOpportunities"];
}) {
  const width = 760;
  const height = 340;
  const padding = 38;
  const maxEffort = Math.max(
    8,
    ...opportunities.map((opportunity) => opportunity.effortEstimateHours || 0),
  );

  return (
    <div
      style={{
        border: "1px solid rgba(88, 75, 49, 0.14)",
        borderRadius: 18,
        background: "#fffdf8",
        padding: 16,
        overflowX: "auto",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", minWidth: 520, display: "block" }}
        role="img"
        aria-label="Fit versus effort scatter chart"
      >
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="rgba(88,75,49,0.4)"
          strokeWidth="2"
        />
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          stroke="rgba(88,75,49,0.4)"
          strokeWidth="2"
        />

        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - padding - ((height - padding * 2) * tick) / 100;
          return (
            <g key={tick}>
              <line
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="rgba(88,75,49,0.12)"
              />
              <text x={6} y={y + 4} fontSize="11" fill="#6b5d46">
                {tick}
              </text>
            </g>
          );
        })}

        {[0, maxEffort / 3, (maxEffort * 2) / 3, maxEffort].map((tick, index) => {
          const x = padding + ((width - padding * 2) * tick) / maxEffort;
          return (
            <g key={index}>
              <line
                x1={x}
                y1={padding}
                x2={x}
                y2={height - padding}
                stroke="rgba(88,75,49,0.12)"
              />
              <text x={x - 8} y={height - 8} fontSize="11" fill="#6b5d46">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {opportunities.map((opportunity) => {
          const x =
            padding +
            ((width - padding * 2) * opportunity.effortEstimateHours) / Math.max(1, maxEffort);
          const y =
            height -
            padding -
            ((height - padding * 2) * opportunity.fitScore) / 100;
          const fill =
            opportunity.classification === "Pursue Now"
              ? "#0f766e"
              : opportunity.classification === "Revisit Later"
                ? "#b45309"
                : "#b91c1c";

          return (
            <g key={opportunity.id}>
              <circle cx={x} cy={y} r="7" fill={fill} opacity={0.92} />
              <text x={x + 10} y={y - 10} fontSize="11" fill="#2d251a">
                {opportunity.title.slice(0, 28)}
              </text>
            </g>
          );
        })}

        <text x={width / 2 - 50} y={height - 2} fontSize="12" fill="#6b5d46">
          Effort hours
        </text>
        <text
          x={14}
          y={22}
          fontSize="12"
          fill="#6b5d46"
          transform={`rotate(-90 14 22)`}
        >
          Fit score
        </text>
      </svg>
    </div>
  );
}

type PortfolioClientProps = {
  organizationId?: string | null;
  initialSnapshot: PortfolioSnapshot | null;
  opportunityLibraryHref: string;
};

export function PortfolioClient({
  organizationId,
  initialSnapshot,
  opportunityLibraryHref,
}: PortfolioClientProps) {
  const [monthlyStaffHours, setMonthlyStaffHours] = useState(
    initialSnapshot?.monthlyStaffHours ?? 80,
  );
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(initialSnapshot);
  const [pending, setPending] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const didAutoSyncRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const payload = await loadPortfolioSnapshot(
          organizationId,
          monthlyStaffHours,
          controller.signal,
        );
        setSnapshot(payload);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the portfolio optimizer.",
        );
      } finally {
        setPending(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [organizationId, monthlyStaffHours]);

  useEffect(() => {
    if (!snapshot || didAutoSyncRef.current) {
      return;
    }

    didAutoSyncRef.current = true;
    void (async () => {
      try {
        const payload = await syncPortfolioSnapshot(organizationId, monthlyStaffHours);
        setSnapshot(payload);
        setLastSyncedAt(new Date().toISOString());
      } catch {
        // Keep the page usable even if Notion sync is unavailable.
      }
    })();
  }, [snapshot, organizationId, monthlyStaffHours]);

  const manualSync = async () => {
    setSyncPending(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await syncPortfolioSnapshot(organizationId, monthlyStaffHours);
      setSnapshot(payload);
      const syncedAt = new Date().toISOString();
      setLastSyncedAt(syncedAt);
      setMessage("Portfolio plan synced to Notion.");
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Failed to sync the portfolio plan.",
      );
    } finally {
      setSyncPending(false);
    }
  };

  const rankedOpportunities = snapshot?.rankedOpportunities ?? [];
  const topRecommendations = snapshot?.staffingRecommendation.recommendations ?? [];

  const summaryCards = useMemo(
    () => [
      {
        label: "Active opportunities",
        value: snapshot?.summary.totalActive ?? 0,
        helper: "Everything not submitted, awarded, or rejected.",
      },
      {
        label: "Pursue now",
        value: snapshot?.summary.pursueNow ?? 0,
        helper: "The grants with the strongest current fit plus evidence.",
      },
      {
        label: "Needs analysis",
        value: snapshot?.summary.analysisNeeded ?? 0,
        helper: "These need a real analysis run before the rank is trustworthy.",
      },
      {
        label: "Weekly capacity",
        value: `${snapshot?.weeklyStaffHours ?? round(monthlyStaffHours / 4.33, 1)}h`,
        helper: "Derived from the monthly staff-hours input below.",
      },
    ],
    [monthlyStaffHours, snapshot],
  );

  return (
    <section style={{ display: "grid", gap: 24 }}>
      <section
        style={{
          ...shellCardStyle,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {summaryCards.map((card) => (
          <article
            key={card.label}
            style={{
              border: "1px solid rgba(88, 75, 49, 0.14)",
              borderRadius: 18,
              padding: 18,
              background: "#fffdf8",
            }}
          >
            <div style={labelStyle}>{card.label}</div>
            <div style={{ fontSize: "2rem", color: "#2d251a" }}>{card.value}</div>
            <div style={{ ...mutedTextStyle, marginTop: 8 }}>{card.helper}</div>
          </article>
        ))}
      </section>

      <section style={shellCardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "end",
          }}
        >
          <div style={{ minWidth: 240, flex: "1 1 280px" }}>
            <label style={labelStyle}>Monthly staff hours available for grants</label>
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={monthlyStaffHours}
              onChange={(event) => setMonthlyStaffHours(Number(event.target.value || 0))}
            />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle("primary")}
              onClick={manualSync}
              disabled={syncPending}
            >
              {syncPending ? "Syncing..." : "Sync to Notion"}
            </button>
            <Link href={opportunityLibraryHref} style={buttonStyle()}>
              Open opportunity library
            </Link>
          </div>
        </div>

        <div style={{ ...mutedTextStyle, marginTop: 14 }}>
          {snapshot?.staffingRecommendation.summary ??
            "Once opportunities have fit scores, this will turn them into a real weekly staffing plan."}
          {lastSyncedAt ? (
            <>
              <br />
              Last synced to Notion: {new Date(lastSyncedAt).toLocaleString()}
            </>
          ) : null}
        </div>

        {message ? (
          <div style={{ color: "#0f766e", marginTop: 12, fontWeight: 600 }}>{message}</div>
        ) : null}
        {error ? <div style={{ color: "#b91c1c", marginTop: 12 }}>{error}</div> : null}
        {pending ? <div style={{ color: "#6b5d46", marginTop: 12 }}>Refreshing rankings...</div> : null}
      </section>

      <section style={shellCardStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={labelStyle}>This week</div>
            <h2
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                fontSize: "2rem",
                margin: 0,
              }}
            >
              Recommended hours by opportunity
            </h2>
          </div>
          {topRecommendations.length === 0 ? (
            <div style={mutedTextStyle}>
              No hours are allocated yet. Run analysis on more opportunities or improve the current
              evidence base so the optimizer has something worth staffing.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              {topRecommendations.map((recommendation) => (
                <article
                  key={recommendation.opportunityId}
                  style={{
                    border: "1px solid rgba(88, 75, 49, 0.14)",
                    borderRadius: 18,
                    padding: 18,
                    background: "#fffdf8",
                  }}
                >
                  <div style={badgeStyle(recommendation.classification)}>
                    {recommendation.classification}
                  </div>
                  <h3 style={{ margin: "12px 0 8px", fontSize: "1.05rem" }}>
                    {recommendation.opportunityTitle}
                  </h3>
                  <div style={{ fontSize: "1.8rem", color: "#2d251a" }}>
                    {recommendation.hours}h
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section style={shellCardStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={labelStyle}>Fit vs effort</div>
            <h2
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                fontSize: "2rem",
                margin: 0,
              }}
            >
              See which grants deserve scarce attention
            </h2>
          </div>
          <PortfolioScatterChart opportunities={rankedOpportunities} />
        </div>
      </section>

      <section style={shellCardStyle}>
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
            <div style={labelStyle}>Ranked list</div>
            <h2
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                fontSize: "2rem",
                margin: 0,
              }}
            >
              Every active opportunity, in order
            </h2>
          </div>
          <div style={{ color: "#5e5241" }}>{rankedOpportunities.length} active item(s)</div>
        </div>

        <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
          {rankedOpportunities.length === 0 ? (
            <div style={mutedTextStyle}>
              No active opportunities are ready to rank yet. Add a grant, run analysis, and come
              back here to compare them side by side.
            </div>
          ) : null}

          {rankedOpportunities.map((opportunity, index) => (
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
                  gap: 16,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ maxWidth: 760 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>Rank #{index + 1}</div>
                  <h3 style={{ margin: 0, fontSize: "1.15rem" }}>{opportunity.title}</h3>
                  <div style={{ color: "#6b5d46", marginTop: 6 }}>
                    {opportunity.funderName} · Deadline {formatDate(opportunity.deadline)}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                  <span style={badgeStyle(opportunity.classification)}>
                    {opportunity.classification}
                  </span>
                  <div style={{ fontSize: "1.6rem", color: "#2d251a" }}>
                    {opportunity.priorityScore}
                  </div>
                  <div style={{ color: "#6b5d46", fontSize: 13 }}>Priority score</div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                {[
                  ["Fit", `${opportunity.fitScore} / 100`],
                  ["Coverage", `${opportunity.evidenceCoveragePercent}%`],
                  ["Effort", `${opportunity.effortEstimateHours}h`],
                  ["Reporting burden", `${opportunity.reportingBurdenScore}`],
                  [
                    "This week",
                    opportunity.recommendedHoursThisWeek > 0
                      ? `${opportunity.recommendedHoursThisWeek}h`
                      : "0h",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={`${opportunity.id}-${label}`}
                    style={{
                      border: "1px solid rgba(88, 75, 49, 0.12)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.72)",
                    }}
                  >
                    <div style={labelStyle}>{label}</div>
                    <div style={{ color: "#2d251a", fontSize: "1.1rem" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ ...mutedTextStyle, marginTop: 16 }}>
                {opportunity.analysisReady ? opportunity.nextMove : "Run analysis first. This row is intentionally held at the bottom until a real fit score and evidence map exist."}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Link
                  href={`/opportunities/${encodeURIComponent(opportunity.id)}${
                    organizationId
                      ? `?organizationId=${encodeURIComponent(organizationId)}`
                      : ""
                  }`}
                  style={buttonStyle("primary")}
                >
                  Open opportunity
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
