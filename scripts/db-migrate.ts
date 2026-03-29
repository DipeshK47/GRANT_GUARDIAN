import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databaseUrl = (process.env.DATABASE_URL ?? "file:./data/grant-guardian.db").replace(
  /^file:/,
  "",
);

const sqlite = new Database(databaseUrl);

migrate(drizzle(sqlite), {
  migrationsFolder: "./apps/orchestrator/drizzle",
});

console.log(`Applied migrations to ${databaseUrl}`);
