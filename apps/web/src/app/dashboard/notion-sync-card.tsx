"use client";

import { useMemo, useState } from "react";
import type { NotionSyncStatus } from "../lib/server-data";
import { buttonStyle } from "../opportunities/[opportunityId]/opportunity-page-styles";

type NotionSyncCardProps = {
  organizationId: string | null;
  initialStatus: NotionSyncStatus | null;
  cardStyle: Record<string, string | number>;
  labelStyle: Record<string, string | number>;
};

const mutedTextStyle: Record<string, string | number> = {
  color: "#5c5140",
  lineHeight: 1.7,
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "Never yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
};

export function NotionSyncCard({
  organizationId,
  initialStatus,
  cardStyle,
  labelStyle,
}: NotionSyncCardProps) {
  const [status, setStatus] = useState<NotionSyncStatus | null>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const syncReadinessMessage = useMemo(() => {
    if (!status?.configured) {
      return "Notion OAuth is not configured in the local environment yet.";
    }
    if (!status?.authenticated) {
      return "Connect Notion first so Grant Guardian can write the operating record there.";
    }
    if (!status.bootstrapReady) {
      return "Bootstrap the Grant Guardian Notion workspace before running a full sync.";
    }

    return status.lastOperation
      ? `Most recent sync: ${status.lastOperation.replace(/-/g, " ")}${status.lastTarget ? ` · ${status.lastTarget}` : ""}`
      : "The workspace is connected and ready for a full resync.";
  }, [status]);

  const reloadStatus = async () => {
    const response = await fetch("/api/backend/notion/sync-status", {
      cache: "no-store",
    });
    const payload = (await response.json()) as NotionSyncStatus & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load Notion sync status.");
    }
    setStatus(payload);
    return payload;
  };

  const syncNow = async () => {
    if (!organizationId) {
      setMessage("Choose a workspace first so Grant Guardian knows what to sync.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/backend/notion/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
        }),
      });
      const payload = (await response.json()) as {
        status?: NotionSyncStatus;
        organizationName?: string;
        counts?: Record<string, number>;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to sync the workspace to Notion.");
      }

      if (payload.status) {
        setStatus(payload.status);
      } else {
        await reloadStatus();
      }

      const syncedCount =
        typeof payload.counts === "object"
          ? Object.values(payload.counts).reduce((total, count) => total + Number(count ?? 0), 0)
          : null;
      setMessage(
        syncedCount
          ? `Synced ${syncedCount} workspace record${syncedCount === 1 ? "" : "s"} to Notion.`
          : "Workspace synced to Notion.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to sync the workspace to Notion.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article style={cardStyle}>
      <div style={labelStyle}>Notion sync</div>
      <div style={{ fontSize: "1.4rem", marginTop: 8 }}>
        Last synced to Notion: {formatTimestamp(status?.lastSyncedAt)}
      </div>
      <p style={{ ...mutedTextStyle, marginBottom: 12 }}>
        {status?.workspaceName
          ? `Workspace: ${status.workspaceName}. ${syncReadinessMessage}`
          : syncReadinessMessage}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={syncNow}
          disabled={busy || !status?.configured || !status?.authenticated || !status.bootstrapReady}
          style={{
            ...buttonStyle("primary"),
            opacity:
              busy || !status?.configured || !status?.authenticated || !status.bootstrapReady
                ? 0.6
                : 1,
            cursor:
              busy || !status?.configured || !status?.authenticated || !status.bootstrapReady
                ? "not-allowed"
                : "pointer",
          }}
        >
          {busy ? "Syncing..." : "Sync now"}
        </button>
        <button
          type="button"
          onClick={() => {
            void reloadStatus().catch((error) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Failed to refresh the Notion sync status.",
              ),
            );
          }}
          style={buttonStyle("secondary")}
        >
          Refresh status
        </button>
      </div>
      {message ? (
        <p
          style={{
            marginTop: 12,
            marginBottom: 0,
            color: message.toLowerCase().includes("failed") ? "#991b1b" : "#0f766e",
          }}
        >
          {message}
        </p>
      ) : null}
    </article>
  );
}
