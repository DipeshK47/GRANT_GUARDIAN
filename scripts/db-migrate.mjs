import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databaseUrl = (process.env.DATABASE_URL ?? "file:./data/grant-guardian.db").replace(
  /^file:/,
  "",
);

const sqlite = new Database(databaseUrl, {
  timeout: 5_000,
});

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), {
  migrationsFolder: "./apps/orchestrator/drizzle",
});

console.log(`Applied migrations to ${databaseUrl}`);
