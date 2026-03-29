"use client";

import { useEffect, useState } from "react";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  shellCardStyle,
} from "./opportunity-page-styles";

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
};

type RecordLessonResult = LessonListResult & {
  lessonId: string;
  opportunityStatus?: string | null;
  notionSync?: {
    lessonPageIds: string[];
  };
};

type UpdateLessonResult = {
  lessonId: string;
  funderId: string;
  funderName: string;
  opportunityId?: string | null;
  opportunityTitle?: string | null;
  themes: string[];
  recommendations?: string | null;
  appliesNextCycle: boolean;
  notionSync?: {
    lessonPageIds: string[];
  };
};

type LessonDraft = {
  themesText: string;
  recommendations: string;
  appliesNextCycle: boolean;
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

const loadLessons = async (
  opportunityId: string,
  organizationId?: string | null,
  signal?: AbortSignal,
) => {
  const response = await fetch(
    `/api/backend/opportunities/${opportunityId}/lessons${buildQuery(organizationId)}`,
    {
      cache: "no-store",
      signal,
    },
  );
  const payload = (await response.json()) as LessonListResult & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to load lessons.");
  }

  return payload;
};

const buildLessonDrafts = (lessons: LessonListResult["lessons"]) =>
  Object.fromEntries(
    lessons.map((lesson) => [
      lesson.id,
      {
        themesText: lesson.themes.join(", "),
        recommendations: lesson.recommendations ?? "",
        appliesNextCycle: lesson.appliesNextCycle,
      },
    ]),
  ) as Record<string, LessonDraft>;

type LessonsClientProps = {
  opportunityId: string;
  opportunityTitle: string;
  organizationId?: string | null;
  opportunityStatus: string;
};

