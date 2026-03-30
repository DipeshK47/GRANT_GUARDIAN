import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

if (env.DATABASE_URL.startsWith("file:")) {
  throw new Error(
    "Grant Guardian now expects a Postgres DATABASE_URL. Point DATABASE_URL at Supabase Postgres before starting the orchestrator.",
  );
}

const resolveSslConfig = (databaseUrl: string) => {
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase();
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

    if (isLocalHost || sslMode === "disable") {
      return undefined;
    }

    return {
      rejectUnauthorized: false,
    };
  } catch {
    return undefined;
  }
};

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: resolveSslConfig(env.DATABASE_URL),
  max: 10,
});

export const db = drizzle(pool, {
  schema,
});

// Apply bundled Postgres migrations automatically so Supabase/hosted databases
// stay aligned without a separate manual migration step.
await migrate(db, {
  migrationsFolder: new URL("../../drizzle-postgres", import.meta.url).pathname,
});
