# New User Guide

This guide is for a brand-new Grant Guardian user running the product locally for the first time.

## What Grant Guardian Does

Grant Guardian helps a small nonprofit team move one grant from intake to submission support without juggling scattered docs, old drafts, and memory.

The system is built around this flow:

1. Connect your Notion workspace
2. Create or open your nonprofit workspace
3. Add a real opportunity
4. Run analysis
5. Review evidence coverage and fit
6. Generate drafts
7. Move into review and submission
8. Track reporting and lessons after the decision

## Before You Start

Make sure these are true:

- The web app is running locally
- The orchestrator backend is running locally
- You have a Clerk account ready to sign in
- You have a Notion account you want Grant Guardian to sync into

Typical local startup:

```bash
cd ~/Desktop/grant_guardian
npm run dev:orchestrator
```

In another terminal:

```bash
cd ~/Desktop/grant_guardian
npm run dev:web
```

Then open:

```text
http://localhost:3000
```

## First-Time Flow

### 1. Sign Up

Go to the homepage and click `Get started free` or `Create workspace`.

You will land on Clerk sign-up. Create your account there.

After sign-up, Grant Guardian sends you into onboarding.

### 2. Connect Notion

On onboarding Step 1:

- Click `Connect Notion`
- Complete the Notion OAuth flow
- Grant Guardian will automatically bootstrap the required Notion workspace structure

When this is complete, Step 1 is done.

Important:

- Your data starts syncing into Notion from the moment each onboarding step is completed
- You do not need to manually build the Notion database structure yourself

### 3. Create or Open a Workspace

On onboarding Step 2:

- If you already created a workspace on this machine, choose it
- Otherwise click into the new workspace form and enter:
  - organization name
  - EIN
  - mission

The mission matters. It is one of the main inputs used in fit scoring.

Good example:

```text
Bright Path Youth Collective equips low-income middle-school students in South Chicago with literacy coaching, mentoring, and family wraparound support.
```

When you save this step:

- the organization record is stored locally
- it is also synced to Notion

### 4. Add Your First Opportunity

On onboarding Step 3:

Paste one of these:

- the funder’s opportunity page URL
- a direct RFP link
- copied application instructions text

Grant Guardian will try to extract:

- title
- funder
- deadline
- submission method
- portal URL
- requirements/questions

When this step succeeds:

- the opportunity is created locally
- the linked funder record is created or reused
- requirements are created
- all of that is synced to Notion

### 5. Run Your First Analysis

On onboarding Step 4:

Click `Analyze this opportunity`.

This runs the first real pass:

1. opportunity parsing confirmation
2. funder research
3. fit scoring
4. evidence coverage mapping

When the run completes, you should get:

- fit score
- pursue recommendation
- evidence coverage percentage

Then click `Go to your workspace` to enter the main product.

## What the First Analysis Actually Uses

Grant Guardian does not ask you a long interview during analysis. It scores from the data already saved in your workspace.

Today, the fit score is built from:

- your organization mission
- your service area
- your programs
- your evidence library
- your budgets and documents
- the funder’s 990-based grant behavior
- the opportunity deadline
- the opportunity requirements

### If You Are Brand New With No Data

If you only completed signup and the basic onboarding fields, Grant Guardian can still compute a score, but it is a weaker early estimate.

That first score is strongest for:

- mission alignment
- geography match
- deadline feasibility
- funder behavior

It is weakest when you do not yet have:

- programs
- evidence items
- annual budget
- ready documents

So a brand-new user should treat the first score as:

- an early triage signal
- not the final truth

The score becomes much more useful after you add more workspace data.

## What To Do Right After Onboarding

Once you land in the dashboard, use this order.

### 1. Fill Out Your Real Workspace Context

Make sure your workspace includes:

- mission
- service area
- annual budget
- one or more programs
- at least a few evidence items
- core documents like 501(c)(3) and budget support

This is what makes later fit scores, draft answers, and evidence coverage more specific to your nonprofit.

### 2. Open the Opportunity Library

Go to:

```text
/opportunities
```

