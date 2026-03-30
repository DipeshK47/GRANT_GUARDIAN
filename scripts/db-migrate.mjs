import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const resolveSslConfig = (value) => {
  try {
    const parsed = new URL(value);
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

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: resolveSslConfig(databaseUrl),
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: "./apps/orchestrator/drizzle-postgres",
  });
  console.log(`Applied Postgres migrations to ${databaseUrl}`);
} finally {
  await pool.end();
}
