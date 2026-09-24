import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  acknowledgeDiscrepancy,
  connectIntegration,
  connectSchema,
  deleteConnection,
  discrepancyQuerySchema,
  externalListingsQuerySchema,
  externalOrdersQuerySchema,
  getConnection,
  getOwnership,
  listConnections,
  listDiscrepancies,
  listExternalListings,
  listExternalOrders,
  priceWriteSchema,
  PROVIDERS,
  providerView,
  requestSync,
  setOwnership,
  setOwnershipSchema,
  stockWriteSchema,
  updateConnection,
  updateConnectionSchema,
  writePrices,
  writeStock,
  type IntegrationDeps,
} from "@altyapi/integrations";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const connParams = storeParams.extend({ connectionId: z.uuid() });

/**
 * Integrators, marketplaces and feeds. Credentials go in once (encrypted) and are never
 * returned; stock/price writes follow the data-ownership map.
 */
export const integrationRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/integrations";
  const idep: IntegrationDeps = { db: deps.db, keys: deps.keys, redis: deps.redis, logger: deps.logger };

  app.get("/v1/integrations/providers", { schema: { tags: ["integrations"] } }, async () => ({ items: Object.values(PROVIDERS).map(providerView) }));

  app.get(`${base}/connections`, { schema: { tags: ["integrations"], params: storeParams } }, async (req) => ({ items: await listConnections(deps.db, await storeContext(deps, req)) }));
  app.post(`${base}/connections`, { schema: { tags: ["integrations"], params: storeParams, body: connectSchema } }, async (req, reply) =>
    reply.status(201).send(await connectIntegration(idep, await storeContext(deps, req), req.body)),
  );
  app.get(`${base}/connections/:connectionId`, { schema: { tags: ["integrations"], params: connParams } }, async (req) =>
    getConnection(deps.db, await storeContext(deps, req), req.params.connectionId),
  );
  app.patch(`${base}/connections/:connectionId`, { schema: { tags: ["integrations"], params: connParams, body: updateConnectionSchema } }, async (req) =>
    updateConnection(idep, await storeContext(deps, req), req.params.connectionId, req.body),
  );
  app.delete(`${base}/connections/:connectionId`, { schema: { tags: ["integrations"], params: connParams } }, async (req, reply) => {
    await deleteConnection(deps.db, await storeContext(deps, req), req.params.connectionId);
    return reply.status(204).send();
  });
  app.post(`${base}/connections/:connectionId/sync`, { schema: { tags: ["integrations"], params: connParams } }, async (req, reply) =>
    reply.status(202).send(await requestSync(deps.db, await storeContext(deps, req), req.params.connectionId)),
  );

  app.get(`${base}/orders`, { schema: { tags: ["integrations"], params: storeParams, querystring: externalOrdersQuerySchema } }, async (req) =>
    listExternalOrders(deps.db, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/listings`, { schema: { tags: ["integrations"], params: storeParams, querystring: externalListingsQuerySchema } }, async (req) =>
    listExternalListings(deps.db, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/discrepancies`, { schema: { tags: ["integrations"], params: storeParams, querystring: discrepancyQuerySchema } }, async (req) =>
    listDiscrepancies(deps.db, await storeContext(deps, req), req.query),
  );
  app.post(`${base}/discrepancies/:discrepancyId/acknowledge`, { schema: { tags: ["integrations"], params: storeParams.extend({ discrepancyId: z.uuid() }) } }, async (req) =>
    acknowledgeDiscrepancy(deps.db, await storeContext(deps, req), req.params.discrepancyId),
  );

  app.get(`${base}/ownership`, { schema: { tags: ["integrations"], params: storeParams } }, async (req) => ({ items: await getOwnership(deps.db, await storeContext(deps, req)) }));
  app.put(`${base}/ownership`, { schema: { tags: ["integrations"], params: storeParams, body: setOwnershipSchema } }, async (req) => {
    const ctx = await storeContext(deps, req);
    await setOwnership(deps.db, ctx, req.body);
    return { items: await getOwnership(deps.db, ctx) };
  });

  // Ownership-aware writes: altyapi, the owning integrator, or advice to change it at the owner.
  app.post(`${base}/writes/stock`, { schema: { tags: ["integrations"], params: storeParams, body: stockWriteSchema } }, async (req) =>
    writeStock(idep, await storeContext(deps, req), req.body),
  );
  app.post(`${base}/writes/prices`, { schema: { tags: ["integrations"], params: storeParams, body: priceWriteSchema } }, async (req) =>
    writePrices(idep, await storeContext(deps, req), req.body),
  );
};