This is the main list of grant opportunities for your workspace.

Open one opportunity to work it end to end.

### 3. Use the Opportunity Workbench

Inside an opportunity route, review:

- funder intelligence
- fit score
- evidence coverage
- portal readiness
- drafts
- review state
- submission readiness

This is the core place where you decide whether the opportunity is worth pursuing.

### 4. Review the Funder Intelligence

The funder card should tell you:

- EIN
- average and median visible grant size
- geography focus
- issue area concentration
- repeat grantee signal
- small-org friendliness
- stated vs actual behavior from filings

Use this to reality-check what the funder actually funds.

### 5. Review the Evidence Coverage

The evidence panel shows:

- green questions you can already answer
- amber questions that need strengthening
- red questions with no evidence

Red and amber gaps can create tasks automatically.

This is one of the most important screens in the product because it tells you whether you are truly ready to apply.

### 6. Generate Drafts

Once the opportunity looks promising:

- generate drafts
- inspect each draft answer
- review evidence references
- review any unsupported warnings

Then move into review.

### 7. Use Review Before Submission

Open the review route for the opportunity and use it to:

- request review
- identify blockers
- move drafts toward approval

Do not treat generated drafts as final until they are reviewed.

### 8. Use Submission Support

When the opportunity is ready:

- confirm the portal URL
- assemble the submission packet
- open the submission session UI
- inspect staging, field plans, and browser handoff status

Grant Guardian helps with Submittable, but it is designed to pause before risky or narrative-heavy sections and it does not blindly auto-submit.

### 9. Use Reporting If You Win

If the grant is awarded:

- activate reporting
- review due dates
- review reporting tasks
- use generated reporting templates

### 10. Use Lessons If You Lose

If the application is rejected:

- log the rejection feedback
- review extracted themes
- preserve next-cycle recommendations

That rejection memory is meant to improve future applications to the same funder.

## Where Data Syncs Into Notion

Your data syncs into Notion throughout the workflow, not just at the end.

Examples:

- Step 2 onboarding: organization
- Step 3 onboarding: opportunity, funder, requirements
- Step 4 onboarding: funder intelligence, fit score, evidence coverage, agent logs
- drafting: draft answers
- review: reviews and tasks
- submission: submissions and related records
- reporting: reporting calendar and tasks
- lessons: lessons and rejection memory

## How To Switch Notion Workspaces

If you want to disconnect the current Notion account and connect another one:

Use any of these entry points:

- the `Switch Notion` button in the top nav
- the `Switch Notion` button inside the app shell
- the `Switch Notion workspace` link on the dashboard
- go directly to:

```text
/onboarding?step=1
```

From there:

1. click `Disconnect` if needed
2. click `Switch workspace` or `Connect Notion`
3. complete OAuth with the other Notion account

Future syncs will go to the newly connected Notion workspace.

## Best Practices For New Teams

- Do not rely on the first score alone if your workspace is empty
- Add programs, evidence, and budgets early
- Use the evidence coverage panel before spending time polishing drafts
- Confirm portal URLs before trying submission automation
- Treat Notion as the live operating record
- Use lessons after every decision, not only after large grants

## Common New-User Questions

### Why did I get a score even though I barely entered anything?

Because Grant Guardian can compute a preliminary score from:

- your mission
- geography
- deadline
- funder behavior
- whatever workspace data already exists

That score becomes stronger as you add more real organizational context.

### Why is a score low even when the funder sounds relevant?

Common reasons:

- poor evidence coverage
- missing program records
- missing budgets
- weak geography match
- close deadline
- funder grant sizes that do not match your likely ask

### What should I do after my first analysis?

Usually:

1. improve missing evidence
2. add or clean up programs and budgets
3. rerun analysis
4. generate drafts
5. move into review

## Short Version

If you want the shortest possible first-time workflow:

1. Sign up
2. Connect Notion
3. Create your workspace
4. Paste one real opportunity
5. Run analysis
6. Review fit score and evidence coverage
7. Add missing org data if the score is still too generic
8. Generate drafts
9. Move into review and submission

