import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const envFilePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.env",
);

loadEnv({ path: envFilePath });

const booleanFromString = z
  .string()
  .transform((value) => value.toLowerCase() === "true");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_PORT: z.coerce.number().default(4000),
  WEB_PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")).default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().default("documents"),
  ENCRYPTION_KEY: z.string().min(32),
  SESSION_SECRET: z.string().min(16),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
  GEMINI_EMBEDDING_MODEL: z.string().default("text-embedding-004"),
  NOTION_MCP_SERVER_URL: z
    .string()
    .url()
    .default("https://mcp.notion.com/mcp"),
  NOTION_OAUTH_CLIENT_ID: z.string().default(""),
  NOTION_OAUTH_CLIENT_SECRET: z.string().default(""),
  NOTION_OAUTH_REDIRECT_URI: z.string().url().default("http://localhost:4000/auth/notion/callback"),
  PROPUBLICA_NONPROFIT_BASE_URL: z
    .string()
    .url()
    .default("https://projects.propublica.org/nonprofits/api"),
  USER_AGENT: z.string().default("GrantGuardian/0.1"),
  PLAYWRIGHT_HEADLESS: booleanFromString.default("false"),
  PLAYWRIGHT_STORAGE_STATE: z
    .string()
    .default("./data/browser/storage-state.json"),
  PLAYWRIGHT_STORAGE_STATE_DIR: z.string().default("./data/browser"),
  SUBMITTABLE_EMAIL: z.string().default(""),
  SUBMITTABLE_PASSWORD: z.string().default(""),
  SUBMITTABLE_BASE_URL: z.string().url().default("https://www.submittable.com"),
  SNAPSHOT_DIR: z.string().default("./data/snapshots"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  DOCUMENT_UPLOAD_MAX_BYTES: z.coerce.number().default(25 * 1024 * 1024),
  FILE_STORAGE_BACKEND: z.enum(["local", "s3", "supabase"]).default("local"),
  FILE_STORAGE_KEY_PREFIX: z.string().default("grant-guardian"),
  FILE_STORAGE_PUBLIC_BASE_URL: z.string().default(""),
  FILE_STORAGE_BUCKET: z.string().default(""),
  FILE_STORAGE_REGION: z.string().default("us-east-1"),
  FILE_STORAGE_ENDPOINT: z.string().default(""),
  FILE_STORAGE_ACCESS_KEY_ID: z.string().default(""),
  FILE_STORAGE_SECRET_ACCESS_KEY: z.string().default(""),
  FILE_STORAGE_FORCE_PATH_STYLE: booleanFromString.default("true"),
  DEMO_DATA_DIR: z.string().default("./data/demo"),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
