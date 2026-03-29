import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { asc, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";
import { getClerkUserIdFromRequest } from "../lib/request-auth.js";
import { withRequestContext } from "../lib/request-context.js";
import type { BootstrapWorkspaceInput } from "../services/notion/client.js";
import {
  isNotionAuthorizationError,
  NotionMcpClient,
} from "../services/notion/client.js";
import type { NotionWorkspaceSyncService } from "../services/notion/workspace-sync.js";

const toErrorPayload = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: "Unknown error",
  };
};

const toHtml = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f2ea;
        color: #171717;
        padding: 40px 20px;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        background: #fffdf8;
        border: 1px solid #d9d1c6;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(46, 31, 18, 0.08);
      }
      a {
        color: #0f766e;
      }
      code {
        background: #f4efe7;
        padding: 2px 6px;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <main>
      ${body}
    </main>
  </body>
</html>`;

const statusCodeForError = (error: unknown) =>
  isNotionAuthorizationError(error) ? 401 : 500;

export const registerNotionRoutes = (
  app: FastifyInstance,
  notionClient: NotionMcpClient,
  notionWorkspaceSyncService?: NotionWorkspaceSyncService,
) => {
  const startOAuth = async (
    request: FastifyRequest<{ Querystring: { format?: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      const session = await notionClient.beginOAuthSession();
      if ((request.query as { format?: string } | undefined)?.format === "json") {
        return session;
      }

      return reply.redirect(session.authorizationUrl);
    } catch (error) {
      request.log.error({ error }, "Failed to start Notion OAuth flow");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  };

  app.get("/auth/notion", startOAuth);
  app.get("/auth/notion/start", startOAuth);

  app.get("/auth/notion/callback", async (request, reply) => {
    const query = request.query as {
      code?: string;
      error?: string;
      state?: string;
    };

    try {
      const result = await notionClient.handleOAuthCallback(query);
      const organization = await withRequestContext({ clerkUserId: result.clerkUserId }, async () => {
        await notionClient.bootstrapWorkspace();
        const [storedOrganization] = await db
          .select({ id: organizations.id, onboardingCompleted: organizations.onboardingCompleted })
          .from(organizations)
          .where(eq(organizations.clerkUserId, result.clerkUserId))
          .orderBy(asc(organizations.createdAt))
          .limit(1);

        return storedOrganization ?? null;
      });

      const redirectUrl =
        organization?.onboardingCompleted && organization.id
          ? `${env.WEB_BASE_URL}/dashboard?organizationId=${encodeURIComponent(organization.id)}`
          : `${env.WEB_BASE_URL}/onboarding?step=2`;

      return reply.redirect(redirectUrl);
    } catch (error) {
      request.log.error({ error }, "Failed to complete Notion OAuth flow");
      return reply
        .status(isNotionAuthorizationError(error) ? 401 : 400)
        .type("text/html")
        .send(
          toHtml(
            "Notion Connection Failed",
            `<h1>Notion connection failed</h1>
             <p>${toErrorPayload(error).message}</p>
             <p>Start again at <a href="/auth/notion/start"><code>/auth/notion/start</code></a>.</p>`,
          ),
        );
    }
  });

  app.delete("/auth/notion", async (request, reply) => {
    try {
      return await notionClient.disconnectCurrentConnection();
    } catch (error) {
      request.log.error({ error }, "Failed to disconnect Notion workspace");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.get("/auth/notion/status", async (request, reply) => {
    try {
      return await notionClient.getAuthStatus();
    } catch (error) {
      request.log.error({ error }, "Failed to load Notion auth status");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.get("/notion/sync-status", async (request, reply) => {
    try {
      if (!notionWorkspaceSyncService) {
        throw new Error("Notion workspace sync service is not configured.");
      }

      return await notionWorkspaceSyncService.getStatus();
    } catch (error) {
      request.log.error({ error }, "Failed to load Notion sync status");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.get("/notion/bootstrap/plan", async (request, reply) => {
    try {
      return await notionClient.planWorkspaceBootstrap();
    } catch (error) {
      request.log.error({ error }, "Failed to build Notion bootstrap plan");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.get("/notion/bootstrap", async (request, reply) => {
    try {
      return {
        status: "ok",
        summary: await notionClient.getBootstrapSummary(),
      };
    } catch (error) {
      request.log.error({ error }, "Failed to load Notion bootstrap status");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.post("/notion/bootstrap", async (request, reply) => {
    try {
      const body = (request.body as BootstrapWorkspaceInput | undefined) ?? {};
      return await notionClient.bootstrapWorkspace(body);
    } catch (error) {
      request.log.error({ error }, "Failed to bootstrap Notion workspace");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });

  app.post("/notion/sync", async (request, reply) => {
    try {
      if (!notionWorkspaceSyncService) {
        throw new Error("Notion workspace sync service is not configured.");
      }

      const body = (request.body as { organizationId?: string } | undefined) ?? {};
      return await notionWorkspaceSyncService.syncWorkspace({
        organizationId: body.organizationId ?? "",
        clerkUserId: getClerkUserIdFromRequest(request),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to run manual Notion workspace sync");
      return reply.status(statusCodeForError(error)).send(toErrorPayload(error));
    }
  });
};
