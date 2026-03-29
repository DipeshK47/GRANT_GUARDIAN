import Link from "next/link";
import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

const shellCardStyle: Record<string, string | number> = {
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
});

type AppShellProps = {
  currentSection: "dashboard" | "portfolio" | "opportunities";
  eyebrow: string;
  title: string;
  description: string;
  organizationId?: string | null;
  workspaceName?: string | null;
  children: ReactNode;
};

export function AppShell({
  currentSection,
  eyebrow,
  title,
  description,
  organizationId,
  workspaceName,
  children,
}: AppShellProps) {
  const activeWorkspaceName = workspaceName ?? "Workspace";
  const dashboardHref = organizationId
    ? `/dashboard?organizationId=${encodeURIComponent(organizationId)}`
    : "/dashboard";
  const opportunitiesHref = organizationId
    ? `/opportunities?organizationId=${encodeURIComponent(organizationId)}`
    : "/opportunities";
  const portfolioHref = organizationId
    ? `/dashboard/portfolio?organizationId=${encodeURIComponent(organizationId)}`
    : "/dashboard/portfolio";
  const onboardingHref = organizationId
    ? `/onboarding?organizationId=${encodeURIComponent(organizationId)}&step=1`
    : "/onboarding?step=1";

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
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <section
          style={{
            ...shellCardStyle,
            background:
              "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,255,255,0.86) 100%)",
            border: "1px solid rgba(111, 87, 38, 0.16)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 18,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div style={{ maxWidth: 760 }}>
              <p
                style={{
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#916b22",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                {eyebrow}
              </p>
              <h1
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "clamp(2.2rem, 4.4vw, 4rem)",
                  lineHeight: 1.03,
                  margin: "14px 0 14px",
                }}
              >
                {title}
              </h1>
              <p style={{ margin: 0, lineHeight: 1.7, color: "#5e5241", fontSize: "1.03rem" }}>
                {description}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                <Link
                  href={dashboardHref}
                  style={buttonStyle(currentSection === "dashboard" ? "primary" : "secondary")}
                >
                  Dashboard
                </Link>
                <Link
                  href={portfolioHref}
                  style={buttonStyle(currentSection === "portfolio" ? "primary" : "secondary")}
                >
                  Portfolio
                </Link>
                <Link
                  href={opportunitiesHref}
                  style={buttonStyle(currentSection === "opportunities" ? "primary" : "secondary")}
                >
                  Opportunities
                </Link>
                <Link href={onboardingHref} style={buttonStyle("secondary")}>
                  Setup
                </Link>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <div style={{ color: "#5e5241", textAlign: "right", lineHeight: 1.45 }}>
                <div>Signed in workspace</div>
                <div>
                  <strong style={{ color: "#2d251a" }}>{activeWorkspaceName}</strong>
                </div>
              </div>
              <UserButton />
            </div>
          </div>
        </section>

        <section
          style={{
            ...shellCardStyle,
            marginTop: 18,
            padding: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#6b5d46",
              }}
            >
              Product Flow
            </div>
            <div style={{ marginTop: 8, lineHeight: 1.7, color: "#5e5241" }}>
              1. Set up the workspace.
              <br />
              2. Add programs, evidence, budgets, and documents.
              <br />
              3. Bring in a live opportunity.
              <br />
              4. Open one grant route and work it through review, submission, reporting, and
              lessons.
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#6b5d46",
              }}
            >
              Why This Matters
            </div>
            <div style={{ marginTop: 8, lineHeight: 1.7, color: "#5e5241" }}>
              A 2-person nonprofit team applies to 40 grants a year. They win 6. Grant Guardian
              changes that math.
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#6b5d46",
              }}
            >
              Notion
            </div>
            <div style={{ marginTop: 8, lineHeight: 1.7, color: "#5e5241" }}>
              The working record lives in Notion. The website is the operating surface that keeps
              syncing the decisions, drafts, reviews, submissions, reports, and lessons.
            </div>
          </div>
        </section>

        <div style={{ marginTop: 24 }}>{children}</div>
      </div>
    </main>
  );
}
