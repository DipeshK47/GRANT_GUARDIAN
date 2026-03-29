import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./apps/orchestrator/src/db/schema.ts",
  out: "./apps/orchestrator/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/grant-guardian.db",
  },
});

