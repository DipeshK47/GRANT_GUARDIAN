# 🛡️ Grant Guardian

> **A Notion-native AI operating system for the full grant lifecycle — from pursuit decision to post-award compliance.**

Grant Guardian helps small nonprofits decide which grants are worth pursuing, map existing evidence to every application question, write in each funder's language, remember past losses, automate Submittable admin work, and stay compliant after award — all inside Notion.

---

## 🎯 The Problem

Small nonprofits don't lose grants because they lack mission fit. They lose because the work is fragmented and capacity is thin.

- Funder research is shallow and based on website copy, not actual giving behavior
- Organizational evidence is scattered across PDFs, old proposals, and staff heads
- The same org details are re-entered manually for every application
- Teams spend scarce hours on low-fit opportunities they were never going to win
- Proposal knowledge disappears when staff leave
- Most tools stop at submission and completely ignore reporting obligations

**The real gap is not "writing help." It is decision quality, operational structure, and institutional memory.**

---

## ✨ What Grant Guardian Does

Paste a funder URL, RFP link, PDF, or Submittable opportunity. The system:

1. 🏗️ Builds a structured opportunity workspace in Notion automatically
2. 🔍 Pulls real IRS 990-PF intelligence from ProPublica — what the funder *actually* funds vs. what they say
3. 🧬 Extracts the funder's linguistic fingerprint (Grant DNA)
4. 📊 Scores fit, effort, evidence coverage, and priority
5. 🗂️ Maps every application question to your existing evidence
6. ✍️ Drafts grounded answers using only verified evidence
7. 🤖 Assists with Submittable org-field entry via browser automation
8. 🧠 Stores rejection feedback as permanent institutional memory
9. 🏆 Creates a full compliance workspace automatically when a grant is awarded

---

## 🚀 Five Flagship Features

### 1. IRS 990 Intelligence via ProPublica + 990-PF Parsing
Evaluates what funders *actually* fund using real tax filings — not just their marketing language. Computes average grant size, geography concentration, repeat-grantee bias, and small-org friendliness. Surfaces a "website says vs. actual behavior" comparison directly in Notion.

### 2. Grant DNA Extraction
Builds a weighted vocabulary fingerprint from the funder's website, RFP, annual reports, and 990 purpose descriptions. Flags language mismatches in your drafts and suggests aligned alternatives — without changing your facts.

### 3. Grant Portfolio Optimizer
Ranks all open opportunities against your available staff hours this month. Classifies each as **Pursue Now**, **Revisit Later**, or **Skip** using a transparent priority formula:

```
Priority = (Fit × 0.40) + (Evidence Coverage × 0.30) + (Deadline Proximity × 0.20) − (Effort × 0.10)
```

### 4. Rejection Memory and Loss Analysis
When a grant is rejected, the system captures reviewer feedback, extracts recurring themes, and stores them on the Funder record. The next time you apply to that funder, it surfaces warnings like: *"Last time, they raised concerns about your evaluation methodology."*

### 5. Submittable-Specific Autopilot
Uses Playwright to prefill deterministic org-profile fields in Submittable forms. Pauses at narrative sections and requires human approval before any submission action. Every browser step is logged back to Notion.

---

## 🎖️ Two Centerpiece Support Features

### Evidence Coverage Meter
Every application question gets a **Green / Amber / Red** coverage status based on what's in your evidence library. The dashboard headline tells you instantly: *"14 of 19 questions answered with evidence. 5 require new content."*

### Post-Award Reporting Engine
When an opportunity status changes to **Awarded**, the system automatically creates a full compliance workspace: reporting calendar, promised outcomes tracker, required metrics log, program staff task list, and draft report templates seeded from your proposal commitments.

---

## 🏗️ Architecture

Grant Guardian is built as a multi-agent orchestrator with Notion MCP as the control plane.

```
┌─────────────────────────────────────────────────────────┐
│                     User Input                          │
│         (URL / PDF / RFP / Submittable link)            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  Orchestrator                           │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │Intake Agent │  │  Funder      │  │  Grant DNA    │  │
│  │             │  │Intelligence  │  │  Agent        │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Fit Agent  │  │Evidence Agent│  │Narrative Agent│  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │Review Agent │  │Submission    │  │  Compliance   │  │
│  │             │  │Agent         │  │  Agent        │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  Notion MCP                             │
│           (The visible control plane)                   │
│                                                         │
│  • Organization    • Funders         • Opportunities    │
│  • Evidence Library• Draft Answers   • Tasks            │
│  • Reporting Cal.  • Agent Logs      • Lessons          │
└─────────────────────────────────────────────────────────┘
```

---

## 🗂️ Notion Workspace

Notion is the source of truth. All agent outputs are written directly to linked Notion databases.

| Database | Purpose |
|---|---|
| Organization | Org profile, boilerplate, geographies |
| Programs | Programs, outcomes, metrics, evidence links |
| Funders | Funder records, DNA, 990 intelligence |
| Funder Filings | Parsed 990-PF data per tax year |
| Opportunities | All active and historical grant opportunities |
| Requirements | Per-question records linked to each opportunity |
| Evidence Library | Reusable evidence items with embedding index |
| Documents | Org docs with expiration tracking |
| Draft Answers | Grounded drafts with evidence refs and DNA scores |
| Tasks | Team tasks linked to opportunities and questions |
| Reviews / Approvals | Human approval workflow |
| Submissions | Submission packet tracking |
| Reporting Calendar | Post-award compliance tasks |
| Lessons / Rejections | Rejection memory and loss analysis |
| Agent Logs | Full audit trail of every agent action |

