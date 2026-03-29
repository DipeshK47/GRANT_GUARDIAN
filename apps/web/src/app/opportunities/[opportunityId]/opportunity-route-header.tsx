import Link from "next/link";

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
});

type OpportunityRouteHeaderProps = {
  opportunityId: string;
  opportunityTitle: string;
  organizationId?: string | null;
  organizationName?: string | null;
  currentSection: "overview" | "reviews" | "submission" | "reporting" | "lessons";
  eyebrow: string;
  summary: string;
};

export function OpportunityRouteHeader({
  opportunityId,
  opportunityTitle,
  organizationId,
  organizationName,
  currentSection,
  eyebrow,
  summary,
}: OpportunityRouteHeaderProps) {
  const overviewHref = organizationId
    ? `/opportunities/${opportunityId}?organizationId=${encodeURIComponent(organizationId)}`
    : `/opportunities/${opportunityId}`;
  const dashboardHref = organizationId
    ? `/dashboard?organizationId=${encodeURIComponent(organizationId)}`
    : "/dashboard";
  const libraryHref = organizationId
    ? `/opportunities?organizationId=${encodeURIComponent(organizationId)}`
    : "/opportunities";

  const subrouteHref = (segment: string) =>
    organizationId
      ? `/opportunities/${opportunityId}/${segment}?organizationId=${encodeURIComponent(
          organizationId,
        )}`
      : `/opportunities/${opportunityId}/${segment}`;

  const navItems = [
    { key: "overview", label: "Overview", href: overviewHref },
    { key: "reviews", label: "Reviews", href: subrouteHref("reviews") },
    { key: "submission", label: "Submission", href: subrouteHref("submission") },
    { key: "reporting", label: "Reporting", href: subrouteHref("reporting") },
    { key: "lessons", label: "Lessons", href: subrouteHref("lessons") },
  ] as const;

  return (
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
        {eyebrow}
      </p>
      <h1
        style={{
          fontFamily:
            '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
          fontSize: "clamp(2.1rem, 4vw, 3.6rem)",
          lineHeight: 1.05,
          margin: "14px 0 16px",
          maxWidth: 900,
        }}
      >
        {opportunityTitle}
      </h1>
      <p style={{ maxWidth: 860, fontSize: "1.02rem", lineHeight: 1.7, margin: 0 }}>{summary}</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
        <Link href={dashboardHref} style={buttonStyle()}>
          Workspace home
        </Link>
        <Link href={libraryHref} style={buttonStyle()}>
          Opportunity library
        </Link>
        {organizationName ? (
          <span style={{ color: "#5e5241", alignSelf: "center" }}>
            Workspace: {organizationName}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
        {navItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            style={buttonStyle(item.key === currentSection ? "primary" : "secondary")}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
