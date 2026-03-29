import Link from "next/link";

export const dynamic = "force-dynamic";

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
  padding: "12px 16px",
  fontSize: 15,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});

const sectionEyebrowStyle: Record<string, string | number> = {
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#916b22",
  fontSize: 12,
  margin: 0,
};

const sectionHeadingStyle: Record<string, string | number> = {
  fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
  fontSize: "clamp(2rem, 4vw, 3.3rem)",
  lineHeight: 1.05,
  margin: "14px 0 16px",
};

const agentCards = [
  {
    index: "1",
    title: "Intake Agent",
    body: "Turns a URL or PDF into a structured opportunity.",
  },
  {
    index: "2",
    title: "Funder Intelligence Agent",
    body: "Pulls IRS 990-PF data via ProPublica to show real giving behavior, not just website copy.",
  },
  {
    index: "3",
    title: "Fit Agent",
    body: "Scores mission alignment, geography, evidence coverage, grant size fit, and deadline feasibility.",
  },
  {
    index: "4",
    title: "Evidence Agent",
    body: "Maps your existing org documents to every application question with green, amber, and red coverage.",
  },
  {
    index: "5",
    title: "Narrative Agent",
    body: "Drafts grounded answers using only your real evidence, aligned to the funder's language fingerprint.",
  },
  {
    index: "6",
    title: "Submission Agent",
    body: "Assists with Submittable form entry and assembles the final packet.",
  },
  {
    index: "7",
    title: "Reporting Agent",
    body: "Creates a full compliance workspace automatically when you win.",
  },
];

const featureCards = [
  {
    title: "IRS 990 Intelligence",
    body: "See what funders actually fund, not just what their website says. We parse real 990-PF filings to show grant size distribution, geography focus, repeat grantee bias, and small-org friendliness.",
  },
  {
    title: "Grant DNA Extraction",
    body: "Every funder has a linguistic fingerprint. We model their vocabulary from RFPs, annual reports, and filing language, then align your drafts to match without changing your facts.",
  },
  {
    title: "Grant Portfolio Optimizer",
    body: "Rank every open opportunity by fit score, evidence coverage, effort, and deadline. Know exactly where to spend your limited hours this week.",
  },
  {
    title: "Rejection Memory",
    body: "Every loss becomes an asset. Rejection feedback is stored on the funder record and surfaced automatically the next time you apply.",
  },
  {
    title: "Submittable Autopilot",
    body: "We prefill your organization profile fields automatically and pause before any narrative or sensitive section. No blind submissions.",
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(196,143,44,0.22), transparent 30%), linear-gradient(180deg, #f7f1e4 0%, #fffdfa 48%, #f5efe5 100%)",
        padding: "40px 20px 80px",
        color: "#1f2933",
        scrollBehavior: "smooth",
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
          <p style={sectionEyebrowStyle}>Grant Guardian</p>
          <h1
            style={{
              fontFamily:
                '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
              fontSize: "clamp(2.8rem, 6vw, 5.2rem)",
              lineHeight: 1.01,
              margin: "14px 0 18px",
              maxWidth: 920,
            }}
          >
            A 2-person nonprofit team applies to 40 grants a year. They win 6. Grant Guardian
            changes that math.
          </h1>
          <p style={{ maxWidth: 920, fontSize: "1.08rem", lineHeight: 1.75, margin: 0 }}>
            Paste a funder URL. Grant Guardian researches their IRS 990 filings, scores your fit,
            maps your existing evidence to every question, drafts grounded answers in the funder's
            language, and creates a full reporting workspace the moment you win.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
            <Link href="/sign-up" style={buttonStyle("primary")}>
              Get started free
            </Link>
            <a href="#how-it-works" style={buttonStyle()}>
              See how it works
            </a>
          </div>
        </section>

        <section id="how-it-works" style={{ marginTop: 28 }}>
          <p style={sectionEyebrowStyle}>How It Works</p>
          <h2 style={sectionHeadingStyle}>Seven agents, one operating system for grant work</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {agentCards.map((card) => (
              <article key={card.index} style={shellCardStyle}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    background: "rgba(15, 118, 110, 0.12)",
                    color: "#115e59",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                  }}
                >
                  {card.index}
                </div>
                <h3 style={{ margin: "18px 0 8px", fontSize: "1.08rem" }}>{card.title}</h3>
                <p style={{ margin: 0, color: "#5e5241", lineHeight: 1.7 }}>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <p style={sectionEyebrowStyle}>Key Features</p>
          <h2 style={sectionHeadingStyle}>Built for how small nonprofit teams actually work</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {featureCards.map((feature) => (
              <article key={feature.title} style={shellCardStyle}>
                <h3 style={{ margin: "0 0 10px", fontSize: "1.1rem" }}>{feature.title}</h3>
                <p style={{ margin: 0, color: "#5e5241", lineHeight: 1.75 }}>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <article
            style={{
              ...shellCardStyle,
              textAlign: "center",
              padding: 36,
              background:
                "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,255,255,0.86) 100%)",
            }}
          >
            <p style={sectionEyebrowStyle}>Why It Matters</p>
            <div
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                fontSize: "clamp(2rem, 4vw, 3.4rem)",
                lineHeight: 1.12,
                maxWidth: 920,
                margin: "14px auto 0",
              }}
            >
              The average small nonprofit development team spends 60% of their grant hours on
              research, intake, and admin — before a single word of the proposal is written. Grant
              Guardian handles that layer so your team can focus on strategy and relationships.
            </div>
          </article>
        </section>

        <section style={{ marginTop: 28 }}>
          <article style={shellCardStyle}>
            <p style={sectionEyebrowStyle}>Start Here</p>
            <h2 style={sectionHeadingStyle}>Choose the path that matches your team</h2>
            <p style={{ maxWidth: 760, color: "#5e5241", lineHeight: 1.75, marginTop: 0 }}>
              Create a workspace if this is your first time. If you already have one, head straight
              into the product and pick up where your team left off.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/sign-in" style={buttonStyle()}>
                Sign in
              </Link>
              <Link href="/sign-up" style={buttonStyle("primary")}>
                Create workspace
              </Link>
            </div>
          </article>
        </section>

        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 28,
            padding: "0 4px",
            color: "#5e5241",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: "#2d251a" }}>Grant Guardian</div>
            <div>Notion-native grant intelligence for lean nonprofit teams.</div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href="https://github.com" style={{ color: "#0f766e", textDecoration: "none" }}>
              GitHub
            </a>
            <Link href="/sign-in" style={{ color: "#0f766e", textDecoration: "none" }}>
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
