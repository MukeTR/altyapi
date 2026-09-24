import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@altyapi/commerce-core";
import {
  EkosistemError,
  MAX_REQUEST_BODY_BYTES,
  claimLinkCode,
  claimRequestSchema,
  confirmRequestSchema,
  exportBrand,
  exportCatalogProduct,
  exportCatalogProducts,
  exportContent,
  exportOrder,
  exportOrders,
  handlePeerConfirm,
  handlePeerPatch,
  handlePeerRevoke,
  handlePeerRotate,
  patchLinkRequestSchema,
  peerLinkStatus,
  pushEventSchema,
  receivePushEvent,
  type EkosistemErrorCode,
} from "@altyapi/ekosistem";
import { enrichContext } from "@altyapi/observability";
import type { AppDeps } from "../deps";
import { createVerifier, hasScope, parseJsonBody, requireScope, sendEkosistemError } from "../plugins/ekosistem-signed";

/**
 * Machine-to-machine endpoints of the ecosystem bridge under /ekosistem/v1
 * (docs/ekosistem/v1.md §4, §7, §10), used by Kârmatik and Yanıt.
 *
 * Encapsulated: this plugin keeps the raw body bytes (its own content-type parser, 64 KB)
 * for signature verification without changing body parsing anywhere else, renders every
 * error in the §6.4 envelope, answers 405 for HEAD and other methods (no automatic HEAD
 * routes), and is exempt from the global IP rate limiter (signed requests are limited per
 * link instead).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validationError(err: ZodError): EkosistemError {
  const first = err.issues.slice(0, 3).map((i) => `${i.path.join(".") || "gövde"}: ${i.message}`);
  return new EkosistemError("validation_failed", `İstek içeriği doğrulanamadı (${first.join("; ")}).`);
}

function parseWith<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

/** Maps anything thrown inside the plugin to the §6.4 envelope. */
function toEnvelope(err: unknown): { code: EkosistemErrorCode; message?: string; retryAfter?: number; unexpected: boolean } {
  if (err instanceof EkosistemError) return { code: err.code, message: err.message, ...(err.retryAfterSeconds !== undefined ? { retryAfter: err.retryAfterSeconds } : {}), unexpected: false };
  if (err instanceof ZodError) return { code: "validation_failed", message: validationError(err).message, unexpected: false };
  if (err instanceof AppError) {
    const map: Partial<Record<string, EkosistemErrorCode>> = { not_found: "not_found", validation_failed: "validation_failed", unprocessable: "validation_failed", rate_limited: "rate_limited", bad_request: "bad_request" };
    return { code: map[err.code] ?? "unavailable", unexpected: !map[err.code] };
  }
  const e = err as { code?: string; statusCode?: number };
  if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE" || e.statusCode === 413) return { code: "payload_too_large", unexpected: false };
  if (e.statusCode === 415 || e.statusCode === 400) return { code: "bad_request", unexpected: false };
  return { code: "unavailable", unexpected: true };
}

