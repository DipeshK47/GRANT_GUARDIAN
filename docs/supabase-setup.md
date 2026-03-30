# Supabase Setup

Grant Guardian now supports a durable deployed setup with:

- `Supabase Postgres` for application data
- `Supabase Storage` for uploaded documents

Clerk, Notion OAuth, Gemini, ProPublica, and the existing Next.js/Fastify structure stay the same.

## 1. Create a Supabase project

Create a new Supabase project and keep these values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

Use the Postgres connection string from Supabase for `DATABASE_URL`.

## 2. Create a storage bucket

Create a bucket named:

- `documents`

You can rename it if you want, but then update `SUPABASE_STORAGE_BUCKET`.

## 3. Update `.env`

Set these values:

```env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=documents

FILE_STORAGE_BACKEND=supabase
FILE_STORAGE_KEY_PREFIX=grant-guardian
```

Keep your existing:

- Clerk keys
- Notion OAuth settings
- Gemini key
- ProPublica settings

## 4. Run migrations

Run:

```bash
npm run db:migrate
```

This applies the Postgres migration set in:

- `apps/orchestrator/drizzle-postgres`

## 5. Start the app

For local development:

```bash
npm run dev
```

For hosted backend:

- set the same env vars on Render or your Node host
- make sure `DATABASE_URL` points to Supabase Postgres
- keep `FILE_STORAGE_BACKEND=supabase`

## 6. What changed in the codebase

- Drizzle schema and runtime DB client now target Postgres
- startup migrations now use the Postgres migration folder
- document storage now supports `FILE_STORAGE_BACKEND=supabase`
- existing S3 storage support is still available if needed

## 7. Important note

The old SQLite `file:` database URL is no longer the runtime target for the orchestrator. If `DATABASE_URL` still points at a local SQLite file, the orchestrator will now fail fast with a clear message telling you to switch to Postgres.
