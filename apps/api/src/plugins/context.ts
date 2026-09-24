import fp from "fastify-plugin";
import { enterContext, newCorrelationId, type OperationContext } from "@altyapi/observability";

declare module "fastify" {
  interface FastifyRequest {
    opContext: OperationContext;
  }
}

const CORRELATION_HEADER = "x-correlation-id";
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Establishes correlation/request ids for every request and exposes them to logs and audit. */
export const contextPlugin = fp(async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const incoming = req.headers[CORRELATION_HEADER];
    const correlationId = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : newCorrelationId();
    const ctx: OperationContext = { correlationId, requestId: req.id };
    req.opContext = ctx;
    enterContext(ctx);
    reply.header(CORRELATION_HEADER, correlationId);
  });
});
