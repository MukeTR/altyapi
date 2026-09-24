import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  cancelFulfillment,
  cancelOrder,
  cancelOrderSchema,
  CARRIER_TRACKING_URLS,
  createFulfillment,
  createFulfillmentSchema,
  createRefund,
  createRefundSchema,
  createReturnRequest,
  createReturnSchema,
  decideReturn,
  getOrder,
  listFulfillments,
  listOrders,
  listOrdersQuerySchema,
  listRefunds,
  listReturns,
  markProcessing,
  receiveReturnedGoods,
  receiveReturnSchema,
  updateFulfillment,
  updateOrder,
  updateOrderSchema,
  updateTrackingSchema,
} from "@altyapi/orders";
import { createRefundGateway, listShippingZones, saveShippingZone, zoneSchema } from "@altyapi/checkout";
import {
  connectionView,
  connectProvider,
  connectProviderSchema,
  deleteConnection,
  listConnections,
  setConnectionStatus,
} from "@altyapi/payments";
import { assertCan } from "@altyapi/tenancy";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const orderParams = storeParams.extend({ orderId: z.uuid() });

export const orderRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId";
  const gateway = createRefundGateway(deps.payments);

  // Orders
  app.get(`${base}/orders`, { schema: { tags: ["orders"], params: storeParams, querystring: listOrdersQuerySchema } }, async (req) => listOrders(deps.db, await storeContext(deps, req), req.query));
  app.get(`${base}/orders/:orderId`, { schema: { tags: ["orders"], params: orderParams } }, async (req) => {
    const ctx = await storeContext(deps, req);
    const o = await getOrder(deps.db, ctx, req.params.orderId);
    return {
      ...o,
      fulfillments: await listFulfillments(deps.db, ctx, req.params.orderId),
      refunds: await listRefunds(deps.db, ctx, req.params.orderId),
      returns: await listReturns(deps.db, ctx, req.params.orderId),
    };
  });
  app.patch(`${base}/orders/:orderId`, { schema: { tags: ["orders"], params: orderParams, body: updateOrderSchema } }, async (req) =>
    updateOrder(deps.db, await storeContext(deps, req), req.params.orderId, req.body),
  );
  app.post(`${base}/orders/:orderId/processing`, { schema: { tags: ["orders"], params: orderParams } }, async (req) => markProcessing(deps.db, await storeContext(deps, req), req.params.orderId));
  app.post(`${base}/orders/:orderId/cancel`, { schema: { tags: ["orders"], params: orderParams, body: cancelOrderSchema } }, async (req) =>
    cancelOrder(deps.db, gateway, await storeContext(deps, req), req.params.orderId, req.body, req.ip),
  );
  app.post(`${base}/orders/:orderId/refunds`, { schema: { tags: ["orders"], params: orderParams, body: createRefundSchema } }, async (req, reply) =>
    reply.status(201).send(await createRefund(deps.db, gateway, await storeContext(deps, req), req.params.orderId, req.body, req.ip)),
  );

  // Fulfillment
  app.get("/v1/carriers", { schema: { tags: ["orders"] } }, async () => ({
    items: Object.entries(CARRIER_TRACKING_URLS).map(([code, c]) => ({ code, name: c.name })),
  }));
  app.post(`${base}/orders/:orderId/fulfillments`, { schema: { tags: ["orders"], params: orderParams, body: createFulfillmentSchema } }, async (req, reply) =>
    reply.status(201).send(await createFulfillment(deps.db, await storeContext(deps, req), req.params.orderId, req.body)),
  );
  app.patch(`${base}/fulfillments/:fulfillmentId`, { schema: { tags: ["orders"], params: storeParams.extend({ fulfillmentId: z.uuid() }), body: updateTrackingSchema } }, async (req) =>
    updateFulfillment(deps.db, await storeContext(deps, req), req.params.fulfillmentId, req.body),
  );
  app.post(`${base}/fulfillments/:fulfillmentId/cancel`, { schema: { tags: ["orders"], params: storeParams.extend({ fulfillmentId: z.uuid() }) } }, async (req, reply) => {
    await cancelFulfillment(deps.db, await storeContext(deps, req), req.params.fulfillmentId);
    return reply.status(204).send();
  });

  // Returns
  app.post(`${base}/orders/:orderId/returns`, { schema: { tags: ["orders"], params: orderParams, body: createReturnSchema } }, async (req, reply) => {
    const ctx = await storeContext(deps, req);
    assertCan(ctx, "orders:write");
    return reply.status(201).send(await createReturnRequest(deps.db, ctx, req.params.orderId, req.body, true));
  });
  app.post(
    `${base}/returns/:returnId/decision`,
    { schema: { tags: ["orders"], params: storeParams.extend({ returnId: z.uuid() }), body: z.object({ decision: z.enum(["approved", "rejected", "cancelled"]) }) } },
    async (req) => decideReturn(deps.db, await storeContext(deps, req), req.params.returnId, req.body.decision),
  );
  app.post(`${base}/returns/:returnId/receive`, { schema: { tags: ["orders"], params: storeParams.extend({ returnId: z.uuid() }), body: receiveReturnSchema } }, async (req) =>
    receiveReturnedGoods(deps.db, await storeContext(deps, req), req.params.returnId, req.body),
  );

  // Shipping configuration
  app.get(`${base}/shipping-zones`, { schema: { tags: ["settings"], params: storeParams } }, async (req) => ({ items: await listShippingZones(deps.db, await storeContext(deps, req)) }));
  app.post(`${base}/shipping-zones`, { schema: { tags: ["settings"], params: storeParams, body: zoneSchema } }, async (req, reply) =>
    reply.status(201).send({ id: await saveShippingZone(deps.db, await storeContext(deps, req), req.body) }),
  );
  app.put(`${base}/shipping-zones/:zoneId`, { schema: { tags: ["settings"], params: storeParams.extend({ zoneId: z.uuid() }), body: zoneSchema } }, async (req) => ({
    id: await saveShippingZone(deps.db, await storeContext(deps, req), req.body, req.params.zoneId),
  }));

  // Payment provider connections (merchant-owned accounts)
  app.get("/v1/payment-providers", { schema: { tags: ["payments"] } }, async () => ({
    items: Object.values(deps.payments.registry).map((d) => ({
      name: d.name,
      credentialFields: d.credentialFields,
      requiresPhone: d.requiresPhone,
      supportsPartialRefund: d.supportsPartialRefund,
      supportsCancel: d.supportsCancel,
      notificationUrlSetting: d.notificationUrlSetting,
    })),
  }));
  app.get(`${base}/payment-connections`, { schema: { tags: ["payments"], params: storeParams } }, async (req) => ({
    items: (await listConnections(deps.db, await storeContext(deps, req))).map((c) => connectionView(c, deps.payments.registry, deps.env.API_URL)),
  }));
  app.post(`${base}/payment-connections`, { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["payments"], params: storeParams, body: connectProviderSchema } }, async (req, reply) =>
    reply.status(201).send(connectionView(await connectProvider(deps.payments, await storeContext(deps, req), req.body), deps.payments.registry, deps.env.API_URL)),
  );
  app.patch(
    `${base}/payment-connections/:connectionId`,
    { schema: { tags: ["payments"], params: storeParams.extend({ connectionId: z.uuid() }), body: z.object({ status: z.enum(["active", "disabled"]) }) } },
    async (req) => connectionView(await setConnectionStatus(deps.db, await storeContext(deps, req), req.params.connectionId, req.body.status), deps.payments.registry, deps.env.API_URL),
  );
  app.delete(`${base}/payment-connections/:connectionId`, { schema: { tags: ["payments"], params: storeParams.extend({ connectionId: z.uuid() }) } }, async (req, reply) => {
    await deleteConnection(deps.db, await storeContext(deps, req), req.params.connectionId);
    return reply.status(204).send();
  });
};
