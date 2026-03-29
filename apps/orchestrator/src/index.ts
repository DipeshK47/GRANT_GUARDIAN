import { buildServer } from "./server.js";
import { env } from "./config/env.js";

const start = async () => {
  const server = buildServer();

  try {
    await server.listen({
      host: "0.0.0.0",
      port: env.APP_PORT,
    });
    server.log.info(
      `Grant Guardian orchestrator listening on http://localhost:${env.APP_PORT}`,
    );
  } catch (error) {
    server.log.error({ error }, "Failed to start orchestrator");
    process.exit(1);
  }
};

void start();

