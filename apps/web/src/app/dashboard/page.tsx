import { redirect } from "next/navigation";
import { AppShell } from "../app-shell";
import { NotionSyncCard } from "./notion-sync-card";
import { HomeClient } from "../home-client";
import {
  getNotionSyncStatus,
  getOnboardingStatus,
  getOrganizations,
  normalizeOrganizationId,
} from "../lib/server-data";
import { requireClerkUserId } from "../lib/clerk-auth";

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

type DashboardPageProps = {
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const userId = await requireClerkUserId();

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedOrganizationId = normalizeOrganizationId(resolvedSearchParams?.organizationId);
  const organizations = await getOrganizations(userId);
  const selectedOrganization =
    organizations.find((organization) => organization.id === requestedOrganizationId) ??
    organizations[0] ??
    null;
  const organizationId = selectedOrganization?.id ?? null;

  if (!selectedOrganization || !selectedOrganization.onboardingCompleted) {
    redirect("/onboarding");
  }

  const [onboarding, notionSyncStatus] = await Promise.all([
    organizationId ? getOnboardingStatus(userId, organizationId) : Promise.resolve(null),
    getNotionSyncStatus(userId),
  ]);
  const contextReadiness = [
    {
      label: "Programs",
      count: onboarding?.counts.programs ?? 0,
      target: 1,
      href: "#program-context",
      action: "Add one real program",
    },
    {
      label: "Evidence items",
      count: onboarding?.counts.evidence ?? 0,
      target: 2,
      href: "#program-context",
      action: "Save two grounded proof points",
    },
    {
      label: "Structured budgets",
      count: onboarding?.counts.budgets ?? 0,
      target: 1,
      href: "#program-context",
      action: "Capture one usable budget row",
    },
    {
      label: "Ready documents",
      count: onboarding?.counts.readyDocuments ?? 0,
      target: 2,
      href: "#document-vault",
      action: "Upload your core files",
    },
  ];
  const fullyContextReady = contextReadiness.every((item) => item.count >= item.target);
  const opportunityLibraryHref = organizationId
    ? `/opportunities?organizationId=${encodeURIComponent(organizationId)}`
    : "/opportunities";
  const portfolioHref = organizationId
    ? `/dashboard/portfolio?organizationId=${encodeURIComponent(organizationId)}`
    : "/dashboard/portfolio";

  return (
    <AppShell
      currentSection="dashboard"
      eyebrow="Workspace Dashboard"
      title="Operate one nonprofit workspace from intake to reporting"
      description="This is the main operating surface for a real team. Start with onboarding, intake one live opportunity, then open a dedicated grant route and move it through analysis, review, submission, reporting, and lessons."
      organizationId={organizationId}
      workspaceName={selectedOrganization?.legalName ?? onboarding?.organizationName ?? null}
    >
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        <article style={cardStyle}>
          <div style={labelStyle}>Current workspace</div>
          <div style={{ fontSize: "1.5rem", marginTop: 8 }}>
            {selectedOrganization?.legalName ?? "Choose a workspace below"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {selectedOrganization?.mission ?? "Create or open a workspace to begin."}
          </p>
        </article>
        <article style={cardStyle}>
          <div style={labelStyle}>Setup readiness</div>
          <div style={{ fontSize: "2.5rem", marginTop: 8 }}>
            {onboarding ? `${onboarding.setupReadinessPercent}%` : "0%"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Next move:{" "}
            {onboarding?.nextRecommendedAction ?? "Open a workspace and follow the guide."}
          </p>
        </article>
        <article style={cardStyle}>
          <div style={labelStyle}>Notion</div>
          <div style={{ fontSize: "1.5rem", marginTop: 8 }}>
            {onboarding?.notion?.authenticated ? "Connected" : "Needs attention"}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            {onboarding?.notion?.workspaceName
              ? `Workspace: ${onboarding.notion.workspaceName}`
              : "Connect and bootstrap Notion so the operating record stays live."}
            <br />
            <a href="/onboarding?step=1" style={{ color: "#0f766e" }}>
              Switch Notion workspace
            </a>
          </p>
        </article>
        <NotionSyncCard
          organizationId={organizationId}
          initialStatus={notionSyncStatus}
          cardStyle={cardStyle}
          labelStyle={labelStyle}
        />
        <article style={cardStyle}>
          <div style={labelStyle}>Opportunity routes</div>
          <div style={{ fontSize: "1.5rem", marginTop: 8 }}>
            {onboarding?.counts.opportunities ?? 0}
          </div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Open the library to work one grant at a time.
            <br />
            <a href={opportunityLibraryHref} style={{ color: "#0f766e" }}>
              Go to opportunity library
            </a>
          </p>
        </article>
        <article style={cardStyle}>
          <div style={labelStyle}>Portfolio optimizer</div>
          <div style={{ fontSize: "1.5rem", marginTop: 8 }}>This week</div>
          <p style={{ color: "#5c5140", marginBottom: 0 }}>
            Rank the live pipeline, compare fit versus effort, and turn limited team hours into a
            concrete weekly plan.
            <br />
            <a href={portfolioHref} style={{ color: "#0f766e" }}>
              Open portfolio view
            </a>
          </p>
        </article>
      </section>

      <section
        style={{
          ...cardStyle,
          marginTop: 24,
        }}
      >
        <p style={{ ...labelStyle, marginBottom: 6 }}>Getting Started</p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: 0,
          }}
        >
          The first 4 things a new team should do here
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 18,
          }}
        >
          {[
            {
              title: "1. Complete your org profile",
              body:
                onboarding?.steps.find((step) => step.key === "organization-profile")?.summary ??
                "Save the nonprofit's legal identity, EIN, mission, and grants contact.",
            },
            {
              title: "2. Upload your core documents",
              body:
                onboarding?.steps.find((step) => step.key === "documents")?.summary ??
                "Upload the 501(c)(3), budget support, and save the browser session for portal work.",
            },
            {
              title: "3. Add your first grant opportunity",
              body:
                "Paste an opportunity URL or RFP text so Grant Guardian can create the record, discover the portal, and sync it to Notion.",
            },
            {
              title: "4. Run your first full grant analysis.",
              body:
                "Run analysis, drafting, review, submission, reporting, and lessons from the dedicated opportunity pages instead of juggling tabs.",
            },
          ].map((item) => (
            <article
              key={item.title}
              style={{
                border: "1px solid rgba(88, 75, 49, 0.14)",
                borderRadius: 18,
                padding: 18,
                background: "#fffdf8",
              }}
            >
              <div style={{ ...labelStyle, marginBottom: 6 }}>{item.title}</div>
              <div style={{ color: "#5e5241", lineHeight: 1.7 }}>{item.body}</div>
            </article>
          ))}
        </div>
      </section>

      <section
        style={{
          ...cardStyle,
          marginTop: 24,
        }}
      >
        <p style={{ ...labelStyle, marginBottom: 6 }}>Launch Readiness</p>
        <h2
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: 0,
          }}
        >
          Before you trust the fit score and drafts, make this workspace concrete
        </h2>
        <p style={{ color: "#5e5241", lineHeight: 1.7, maxWidth: 860, marginTop: 12 }}>
          A brand-new workspace can still analyze a grant, but the result is more preliminary than
          final. Add one real program, a couple of evidence points, a structured budget, and the
          core documents so the score and narrative suggestions are truly about this nonprofit.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 18,
          }}
        >
          {contextReadiness.map((item) => {
            const ready = item.count >= item.target;
            return (
              <article
                key={item.label}
                style={{
                  border: "1px solid rgba(88, 75, 49, 0.14)",
                  borderRadius: 18,
                  padding: 18,
                  background: "#fffdf8",
                }}
              >
                <div style={{ ...labelStyle, marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: "2rem", color: ready ? "#0f766e" : "#2d251a" }}>
                  {item.count}/{item.target}
                </div>
                <p style={{ color: "#5e5241", lineHeight: 1.7, marginBottom: 12 }}>
                  {ready ? "Ready enough for grounded automation." : item.action}
                </p>
                <a href={item.href} style={{ color: "#0f766e" }}>
                  Go there now
                </a>
              </article>
            );
          })}
        </div>
        <p
          style={{
            color: fullyContextReady ? "#14532d" : "#9a4d00",
            lineHeight: 1.7,
            marginTop: 16,
            marginBottom: 0,
          }}
        >
          {fullyContextReady
            ? "This workspace has the minimum context needed for a much more trustworthy first-pass score."
            : "Treat early scores as preliminary until these records are in place."}
        </p>
      </section>

      <div style={{ marginTop: 24 }}>
        <HomeClient
          initialOrganizations={organizations}
          initialOrganizationId={organizationId}
          pageMode="home"
        />
      </div>
    </AppShell>
  );
}
