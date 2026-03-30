import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export default defineConfig({
  schema: "./apps/orchestrator/src/db/schema.ts",
  out: "./apps/orchestrator/drizzle-postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
