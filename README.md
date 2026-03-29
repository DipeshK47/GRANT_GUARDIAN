# Grant Guardian

Grant Guardian is a Notion-native AI operating system for nonprofit grant work.

> A 2-person nonprofit team applies to 40 grants a year. They win 6. Grant Guardian changes that math.

The product helps small nonprofits decide what to pursue, map evidence to each question, draft grounded answers, preserve rejection memory, assist with Submittable, and generate post-award reporting workflows from one local workspace with live Notion integration.

## Why this exists

Most small nonprofit teams do not have a dedicated grant operations function. They are juggling scattered opportunity links, reused narratives, attachment hunts, portal deadlines, and post-award promises across email, docs, and memory. Grant Guardian turns that chaos into one working system:

- intake and portal discovery
- 990 intelligence and fit scoring
- grounded drafting and review
- guarded submission support
- reporting and lessons memory

## Core stack

- Node.js + TypeScript
- Fastify orchestrator
- Gemini API for extraction, drafting, and scoring support
- Notion MCP for workspace orchestration
- SQLite + Drizzle ORM
- Playwright for Submittable automation

## Important Notion integration constraints

- Authentication is user-based OAuth
- The app bootstraps its own Grant Guardian workspace structure underneath one page the user shares during Notion authorization
- File uploads are not supported through Notion today, so the document vault keeps files locally and syncs metadata into Notion
- Human approval should remain in the loop before sensitive actions

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in:
   - `GEMINI_API_KEY`
   - Clerk keys
   - Notion OAuth keys
3. Install dependencies
4. Run `npm run dev`
5. Open `http://localhost:3000`
6. Sign up, connect one Notion page, and finish onboarding

## First-time user guide

If you want the end-to-end product flow for a brand-new user, start here:

- [New User Guide](/Users/dipeshkumar/Desktop/grant_guardian/docs/new-user-guide.md)
- [Local Launch Checklist](/Users/dipeshkumar/Desktop/grant_guardian/docs/local-launch-checklist.md)

## Submittable session capture

When you are ready to prepare the browser automation part of the demo:

1. Install the Playwright-managed Chromium browser with `npm run submittable:install-browser`
2. Run `npm run submittable:save-session`
3. Log into Submittable manually in the opened browser
4. Return to the terminal and press Enter
5. The authenticated session will be saved to `data/browser/storage-state.json`

## Workspace shape

The implementation is built around these core Notion databases:

- Organization
- Programs
- Funders
- Funder Filings
- Opportunities
- Requirements
- Evidence Library
- Documents
- Budgets
- Draft Answers
- Tasks
- Reviews / Approvals
- Submissions
- Reporting Calendar
- Lessons / Rejections
- Agent Logs
