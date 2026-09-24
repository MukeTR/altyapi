import { sql } from "@altyapi/database";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../deps";

export const healthRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get("/healthz", { schema: { hide: true } }, async () => ({ status: "ok" }));

  app.get(
    "/readyz",
    {
      schema: {
        hide: true,
        response: { 200: z.object({ status: z.literal("ready") }), 503: z.object({ status: z.literal("unavailable"), failing: z.array(z.string()) }) },
      },
    },
    async (_req, reply) => {
      const failing: string[] = [];
      await deps.db.execute(sql`select 1`).catch(() => failing.push("postgres"));
      await deps.redis.ping().catch(() => failing.push("redis"));
      if (failing.length) return reply.status(503).send({ status: "unavailable" as const, failing });
      return { status: "ready" as const };
    },
  );
};
