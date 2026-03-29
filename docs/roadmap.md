# Implementation Roadmap

## Completed Foundation

- [x] Monorepo scaffold
- [x] Orchestrator app
- [x] Web app shell
- [x] Shared schemas and statuses
- [x] Environment validation
- [x] Local database schema
- [x] Drizzle connection + migrations
- [x] Gemini / Notion / ProPublica service shells
- [x] Notion workspace bootstrap workflow
- [x] Demo seed data + sample workspace records

## Completed Intake And Intelligence

- [x] Opportunity intake parser
- [x] Structured requirement extraction
- [x] Funder intelligence pipeline
- [x] ProPublica enrichment
- [x] Deep 990-PF parsing + recipient-level grant extraction
- [x] OCR fallback for scanned PDFs and image-based filings
- [x] Fit scoring foundation
- [x] Evidence coverage engine
- [x] Grounded draft generation
- [x] Evidence-cited answer assembly
- [x] Grant DNA alignment and funder-language-aware drafting

## Completed Human Review

- [x] Review workflow + approval queue
- [x] Human-in-the-loop draft gating
- [x] Submission readiness state
- [x] Task generation + blocker tracking
- [x] Notion sync for reviews, tasks, and submission readiness

## Completed Submission Preparation

- [x] Submission packet assembly
- [x] Safe pre-submit gating
- [x] Safe browser autopilot launch
- [x] Guarded submission session handoff
- [x] Second human confirmation before final submit authorization
- [x] Portal-aware field mapping
- [x] Guided form-fill without submit click
- [x] Portal schema capture
- [x] Reusable field profiles for Submittable forms
- [x] Attachment staging + local upload packaging
- [x] Document vault ingestion + file upload pipeline
- [x] Multipart uploads
- [x] Customer-scoped browser session storage
- [x] Backend portal discovery + portal URL capture
- [x] Submission adapter architecture for:
- [x] `Submittable`
- [x] `Email`
- [x] generic `Portal` fallback

## Data Model Coverage

- [x] Organization
- [x] Programs
- [x] Funders
- [x] Funder Filings
- [x] Opportunities
- [x] Requirements
- [x] Evidence Library
- [x] Documents
- [x] Budgets
- [x] Draft Answers
- [x] Tasks
- [x] Reviews / Approvals
- [x] Submissions
- [x] Agent Logs
- [x] Auth Tokens
- [x] Source Snapshots

## Demo And Storytelling Upgrades

- [x] Live Notion update moment
- [x] Stream step-level progress into Notion while agents run
- [x] Add plain-language progress log lines like:
- [x] `✅ Opportunity parsed`
- [x] `✅ Funder resolved`
- [x] `⏳ Pulling 990 filings...`
- [x] One-line agent summaries
- [x] After each agent completes, write one punchy human-readable summary to Notion and Agent Logs
- [x] 990 intelligence contrast
- [x] Add a side-by-side Notion view showing two similar-sounding funders with clearly different real giving patterns
- [x] Emotional hook integrated across docs, demo, and pitch
- [x] Use this line consistently:
- [x] `A 2-person nonprofit team applies to 40 grants a year. They win 6. Grant Guardian changes that math.`

## Still Open Product Work

- [x] Real-portal end-to-end hardening with live customer opportunities
- [x] Customer onboarding flow for first-time setup
- [x] Frontend intake + portal confirmation flow
- [x] True first-run onboarding + empty-state workspace UX
- [ ] Website productization + Notion-first UX wiring
- [x] Local sign-in and session-based workspace access for the local product
- [x] Guided `/app` dashboard with clearer first-run product framing
- [x] Reusable app shell with navigation and sign-out controls
- [x] Homepage workbench for analysis, drafting, review, submission, reporting, and lessons
- [x] Opportunity library route
- [x] Dedicated opportunity route with focused workbench
- [x] Website funder contrast panel
- [x] Default frontend Notion sync for intake, portal save, portal rediscovery, and workbench actions
- [x] Workspace creation sync to Notion
- [x] Dedicated routed pages for reviews, submissions, reporting, and lessons
- [x] Dedicated submission-session route with upload staging, field-plan inspection, and final authorization controls
- [ ] Dedicated routed funder library and funder detail pages
- [x] Submission session UI with final authorization controls
- [x] Post-award reporting workflows
- [x] Lessons / rejection memory workflow polish
- [x] Full production multi-tenant polish across every service path
- [ ] Live S3 / object storage verification against a real bucket
- [ ] Additional named portal adapters
- [ ] `Foundant`
- [ ] `Fluxx`
- [ ] `SurveyMonkey Apply`
- [ ] other specialized grant portals

## Architecture Status

- [x] Intake and parsing
- [x] Funder intelligence
- [x] Evidence matching and coverage
- [x] Grounded drafting
- [x] Review and approval orchestration
- [x] Submission assistance
- [x] Post-award reporting