export function LessonsClient({
  opportunityId,
  opportunityTitle,
  organizationId,
  opportunityStatus,
}: LessonsClientProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [themesText, setThemesText] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [appliesNextCycle, setAppliesNextCycle] = useState(true);
  const [currentOpportunityStatus, setCurrentOpportunityStatus] = useState(opportunityStatus);
  const [lessonData, setLessonData] = useState<LessonListResult | null>(null);
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentOpportunityStatus(opportunityStatus);
  }, [opportunityStatus]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const payload = await loadLessons(opportunityId, organizationId, controller.signal);
        setLessonData(payload);
        setLessonDrafts(buildLessonDrafts(payload.lessons));
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "Failed to load lessons.",
        );
      }
    };

    void load();
    return () => controller.abort();
  }, [opportunityId, organizationId]);

  const refreshLessons = async () => {
    const payload = await loadLessons(opportunityId, organizationId);
    setLessonData(payload);
    setLessonDrafts(buildLessonDrafts(payload.lessons));
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
        actionError instanceof Error ? actionError.message : "Lesson workflow failed.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const recordLesson = async () => {
    await runAction("record-lesson", async () => {
      const response = await fetch(`/api/backend/opportunities/${opportunityId}/lessons`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: organizationId ?? undefined,
          feedbackText: normalizeText(feedbackText),
          themes: parseListText(themesText),
          recommendations: normalizeText(recommendations) || undefined,
          appliesNextCycle,
          markOpportunityRejected: currentOpportunityStatus !== "Rejected",
          syncToNotion: true,
        }),
      });
      const payload = (await response.json()) as RecordLessonResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to record the lesson.");
      }

      setLessonData(payload);
      setLessonDrafts(buildLessonDrafts(payload.lessons));
      if (payload.opportunityStatus) {
        setCurrentOpportunityStatus(payload.opportunityStatus);
      }
      setFeedbackText("");
      setThemesText("");
      setRecommendations("");
      return `${payload.opportunityStatus === "Rejected" ? "Marked the opportunity as rejected and captured a reusable lesson." : "Captured a reusable lesson."}${syncSuffix(payload)}`;
    });
  };

  const updateLesson = async (lessonId: string) => {
    const draft = lessonDrafts[lessonId];
    await runAction(`lesson-${lessonId}`, async () => {
      const response = await fetch(`/api/backend/lessons/${lessonId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: organizationId ?? undefined,
          themes: parseListText(draft?.themesText),
          recommendations: normalizeText(draft?.recommendations) || undefined,
          appliesNextCycle: draft?.appliesNextCycle ?? true,
          syncToNotion: true,
        }),
      });
      const payload = (await response.json()) as UpdateLessonResult & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update the lesson.");
      }

      await refreshLessons();
      return `Updated lesson memory.${syncSuffix(payload)}`;
    });
  };

  return (
    <section style={shellCardStyle}>
      <div style={{ display: "grid", gap: 14 }}>
        <article
          style={{
            ...shellCardStyle,
            padding: 18,
            border: "1px solid rgba(217, 119, 6, 0.18)",
            background: currentOpportunityStatus === "Rejected" ? "#fffaf0" : "#fffdf8",
          }}
        >
          <div style={labelStyle}>Opportunity status</div>
          <div style={{ fontSize: "1.2rem", color: "#2d251a" }}>{currentOpportunityStatus}</div>
          <p style={{ color: "#5c5140", lineHeight: 1.7, marginBottom: 0 }}>
            {currentOpportunityStatus === "Rejected"
              ? "This opportunity is already marked as rejected. Log what happened so Grant Guardian can warn the team next cycle."
              : "Use this form to mark the opportunity as rejected and capture the feedback at the same time. That single action will store the lesson against both the funder and this opportunity."}
          </p>
        </article>
        <div>
          <label style={labelStyle}>Feedback or rejection note</label>
          <textarea
            style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            placeholder="Reviewer said the proposal was aligned, but the outcomes plan needed clearer benchmarks and the staffing plan felt thin."
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <div>
            <label style={labelStyle}>Themes</label>
            <input
              style={inputStyle}
              value={themesText}
              onChange={(event) => setThemesText(event.target.value)}
              placeholder="Evaluation Weakness, Capacity Concerns"
            />
          </div>
          <div>
            <label style={labelStyle}>Applies next cycle</label>
            <label
              style={{
                ...inputStyle,
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 48,
              }}
            >
              <input
                type="checkbox"
                checked={appliesNextCycle}
                onChange={(event) => setAppliesNextCycle(event.target.checked)}
              />
              Reuse this lesson in the next draft cycle
            </label>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Recommendations</label>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
            value={recommendations}
            onChange={(event) => setRecommendations(event.target.value)}
            placeholder="Add benchmark comparisons and show delivery capacity with staffing and implementation support."
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button
          style={buttonStyle("primary")}
          onClick={() => void recordLesson()}
          disabled={pendingKey !== null || !normalizeText(feedbackText)}
        >
          {pendingKey === "record-lesson"
            ? currentOpportunityStatus === "Rejected"
              ? "Logging rejection feedback..."
              : "Marking rejected..."
            : currentOpportunityStatus === "Rejected"
              ? "Log rejection feedback"
              : "Mark rejected and log feedback"}
        </button>
        <button
          style={buttonStyle()}
          onClick={() => void runAction("refresh-lessons", async () => {
            await refreshLessons();
            return "Lesson memory refreshed.";
          })}
          disabled={pendingKey !== null}
        >
          {pendingKey === "refresh-lessons" ? "Refreshing..." : "Refresh lessons"}
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
          <div style={labelStyle}>Reusable lessons</div>
          <div style={{ fontSize: "1.45rem", marginTop: 8 }}>
            {lessonData?.memorySummary.reusableLessons ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Total lessons: {lessonData?.memorySummary.totalLessons ?? 0}
          </p>
        </article>
        <article style={{ ...shellCardStyle, padding: 18 }}>
          <div style={labelStyle}>Top themes</div>
          <div style={{ fontSize: "1.1rem", marginTop: 8 }}>
            {(lessonData?.memorySummary.topThemes ?? []).join(" · ") || "No lessons yet"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Funder: {lessonData?.funderName ?? "Loading..."}
          </p>
        </article>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={labelStyle}>Lesson memory</div>
        {lessonData?.lessons.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {lessonData.lessons.map((lesson) => {
              const draft = lessonDrafts[lesson.id] ?? {
                themesText: lesson.themes.join(", "),
                recommendations: lesson.recommendations ?? "",
                appliesNextCycle: lesson.appliesNextCycle,
              };

              return (
                <article key={lesson.id} style={{ ...shellCardStyle, padding: 18 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>
                    {lesson.opportunityTitle ?? opportunityTitle}
                  </h3>
                  <p style={{ color: "#6b5d46", lineHeight: 1.6, marginTop: 0 }}>
                    Rejection date: {lesson.rejectionDate.slice(0, 10)}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
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
                  <p style={{ color: "#5c5140", lineHeight: 1.7, marginTop: 0 }}>
                    {lesson.feedbackText}
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Themes</label>
                      <input
                        style={inputStyle}
                        value={draft.themesText}
                        onChange={(event) =>
                          setLessonDrafts((current) => ({
                            ...current,
                            [lesson.id]: {
                              ...draft,
                              themesText: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Reuse next cycle</label>
                      <label
                        style={{
                          ...inputStyle,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          minHeight: 48,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={draft.appliesNextCycle}
                          onChange={(event) =>
                            setLessonDrafts((current) => ({
                              ...current,
                              [lesson.id]: {
                                ...draft,
                                appliesNextCycle: event.target.checked,
                              },
                            }))
                          }
                        />
                        Carry this lesson forward
                      </label>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Recommendations</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                        value={draft.recommendations}
                        onChange={(event) =>
                          setLessonDrafts((current) => ({
                            ...current,
                            [lesson.id]: {
                              ...draft,
                              recommendations: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
                    <button
                      style={buttonStyle()}
                      onClick={() => void updateLesson(lesson.id)}
                      disabled={pendingKey !== null}
                    >
                      {pendingKey === `lesson-${lesson.id}` ? "Saving..." : "Save lesson"}
                    </button>
                    <span style={{ color: "#5c5140", alignSelf: "center" }}>
                      Last updated {lesson.updatedAt.slice(0, 10)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            No lessons recorded yet. Add a rejection note or reviewer feedback and it will sync to
            Notion for reuse later.
          </p>
        )}
      </div>
    </section>
  );
}