export const ekosistemPublicRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const sdeps = deps.ekosistem;
  const { verify, limitClaim } = createVerifier(deps);

  // Raw bytes for every content type; JSON is parsed only after the signature is verified.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_REQUEST_BODY_BYTES }, (_req, body, done) => done(null, body));

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.header("cache-control", "no-store");
    enrichContext({ principalType: "api_client" });
  });

  app.setErrorHandler((err, req, reply) => {
    const mapped = toEnvelope(err);
    if (mapped.unexpected) req.log.error({ err }, "ekosistem endpoint failed");
    return sendEkosistemError(req, reply, mapped.code, mapped.code === "unavailable" && mapped.unexpected ? undefined : mapped.message, mapped.retryAfter);
  });

  /** Common route options: no automatic HEAD route, no global IP limiter, no CORS (not for browsers). */
  const route = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    app.route({ method, url, handler, exposeHeadRoute: false, config: { rateLimit: false, cors: false }, schema: { tags: ["ekosistem-v1"], hide: url.includes("*") || url === "/ekosistem/v1" } } as RouteOptions);

  const linkParam = (req: FastifyRequest, linkId: string): void => {
    const param = (req.params as { linkId?: string }).linkId ?? "";
    // The path names the same link the request is signed for.
    if (!UUID_RE.test(param) || param.toLowerCase() !== linkId) throw new EkosistemError("not_found");
  };

  // ---------------------------------------------------------------------------
  // Links (§4.3, §4.4)
  // ---------------------------------------------------------------------------

  route("POST", "/ekosistem/v1/links/claim", async (req, reply) => {
    await limitClaim(req);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (req.headers["content-encoding"]) throw new EkosistemError("bad_request", "Content-Encoding kabul edilmez.");
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "application/json") throw new EkosistemError("bad_request", "Content-Type application/json olmalıdır.");
    const body = parseWith(claimRequestSchema, parseJsonBody(raw));
    const result = await claimLinkCode(sdeps, body);
    return reply.status(201).send(result);
  });

  route("GET", "/ekosistem/v1/links/:linkId", async (req) => {
    const v = await verify(req, { kind: "link" });
    linkParam(req, v.link.id);
    return peerLinkStatus(sdeps, v.link);
  });

  route("POST", "/ekosistem/v1/links/:linkId/confirm", async (req) => {
    const v = await verify(req, { kind: "link" });
    linkParam(req, v.link.id);
    const body = parseWith(confirmRequestSchema, parseJsonBody(v.rawBody));
    return handlePeerConfirm(sdeps, v.link, body);
  });

  route("DELETE", "/ekosistem/v1/links/:linkId", async (req, reply) => {
    const v = await verify(req, { kind: "link" });
    linkParam(req, v.link.id);
    await handlePeerRevoke(sdeps, v.link);
    return reply.status(204).send();
  });

  route("POST", "/ekosistem/v1/links/:linkId/rotate", async (req) => {
    const v = await verify(req, { kind: "link", rotate: true });
    linkParam(req, v.link.id);
    const body = parseJsonBody(v.rawBody);
    if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length > 0)) {
      throw new EkosistemError("validation_failed", "Gövde boş bir JSON nesnesi olmalıdır.");
    }
    return handlePeerRotate(sdeps, v.link, v.nonce!, { signedWithPrevious: v.signedWithPrevious });
  });

  route("PATCH", "/ekosistem/v1/links/:linkId", async (req, reply) => {
    const v = await verify(req, { kind: "link" });
    linkParam(req, v.link.id);
    const body = parseWith(patchLinkRequestSchema, parseJsonBody(v.rawBody));
    await handlePeerPatch(sdeps, v.link, body.grants);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Exports (§7)
  // ---------------------------------------------------------------------------

  route("GET", "/ekosistem/v1/brand", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "brand:read");
    if (v.query.length) throw new EkosistemError("validation_failed", "Bu uç sorgu parametresi almaz.");
    return exportBrand(sdeps, v.link);
  });

  route("GET", "/ekosistem/v1/catalog/products", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "catalog:read");
    return exportCatalogProducts(sdeps, v.link, v.query, { withCosts: hasScope(v.link, "costs:read") });
  });

  route("GET", "/ekosistem/v1/catalog/products/:ref", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "catalog:read");
    if (v.query.length) throw new EkosistemError("validation_failed", "Bu uç sorgu parametresi almaz.");
    return exportCatalogProduct(sdeps, v.link, (req.params as { ref: string }).ref, { withCosts: hasScope(v.link, "costs:read") });
  });

  route("GET", "/ekosistem/v1/orders", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "orders:read");
    return exportOrders(sdeps, v.link, v.query, { withCosts: hasScope(v.link, "costs:read") });
  });

  route("GET", "/ekosistem/v1/orders/:ref", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "orders:read");
    if (v.query.length) throw new EkosistemError("validation_failed", "Bu uç sorgu parametresi almaz.");
    return exportOrder(sdeps, v.link, (req.params as { ref: string }).ref, { withCosts: hasScope(v.link, "costs:read") });
  });

  route("GET", "/ekosistem/v1/content", async (req) => {
    const v = await verify(req, { kind: "data" });
    requireScope(v.link, "content:read");
    return exportContent(sdeps, v.link, v.query);
  });

  // ---------------------------------------------------------------------------
  // Push (§10)
  // ---------------------------------------------------------------------------

  route("POST", "/ekosistem/v1/events", async (req, reply) => {
    const v = await verify(req, { kind: "events" });
    const event = parseWith(pushEventSchema, parseJsonBody(v.rawBody));
    const status = await receivePushEvent(sdeps, v.link, event);
    return reply.status(202).send({ status });
  });

  // ---------------------------------------------------------------------------
  // Everything else under /ekosistem/v1: 404 for unknown paths, 405 for other methods.
  // ---------------------------------------------------------------------------

  const notFound = async () => {
    throw new EkosistemError("not_found", "Uç bulunamadı.");
  };
  for (const url of ["/ekosistem/v1", "/ekosistem/v1/*"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) route(method, url, notFound);
    app.route({
      method: ["HEAD", "PUT", "OPTIONS", "TRACE"],
      url,
      exposeHeadRoute: false,
      config: { rateLimit: false, cors: false },
      schema: { hide: true },
      handler: async (req, reply) => sendEkosistemError(req, reply, "method_not_allowed"),
    } as RouteOptions);
  }
};
