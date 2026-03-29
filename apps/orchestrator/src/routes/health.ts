import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

export const registerHealthRoutes = (app: FastifyInstance) => {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "grant-guardian-orchestrator",
      environment: env.NODE_ENV,
      providers: {
        geminiConfigured: Boolean(env.GEMINI_API_KEY),
        notionMcpConfigured: Boolean(env.NOTION_MCP_SERVER_URL),
        notionOauthReady:
          Boolean(env.NOTION_OAUTH_CLIENT_ID) &&
          Boolean(env.NOTION_OAUTH_CLIENT_SECRET),
        propublicaConfigured: Boolean(env.PROPUBLICA_NONPROFIT_BASE_URL),
      },
    };
  });
};
