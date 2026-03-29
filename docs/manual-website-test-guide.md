# Manual Website Test Guide

Use this guide to test Grant Guardian from the website as if you were a brand-new nonprofit user.

## Start the app

1. From the repo root, run `npm install` if needed.
2. Start the full local app with `npm run dev`.
3. Open `http://localhost:3000`.

## Test kit files

Use these sample files in the website upload flow:

- `data/demo/manual-test-kit/501c3-determination-letter.txt`
- `data/demo/manual-test-kit/fy26-organizational-budget.csv`
- `data/demo/manual-test-kit/board-roster.csv`
- `data/demo/manual-test-kit/2024-annual-program-outcomes-report.md`

## Step 1: Sign up and connect Notion

1. Open the homepage.
2. Click `Get started free`.
3. Create an account or sign in.
4. In onboarding step 1, click `Connect Notion`.
5. In Notion, share one page such as `Grant Guardian Workspace`.
6. Return to the app and confirm step 1 completes.

Expected result:

- Grant Guardian bootstraps the Notion workspace automatically.
- You should see the workspace databases under the shared page.

## Step 2: Create the organization workspace

In onboarding step 2, enter:

- Organization name: `Bridgelight Youth Foundation`
- EIN: `47-2381956`
- Mission:

`Bridgelight Youth Foundation provides after-school academic coaching, mentorship, and family navigation services to low-income students in grades 6 through 12 across underserved communities in the Chicago metropolitan area. We partner with public schools, community health centers, and local employers to ensure every young person we serve has a clear path from middle school through post-secondary success. Since 2014, we have served over 2,400 students and maintained an 84% high school graduation rate among program participants, compared to a 61% district average.`

Click `Save organization`.

Expected result:

- The organization appears in the app.
- The organization syncs into Notion.

## Step 3: Add the first opportunity

In onboarding step 3, paste this raw opportunity text:

`A Better Chicago 2026 General Operating Grant. Funder: A Better Chicago. Deadline: June 30, 2026. Submission method: email or direct application. Source URL: https://abetterchicago.org/grantee-application. Funding focus: youth education, academic persistence, post-secondary success, workforce pathways, and economic mobility in Chicago. Eligible applicants are Chicago-based nonprofits serving young people from disinvested communities. Applicants should describe mission, population served, measurable outcomes, and use of general operating support. Typical requests are in the $75000 to $125000 range.`

Click the button to add the opportunity.

Expected result:

- One opportunity is created.
- The opportunity, funder, and requirements sync to Notion.

## Step 4: Run the first analysis

In onboarding step 4, click `Analyze this opportunity`.

Expected result:

- The app runs parsing, funder research, fit scoring, and evidence mapping.
- After completion, go to the workspace.

## Step 5: Add the minimum real workspace context

In the workspace, scroll to `Program Context`.

### Add one program

Enter:

- Program name: `Academic Acceleration Program`
- Target population: `Low-income students in grades 6-12 across Chicago`
- Geography: `Chicago, Cook County, Illinois`
- Outcomes / proof points: `84% high-school graduation rate among participants, 2,400 students served since 2014, and 91% of seniors accepted to a post-secondary program.`
- Program budget: `180000`
- Program lead: `James Okafor`

Click `Save program`.

### Add evidence item 1

Enter:

- Program: `Academic Acceleration Program`
- Evidence title: `2024 graduation and persistence outcomes`
- Evidence type: `Outcome`
- Quality score: `90`
- Summary: `In 2024, 312 students participated in Bridgelight programs. 84% of program participants graduated from high school compared with a 61% district average, and 91% of graduating seniors were accepted into a post-secondary program.`
- Source document: `2024 Annual Program Outcomes Report`
- Collected at: `2024-12-15`
- Tags: `graduation, post-secondary, outcomes, chicago`

Click `Save evidence`.

### Add evidence item 2

Enter:

