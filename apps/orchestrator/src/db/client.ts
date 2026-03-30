import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const resolveSqlitePath = () => {
  const databaseUrl = env.DATABASE_URL.replace(/^file:/, "");
  return databaseUrl.startsWith(".")
    ? new URL(`../../../../${databaseUrl}`, import.meta.url).pathname
    : databaseUrl;
};

export const sqlitePath = resolveSqlitePath();

export const sqlite = new Database(sqlitePath, {
  timeout: 5_000,
});

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

// Apply bundled migrations automatically so fresh local/hosted SQLite databases
// are usable without a separate manual migration step.
migrate(drizzle(sqlite), {
  migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
});

export const db = drizzle(sqlite, {
  schema,
});