### Key Dashboard Views
- **Pursue This Week** — ranked opportunities by priority score
- **Evidence Coverage** — green/amber/red per question across all active grants
- **Reviewer Inbox** — pending approvals and bottleneck alerts
- **Portfolio Matrix** — fit vs. effort view for all open opportunities
- **Reports Due** — awarded grant reporting deadlines

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Backend | Node.js + Fastify |
| Notion Integration | Notion MCP |
| Browser Automation | Playwright |
| Database | SQLite + Drizzle ORM |
| AI / NLP | Gemini/OpenAI (GPT-4,Gemini-2.5, text-embedding-3-large) |
| Funder Data | ProPublica Nonprofit Explorer API |
| Filing Parsing | XML + PDF parsers for 990-PF filings |
| Optional UI | Next.js operator dashboard |
| Package Manager | pnpm (monorepo) |

---

## 📁 Repository Structure

```
grant-guardian/
├── apps/
│   ├── orchestrator/          # Core AI orchestrator
│   │   └── src/
│   │       ├── agents/        # All agent implementations
│   │       ├── services/      # Notion, ProPublica, Gemini/OpenAI, etc.
│   │       ├── workflows/     # End-to-end workflow runners
│   │       ├── scoring/       # Fit, priority, DNA scoring
│   │       └── db/            # Schema and migrations
│   └── web/                   # Optional operator dashboard
├── packages/
│   └── shared/                # Types, schemas, prompts, constants
├── data/
│   ├── demo/                  # Seeded demo dataset
│   ├── snapshots/             # Source filing caches
│   └── uploads/               # Uploaded RFPs and docs
├── scripts/
│   ├── bootstrap-notion.ts    # One-command Notion workspace setup
│   ├── seed-demo.ts           # Seed demo nonprofit and funders
│   ├── run-opportunity.ts     # Run the full intake pipeline
│   └── run-demo.ts            # Execute the full demo sequence
└── docs/
    ├── architecture.md
    ├── schema.md
    ├── scoring.md
    └── demo-script.md
```

---

## ⚙️ Setup

### Prerequisites
- Node.js 18+
- pnpm
- Notion account with MCP enabled
- Gemini/OpenAI API key
- Playwright (for Submittable automation)

### 1. Clone the repo

```bash
git clone https://github.com/your-username/grant-guardian.git
cd grant-guardian
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:
```env
GEMINI/OPENAI_API_KEY=your_key_here
NOTION_MCP_SERVER_URL=your_mcp_server_url
NOTION_OAUTH_CLIENT_ID=your_client_id
NOTION_OAUTH_CLIENT_SECRET=your_client_secret
```

See `.env.example` for the full list of variables.

### 3. Set up the database

```bash
pnpm db:generate
pnpm db:migrate
```

### 4. Bootstrap the Notion workspace

```bash
pnpm bootstrap:notion
```

This creates all 15 databases, linked views, and dashboard pages in your Notion workspace with a single command.

### 5. Seed the demo nonprofit

```bash
pnpm seed:demo
```

Seeds one demo nonprofit, 2 programs, sample evidence, 5 opportunities, and 2 contrasting funders.

### 6. Run the full pipeline

```bash
pnpm run:opportunity -- --url "https://example-funder.org/grants"
```

---

## 🎬 Demo

The demo follows this sequence:

1. Show the nonprofit's Notion home page
2. Paste a new grant opportunity link
3. Watch the Opportunity page and Requirements populate in real time
4. Show 990-based funder intelligence — "website says vs. actual giving behavior"
5. Compare two similar funders — one funds large orgs, one funds small nonprofits
6. Show evidence coverage headline: *"14 of 19 questions covered"*
7. Open one question and show a grounded draft answer with evidence references and Grant DNA alignment suggestions
8. Show the portfolio view — all active grants ranked by available staff hours
9. Show rejection memory warning on a returning funder
10. Open Submittable — watch org details autofill
11. Mark a grant Awarded — watch the reporting workspace appear instantly

---

## 📊 Scoring Models

### Fit Score (weighted)
| Component | Weight |
|---|---|
| Mission alignment | 20% |
| Historical grant-size fit | 15% |
| Evidence coverage | 15% |
| Geography match | 10% |
| Program match | 10% |
| Small-org friendliness | 10% |
| Grant DNA match | 10% |
| Deadline feasibility | 5% |
| Reporting burden (inverse) | 5% |

### Priority Score
```
Priority = (Fit × 0.40) + (Evidence Coverage × 0.30) + (Deadline Proximity × 0.20) − (Effort × 0.10)
```

All scores include an explainability output — every number has a plain-English rationale attached.

---

## 🔒 Ethical Guardrails

- No invented facts in proposals — drafts cite evidence or are explicitly flagged as unsupported
- No blind submission — human approval is required before any portal action
- No financial or legal advice framing
- Filing-derived insights always show source year and confidence level
- Portal credentials are never stored in Notion
- Scope is limited to private foundation grants in v1

---

## ⚠️ Known Limitations

- ProPublica filing structure varies across organizations and tax years — XML fallback to PDF is implemented
- Funder website content can be inconsistent — confidence labels are shown
- Submittable form layouts may vary — field mapping is configurable
- Federal grants are not supported in v1
- Only Submittable is supported as a portal in v1

---

## 🗺️ Roadmap

- [ ] Additional portal support (Fluxx, Instrumentl, Foundant)
- [ ] Federal grant support (SAM.gov, Grants.gov)
- [ ] Multi-user workspace with role-based access
- [ ] Funder relationship tracking and outreach history
- [ ] Automated LOI drafting
- [ ] Board report generation from awarded grant data

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

- [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits/) for public IRS filing data
- [Notion MCP](https://developers.notion.com/docs/mcp) for the workspace integration layer
- Every small nonprofit development director who inspired this project

---

*Built for the [Notion MCP Challenge](https://dev.to/challenges/notion-2026-03-04) — DEV × MLH × Notion*
