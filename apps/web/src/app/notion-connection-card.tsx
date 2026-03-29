"use client";

import { useEffect, useState } from "react";

type NotionAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  workspaceName?: string | null;
  connectedAt?: string;
  bootstrap?: unknown;
};

type NotionConnectionCardProps = {
  onStatusChange?: (status: NotionAuthStatus | null) => void;
};

const cardStyle: Record<string, string | number> = {
  border: "1px solid rgba(73, 63, 46, 0.18)",
  borderRadius: 20,
  padding: 24,
  background: "rgba(255,255,255,0.82)",
  boxShadow: "0 20px 50px rgba(58, 43, 25, 0.08)",
  backdropFilter: "blur(8px)",
};

const buttonStyle = (tone: "primary" | "secondary" = "secondary") => ({
  borderRadius: 999,
  border: tone === "primary" ? "1px solid #0f766e" : "1px solid rgba(73, 63, 46, 0.18)",
  background: tone === "primary" ? "#0f766e" : "#fffdf8",
  color: tone === "primary" ? "#f8fffe" : "#2d251a",
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});

const statusDotStyle = (connected: boolean) => ({
  width: 12,
  height: 12,
  borderRadius: 999,
  background: connected ? "#15803d" : "#b45309",
  boxShadow: connected ? "0 0 0 6px rgba(22, 163, 74, 0.12)" : "0 0 0 6px rgba(217, 119, 6, 0.12)",
});

const parseJson = async <T,>(response: Response) => {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
};

export function NotionConnectionCard({ onStatusChange }: NotionConnectionCardProps) {
  const [status, setStatus] = useState<NotionAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/backend/auth/notion/status", {
        cache: "no-store",
      });
      const payload = await parseJson<
        NotionAuthStatus & {
          message?: string;
        }
      >(response);

      if (!response.ok && response.status !== 401) {
        throw new Error(payload.message || "Failed to load Notion connection status.");
      }

      const nextStatus: NotionAuthStatus = {
        configured: Boolean(payload.configured),
        authenticated: Boolean(payload.authenticated),
        workspaceName: payload.workspaceName ?? null,
        connectedAt: payload.connectedAt,
        bootstrap: payload.bootstrap,
      };

      if (nextStatus.authenticated && !nextStatus.bootstrap) {
        setBootstrapping(true);
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
              "Notion is connected, but Grant Guardian could not finish preparing the workspace yet.",
          );
        }

        setBootstrapping(false);
        await loadStatus();
        return;
      }

      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load Notion connection status.";
      setError(message);
      onStatusChange?.(null);
    } finally {
      setBootstrapping(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const disconnect = async () => {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/auth/notion", {
        method: "DELETE",
      });
      const payload = await parseJson<{ message?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.message || "Failed to disconnect Notion.");
      }

      await loadStatus();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to disconnect Notion.");
    } finally {
      setPending(false);
    }
  };

  const switchWorkspace = async () => {
    setPending(true);
    setError(null);

    try {
      if (connected) {
        const disconnectResponse = await fetch("/auth/notion", {
          method: "DELETE",
        });
        const disconnectPayload = await parseJson<{ message?: string }>(disconnectResponse);

        if (!disconnectResponse.ok) {
          throw new Error(disconnectPayload.message || "Failed to disconnect the current Notion workspace.");
        }
      }

      window.location.assign("/auth/notion");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to start the Notion workspace switch flow.",
      );
      setPending(false);
    }
  };

  const connected = Boolean(status?.authenticated);
  const workspaceReady = Boolean(status?.bootstrap);
  const workspaceName = status?.workspaceName || "your Notion workspace";

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={statusDotStyle(connected)} />
            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#6b5d46",
                }}
              >
                Notion connection
              </div>
              <div style={{ fontSize: "1.2rem", marginTop: 6 }}>
                {connected
                  ? workspaceReady
                    ? `Connected to ${workspaceName}`
                    : `Preparing ${workspaceName}`
                  : "Connect your Notion workspace"}
              </div>
            </div>
          </div>

          <p style={{ color: "#5e5241", lineHeight: 1.7, marginBottom: 0, marginTop: 16 }}>
            {connected
              ? workspaceReady
                ? "Grant Guardian will sync funders, opportunities, drafts, reviews, submissions, reporting, and lessons into this workspace."
                : "Grant Guardian is creating the Notion pages and databases this workspace needs. This usually takes a few seconds."
              : "Grant Guardian keeps all your grant records, drafts, funder intelligence, and task lists inside your Notion workspace. Connect it once and everything syncs automatically."}
          </p>
          <p style={{ color: "#6b5d46", lineHeight: 1.7, marginBottom: 0, marginTop: 12 }}>
            In Notion, share one page with the integration or create a fresh page like{" "}
            <strong>Grant Guardian Workspace</strong>. Grant Guardian will build the rest of the
            required pages and databases under that page automatically.
          </p>

          {!status?.configured ? (
            <p style={{ color: "#991b1b", marginTop: 14, marginBottom: 0 }}>
              Notion OAuth is not configured yet. Add the Notion OAuth environment variables and
              restart <code>dev:orchestrator</code>.
            </p>
          ) : null}
          {error ? (
            <p style={{ color: "#991b1b", marginTop: 14, marginBottom: 0 }}>{error}</p>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {connected ? (
            <>
              <button
                type="button"
                style={buttonStyle()}
                onClick={() => void disconnect()}
                disabled={pending}
              >
                {pending ? "Disconnecting..." : "Disconnect"}
              </button>
              <button
                type="button"
                style={buttonStyle("primary")}
                onClick={() => void switchWorkspace()}
                disabled={pending}
              >
                {pending ? "Opening Notion..." : "Switch Notion workspace"}
              </button>
            </>
          ) : (
            <button
              type="button"
              style={buttonStyle("primary")}
              onClick={() => void switchWorkspace()}
              disabled={pending}
            >
              {pending ? "Opening Notion..." : "Connect Notion"}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#5e5241", marginTop: 14, marginBottom: 0 }}>
          Checking your Notion connection...
        </p>
      ) : bootstrapping ? (
        <p style={{ color: "#5e5241", marginTop: 14, marginBottom: 0 }}>
          Finishing your Notion workspace setup...
        </p>
      ) : null}
    </section>
  );
}
