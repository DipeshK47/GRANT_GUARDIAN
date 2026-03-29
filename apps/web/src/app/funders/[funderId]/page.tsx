import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../app-shell";
import { getFunderDetail } from "../../lib/server-data";

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

const buttonStyle = {
  borderRadius: 999,
  border: "1px solid rgba(73, 63, 46, 0.18)",
  background: "#fffdf8",
  color: "#2d251a",
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const formatCurrency = (value?: number | null) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "Needs research";

type FunderDetailPageProps = {
  params: Promise<{
    funderId: string;
  }>;
};

export default async function FunderDetailPage({ params }: FunderDetailPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const { funderId } = await params;
  const detail = await getFunderDetail(userId, funderId);
  if (!detail) {
    notFound();
  }

  const topPhrases = detail.funder.grantDnaTopPhrases
    .map((phrase) =>
      typeof phrase === "string"
        ? phrase.trim()
        : typeof phrase === "object" && phrase && "term" in phrase
          ? String((phrase as { term?: unknown }).term ?? "").trim()
          : String(phrase).trim(),
    )
    .filter(Boolean);

  return (
    <AppShell
      currentSection="opportunities"
      eyebrow="Funder DNA"
      title={detail.funder.name}
      description="Inspect the vocabulary fingerprint Grant Guardian has assembled from this funder’s public language, RFP signals, and 990 descriptions. Use it to pressure-test whether your drafts sound like your facts in the funder’s frame."
      workspaceName={null}
    >
      <section style={{ ...cardStyle, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={labelStyle}>Grant DNA Profile</div>
            <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
              EIN {detail.funder.ein ?? "Needs research"} · Average grant {formatCurrency(detail.funder.averageGrant)} · Median grant {formatCurrency(detail.funder.medianGrant)}
            </div>
          </div>
          <Link href="/opportunities" style={buttonStyle}>
            Back to opportunities
          </Link>
        </div>

        <div>
          <div style={{ ...labelStyle, marginBottom: 10 }}>Top phrases</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {topPhrases.length > 0 ? (
              topPhrases.map((phrase, index) => (
                <span
                  key={`${phrase}-${index}`}
                  style={{
                    borderRadius: 999,
                    padding: "7px 12px",
                    fontSize: 13,
                    background: "#eef8f6",
                    color: "#0f5d56",
                    border: "1px solid rgba(45, 122, 107, 0.18)",
                  }}
                >
                  {phrase}
                </span>
              ))
            ) : (
              <span style={{ color: "#6b5d46" }}>Research this funder to capture repeated terms.</span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 16, background: "#fffdf8" }}>
            <div style={labelStyle}>Framing style</div>
            <div style={{ color: "#2d251a", lineHeight: 1.7 }}>
              {detail.funder.framingStyles.join(" · ") || "Still learning this funder’s framing style"}
            </div>
          </div>
          <div style={{ border: "1px solid rgba(73, 63, 46, 0.14)", borderRadius: 16, padding: 16, background: "#fffdf8" }}>
            <div style={labelStyle}>Tone summary</div>
            <div style={{ color: "#5c5140", lineHeight: 1.7 }}>{detail.funder.toneSummary}</div>
          </div>
        </div>

        <div style={{ color: "#6b5d46", fontSize: 13 }}>{detail.funder.sourceLine}</div>
      </section>

      <section style={{ ...cardStyle, marginTop: 24 }}>
        <div style={labelStyle}>Draft Alignment</div>
        <h2
          style={{
            fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "2rem",
            margin: "8px 0 16px",
          }}
        >
          Current draft answers against this funder’s language
        </h2>

        <div style={{ display: "grid", gap: 14 }}>
          {detail.drafts.length === 0 ? (
            <div style={{ color: "#5c5140", lineHeight: 1.7 }}>
              No draft answers exist for this funder yet. Generate drafts from an opportunity route
              to see DNA scores and language suggestions here.
            </div>
          ) : null}

          {detail.drafts.map((draft) => (
            <article
              key={draft.id}
              style={{
                border: "1px solid rgba(73, 63, 46, 0.14)",
                borderRadius: 16,
                padding: 16,
                background: "#fffdf8",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong style={{ color: "#2d251a" }}>{draft.questionText}</strong>
                  <div style={{ color: "#5c5140", marginTop: 6 }}>{draft.opportunityTitle}</div>
                </div>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "6px 10px",
                    background:
                      draft.dnaMatchScore >= 70
                        ? "#dcfce7"
                        : draft.dnaMatchScore >= 40
                          ? "#ffedd5"
                          : "#fee2e2",
                    color:
                      draft.dnaMatchScore >= 70
                        ? "#166534"
                        : draft.dnaMatchScore >= 40
                          ? "#9a4d00"
                          : "#991b1b",
                    fontSize: 12,
                  }}
                >
                  DNA match {Math.round(draft.dnaMatchScore)}%
                </span>
              </div>

              <div style={{ color: "#5c5140", lineHeight: 1.7, marginTop: 12 }}>
                {draft.dnaSuggestions.length > 0 ? (
                  draft.dnaSuggestions.slice(0, 2).map((suggestion) => (
                    <div key={suggestion}>• {suggestion}</div>
                  ))
                ) : (
                  <div>This draft already reflects the strongest visible funder language reasonably well.</div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <Link href={`/opportunities/${draft.opportunityId}`} style={buttonStyle}>
                  Open opportunity route
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
