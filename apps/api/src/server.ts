import { buildApp } from "./app";
import { createDeps } from "./deps";

const deps = createDeps();
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await deps.close();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: deps.env.API_HOST, port: deps.env.API_PORT });
