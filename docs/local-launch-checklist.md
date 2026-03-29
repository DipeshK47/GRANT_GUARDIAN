# Local Launch Checklist

Use this before treating the local product like a real working nonprofit workspace.

## Start the app

1. Fill `.env` with:
   - Clerk keys
   - Notion OAuth keys
   - `GEMINI_API_KEY`
2. Install dependencies with `npm install`
3. Start both apps with `npm run dev`
4. Open `http://localhost:3000`

## First-time team setup

1. Sign up or sign in
2. Connect one Notion page in onboarding step 1
3. Create or choose the nonprofit workspace in step 2
4. Add one real opportunity in step 3
5. Run the first analysis in step 4

## Before trusting the fit score

Treat the first score as preliminary until this workspace has:

- at least 1 program
- at least 2 evidence items
- at least 1 structured budget
- at least 2 ready documents

Without that context, the app can still score an opportunity, but the result is less specific to the nonprofit.

## Minimum records to add from the website

Inside the dashboard:

1. In `Program Context`, add:
   - one program
   - two evidence items
   - one structured budget
2. In `Document Vault`, upload:
   - 501(c)(3) letter
   - organizational or program budget
   - board roster

## Expected working flow

From the website only:

1. Intake an opportunity
2. Research and parse filings
3. Analyze opportunity
4. Generate drafts
5. Build review queue
6. Assemble submission
7. Launch browser handoff when ready
8. Activate reporting only after award
9. Log rejection feedback after losses

## Common local issues

### Port already in use

If `3000` or `4000` is already taken:

```bash
kill $(lsof -ti tcp:3000)
kill $(lsof -ti tcp:4000)
```

### Notion asks for a page to share

That is expected. Share one page, such as `Grant Guardian Workspace`, and the app will build the rest underneath it automatically.

### Evidence Library or Documents look empty

That usually means the current workspace has not had those records added yet. Grant Guardian does not copy records from an older demo workspace into a new nonprofit workspace.

### Funder filing rows show `Queued` or `Failed`

- `Queued` means filing metadata exists but recipient-level grant rows are not parsed yet
- `Failed` means the parser attempted extraction and did not get usable grant rows

Retry funder research from the website before treating those rows as final.
