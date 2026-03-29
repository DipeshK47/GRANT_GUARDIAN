import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppShell } from "../app-shell";
import {
  getOpportunities,
  getOnboardingStatus,
  getOrganizations,
  normalizeOrganizationId,
  type OpportunityRecord,
} from "../lib/server-data";

export const dynamic = "force-dynamic";

const cardStyle: Record<string, string | number> = {
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

const readinessBadgeStyle = (level: OpportunityRecord["portalReadiness"]["level"]) => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  background:
    level === "Ready" ? "#dcfce7" : level === "Needs Review" ? "#ffedd5" : "#fee2e2",
  color: level === "Ready" ? "#14532d" : level === "Needs Review" ? "#9a4d00" : "#991b1b",
});

const wrapAnywhereStyle: Record<string, string | number> = {
  minWidth: 0,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

type OpportunityDirectoryPageProps = {
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunityDirectoryPage({
  searchParams,
}: OpportunityDirectoryPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const organizations = await getOrganizations(userId);
  const organizationId =
    normalizeOrganizationId(resolvedSearchParams?.organizationId) ?? organizations[0]?.id ?? null;
  const [opportunities, onboarding] = await Promise.all([
    getOpportunities(userId, organizationId),
    organizationId ? getOnboardingStatus(userId, organizationId) : Promise.resolve(null),
  ]);

  const selectedOrganization =
    organizations.find((organization) => organization.id === organizationId) ?? null;

  if (!selectedOrganization || !selectedOrganization.onboardingCompleted) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      currentSection="opportunities"
      eyebrow="Opportunity Library"
      title="Choose the grant route you want to operate next"
      description="This library is where a team moves from a workspace-level view into one grant at a time. Open the route for the opportunity you want to analyze, review, submit, report on, or learn from."
      organizationId={organizationId}
      workspaceName={selectedOrganization?.legalName ?? onboarding?.organizationName ?? null}
    >
        <section
          style={{
            ...cardStyle,
            background:
              "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,255,255,0.86) 100%)",
            border: "1px solid rgba(111, 87, 38, 0.16)",
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
            Workspace Scope
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
            <Link
              href={
                organizationId
                  ? `/dashboard?organizationId=${encodeURIComponent(organizationId)}`
                  : "/dashboard"
              }
              style={buttonStyle()}
            >
              Back to dashboard
            </Link>
            {selectedOrganization ? (
              <span style={{ color: "#5e5241", alignSelf: "center" }}>
                Viewing {selectedOrganization.legalName}
              </span>
            ) : (
              <span style={{ color: "#5e5241", alignSelf: "center" }}>
                Showing all opportunities available on this local machine
              </span>
            )}
          </div>
        </section>

        {organizations.length > 0 ? (
          <section style={{ ...cardStyle, marginTop: 24 }}>
            <div style={labelStyle}>Workspace Filters</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/opportunities" style={buttonStyle(organizationId ? "secondary" : "primary")}>
                All workspaces
              </Link>
              {organizations.map((organization) => (
                <Link
                  key={organization.id}
                  href={`/opportunities?organizationId=${encodeURIComponent(organization.id)}`}
                  style={buttonStyle(
                    organization.id === organizationId ? "primary" : "secondary",
                  )}
                >
                  {organization.dbaName || organization.legalName}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ ...cardStyle, marginTop: 24 }}>
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
              <p style={{ ...labelStyle, marginBottom: 6 }}>Live Opportunity Routes</p>
              <h2
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                  fontSize: "2rem",
                  margin: 0,
                }}
              >
                Choose the grant route you want to operate
              </h2>
            </div>
            <div style={{ color: "#5e5241" }}>{opportunities.length} opportunity record(s)</div>
          </div>

          <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
            {opportunities.length === 0 ? (
              <div style={{ color: "#5e5241", lineHeight: 1.7 }}>
                No opportunities are available for this filter yet. Start on the workspace home
                page to run intake and create the next one.
              </div>
            ) : null}

            {opportunities.map((opportunity) => {
              const href = `/opportunities/${opportunity.id}${
                opportunity.organizationId
                  ? `?organizationId=${encodeURIComponent(opportunity.organizationId)}`
                  : ""
              }`;

              return (
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
                    <div style={{ ...wrapAnywhereStyle, maxWidth: 780, flex: "1 1 460px" }}>
                      <h3 style={{ ...wrapAnywhereStyle, margin: 0, fontSize: "1.15rem" }}>
                        {opportunity.title}
                      </h3>
                      <p style={{ margin: "8px 0 0", color: "#5e5241", lineHeight: 1.6 }}>
                        {opportunity.rationale || "No intake summary saved yet."}
                      </p>
                    </div>
                    <div style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 0 }}>
                      <span style={readinessBadgeStyle(opportunity.portalReadiness.level)}>
                        {opportunity.portalReadiness.level}
                      </span>
                      <span style={{ color: "#6b5d46", fontSize: 13 }}>
                        {opportunity.portalReadiness.kind}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                      marginTop: 14,
                      color: "#5e5241",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={labelStyle}>Status</span>
                      <div style={wrapAnywhereStyle}>{opportunity.status}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={labelStyle}>Submission method</span>
                      <div style={wrapAnywhereStyle}>{opportunity.submissionMethod ?? "Unknown"}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={labelStyle}>Deadline</span>
                      <div style={wrapAnywhereStyle}>{opportunity.deadline ?? "Not captured"}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={labelStyle}>Preferred browser URL</span>
                      <div style={wrapAnywhereStyle}>
                        {opportunity.portalReadiness.preferredBrowserUrl ?? "Not ready yet"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
                    <Link href={href} style={buttonStyle("primary")}>
                      Open opportunity route
                    </Link>
                    <Link href={`/${opportunity.organizationId ? `?organizationId=${encodeURIComponent(opportunity.organizationId)}` : ""}`} style={buttonStyle()}>
                      Open on workspace home
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
    </AppShell>
  );
}