- Program: `Academic Acceleration Program`
- Evidence title: `Family navigation satisfaction results`
- Evidence type: `Metric`
- Quality score: `82`
- Summary: `In FY2024, 280 families received navigation support. 88% reported improved confidence in supporting school attendance, academic planning, and post-secondary decisions.`
- Source document: `2024 Annual Program Outcomes Report`
- Collected at: `2024-12-15`
- Tags: `families, navigation, satisfaction`

Click `Save evidence`.

### Add one structured budget

Enter:

- Program: `Academic Acceleration Program`
- Budget name: `FY26 Academic Acceleration Budget`
- Fiscal year: `2026`
- Budget type: `Program`
- Total revenue: `180000`
- Total expense: `180000`
- Notes / line items: `Staff salaries 110000; program materials 22000; transportation 18000; family engagement 12000; evaluation 10000; occupancy and admin 8000.`

Click `Save budget`.

Expected result:

- One program, two evidence items, and one structured budget appear in the app and in Notion.

## Step 6: Upload core documents

In `Document Vault`, upload the following files from the repo:

1. `data/demo/manual-test-kit/501c3-determination-letter.txt`
   - Document name: `IRS 501(c)(3) Determination Letter`
   - Category: `501(c)(3)`
   - Owner: `Maya Patel`
2. `data/demo/manual-test-kit/fy26-organizational-budget.csv`
   - Document name: `FY26 Organizational Budget`
   - Category: `Budget`
   - Owner: `Maya Patel`
3. `data/demo/manual-test-kit/board-roster.csv`
   - Document name: `Board of Directors Roster`
   - Category: `Board List`
   - Owner: `Maya Patel`

Expected result:

- All three documents appear in the app and in the Notion `Documents` database.

## Step 7: Re-run analysis and drafting

Open the opportunity route and click these buttons in order:

1. `Research and parse filings`
2. `Analyze opportunity`
3. `Generate drafts`
4. `Build review queue`

Expected result:

- Fit score appears.
- Evidence coverage improves.
- Draft answers are grounded in the evidence items you added.
- Reviews appear in the app and in Notion.

## Step 8: Test a mismatch opportunity

Add a second opportunity with this raw text:

`T-Mobile Hometown Grant Program 2026. Funder: T-Mobile Hometown Grant Program. Deadline: March 31, 2026. Submission platform: Submittable. Source URL: https://www.t-mobile.com/community/hometown-grants. Funding focus: physical infrastructure projects in small towns with fewer than 50000 residents. Applicants must be based in eligible small towns and propose shovel-ready community space or physical infrastructure improvements. Programming-only requests are not eligible.`

Then click:

1. `Analyze opportunity`

Expected result:

- Fit score should be weak or skip-oriented.
- Geography and eligibility mismatch should be visible.

## Step 9: Test rejection memory

On the T-Mobile opportunity:

1. Mark the opportunity as rejected.
2. Enter this feedback:

`Application was declined because the organization is located in Chicago, a city well above the 50000 population threshold required for the Hometown Grants program. The grant also requires a physical infrastructure project, while Bridgelight primarily provides program services and family support.`

3. Save the rejection feedback.

Expected result:

- Lessons appear in the app.
- A rejection lesson syncs to Notion.
- Similar future opportunities for that funder should show a warning banner.

## Step 10: Test reporting

On the A Better Chicago opportunity:

1. Use the workflow that marks the opportunity awarded by clicking `Activate reporting`.

Expected result:

- A reporting timeline appears.
- Reporting records and tasks sync to Notion.
- The opportunity gets a reporting workspace link.

## Step 11: Test manual Notion sync

On the dashboard:

1. Find the Notion sync card.
2. Click `Sync now`.

Expected result:

- `Last synced to Notion` updates.
- Recent app changes appear in Notion.

## What a successful manual pass looks like

At the end of this flow:

- Organization is in Notion.
- Program, evidence, budget, and documents are in Notion.
- Opportunity and requirements are in Notion.
- Fit score, pursue decision, and evidence coverage are visible.
- Draft answers and reviews exist.
- Rejection memory works on the mismatch opportunity.
- Reporting works on the awarded opportunity.
- `Sync now` updates the sync timestamp.