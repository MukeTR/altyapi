import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  addCustomDomain,
  addDomainSchema,
  listDomains,
  removeDomain,
  resolveHostname,
  retryDomain,
  setCanonicalDomain,
  verifyEdgeSignature,
  type DomainDeps,
  type DomainRow,
} from "@altyapi/domains";
import { AppError } from "@altyapi/commerce-core";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const domainSchema = z.object({
  id: z.uuid(),
  hostname: z.string(),
  kind: z.enum(["platform_subdomain", "custom"]),
  status: z.string(),
  isCanonical: z.boolean(),
  redirectToHostname: z.string().nullable(),
  sslStatus: z.string().nullable(),
  dnsInstructions: z.array(
    z.object({ type: z.string(), name: z.string(), value: z.string(), purpose: z.string() }),
  ),
  verificationErrors: z.array(z.string()),
  failureReason: z.string().nullable(),
  lastCheckedAt: z.date().nullable(),
  activatedAt: z.date().nullable(),
  createdAt: z.date(),
});

const view = (d: DomainRow) => ({
  id: d.id,
  hostname: d.hostname,
  kind: d.kind,
  status: d.status,
  isCanonical: d.isCanonical,
  redirectToHostname: d.redirectToHostname,
  sslStatus: d.sslStatus,
  dnsInstructions: d.dnsInstructions,
  verificationErrors: d.verificationErrors,
  failureReason: d.failureReason,
  lastCheckedAt: d.lastCheckedAt,
  activatedAt: d.activatedAt,
  createdAt: d.createdAt,
});

const domainParams = storeParams.extend({ domainId: z.uuid() });

export const domainRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; domainDeps: DomainDeps }> = async (app, { deps, domainDeps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/domains";

  app.get(base, { schema: { tags: ["domains"], params: storeParams, response: { 200: z.object({ items: z.array(domainSchema) }) } } }, async (req) => ({
    items: (await listDomains(deps.db, await storeContext(deps, req))).map(view),
  }));

  app.post(
    base,
    { schema: { tags: ["domains"], params: storeParams, body: addDomainSchema, response: { 201: z.object({ items: z.array(domainSchema) }) } } },
    async (req, reply) => {
      const rows = await addCustomDomain(domainDeps, await storeContext(deps, req), req.body);
      return reply.status(201).send({ items: rows.map(view) });
    },
  );

  app.post(
    `${base}/:domainId/retry`,
    { schema: { tags: ["domains"], params: domainParams, response: { 200: domainSchema } } },
    async (req) => view(await retryDomain(domainDeps, await storeContext(deps, req), req.params.domainId)),
  );

  app.post(
    `${base}/:domainId/canonical`,
    { schema: { tags: ["domains"], params: domainParams, response: { 200: domainSchema } } },
    async (req) => view(await setCanonicalDomain(deps.db, await storeContext(deps, req), req.params.domainId)),
  );

  app.delete(
    `${base}/:domainId`,
    { schema: { tags: ["domains"], params: domainParams, response: { 204: z.null() } } },
    async (req, reply) => {
      await removeDomain(domainDeps, await storeContext(deps, req), req.params.domainId);
      return reply.status(204).send(null);
    },
  );

  /** Hostname resolution for the edge router. Authenticated with the edge HMAC signature. */
  app.get(
    "/internal/edge/resolve",
    {
      config: { rateLimit: false },
      schema: { hide: true, querystring: z.object({ host: z.string().min(1).max(260) }) },
    },
    async (req, reply) => {
      const sig = req.headers["x-altyapi-edge-signature"];
      if (!verifyEdgeSignature(deps.env.EDGE_ROUTING_SECRET, req.query.host, typeof sig === "string" ? sig : undefined)) {
        throw new AppError("unauthenticated", "errors.edge.invalid_signature");
      }
      const resolution = await resolveHostname(deps.db, req.query.host);
      if (!resolution) return reply.status(404).send({ error: { code: "not_found", message_key: "errors.domain.unknown_host" } });
      return resolution;
    },
  );
};
