import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import formbody from "@fastify/formbody";
import { handleIyzicoCallback, handleIyzicoWebhook, handlePaytrNotification } from "@altyapi/checkout";
import type { CallbackInput } from "@altyapi/payments";
import type { AppDeps } from "../deps";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const UUID = /^[0-9a-f-]{36}$/;

function toInput(req: FastifyRequest): CallbackInput {
  return {
    headers: req.headers,
    body: (req.body ?? {}) as Record<string, unknown>,
    rawBody: req.rawBody ?? "",
  };
}

/**
 * Public provider endpoints. They are unauthenticated by design; every notification is
 * verified with the store's own provider credentials before it can change any state.
 */
export const paymentCallbackRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  // Keep the exact bytes for payload hashing / deduplication.
  app.addHook("preParsing", async (req, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const c of payload) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    req.rawBody = raw.toString("utf8");
    return Readable.from(raw);
  });
  await app.register(formbody);

  app.post<{ Params: { connectionId: string } }>("/payments/v1/paytr/notify/:connectionId", { config: { rateLimit: false } }, async (req, reply) => {
    if (!UUID.test(req.params.connectionId)) return reply.status(404).type("text/plain").send("NOT_FOUND");
    const result = await handlePaytrNotification(deps.payments, req.params.connectionId, toInput(req), deps.logger);
    return reply.status(result.ack.status).type(result.ack.contentType).send(result.ack.body);
  });

  app.post<{ Params: { attemptId: string } }>("/payments/v1/iyzico/callback/:attemptId", { config: { rateLimit: false } }, async (req, reply) => {
    if (!UUID.test(req.params.attemptId)) return reply.status(404).send();
    const result = await handleIyzicoCallback(deps.payments, req.params.attemptId, toInput(req), deps.logger);
    // The browser is sent to the status page, which reads the order state (never trusts this redirect).
    if (result.redirectTo) return reply.redirect(result.redirectTo, 303);
    return reply.status(result.ack.status).type(result.ack.contentType).send(result.ack.body);
  });

  app.post<{ Params: { connectionId: string } }>("/payments/v1/iyzico/webhook/:connectionId", { config: { rateLimit: false } }, async (req, reply) => {
    if (!UUID.test(req.params.connectionId)) return reply.status(404).send();
    const result = await handleIyzicoWebhook(deps.payments, req.params.connectionId, toInput(req), deps.logger);
    return reply.status(result.ack.status).type(result.ack.contentType).send(result.ack.body);
  });
};
