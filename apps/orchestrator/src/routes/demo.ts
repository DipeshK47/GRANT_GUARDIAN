import type { FastifyInstance } from "fastify";
import { DemoSeedService } from "../services/demo/seed.js";

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

export const registerDemoRoutes = (
  app: FastifyInstance,
  demoSeedService: DemoSeedService,
) => {
  app.post("/demo/seed", async (request, reply) => {
    try {
      const body =
        (request.body as { force?: boolean; syncToNotion?: boolean } | undefined) ?? {};
      return await demoSeedService.seed(body);
    } catch (error) {
      request.log.error({ error }, "Failed to seed demo data");
      return reply.status(500).send(toErrorPayload(error));
    }
  });
};
