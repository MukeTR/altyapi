import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  addLine,
  addLineSchema,
  applyCoupon,
  attributionSchema,
  checkoutPaymentMethods,
  couponSchema,
  createCart,
  createCartSchema,
  removeCoupon,
  selectShippingRate,
  setAddresses,
  setAddressesSchema,
  setAttribution,
  setContact,
  setContactSchema,
  shippingOptions,
  startCheckout,
  startCheckoutSchema,
  updateLine,
  updateLineSchema,
  viewCart,
  type CartCalculation,
  type CartRow,
} from "@altyapi/checkout";
import { getOrderByAccessToken } from "@altyapi/orders";
import { catalogItemId } from "@altyapi/marketing";
import { AppError } from "@altyapi/commerce-core";
import type { AppDeps } from "../deps";
import { storefrontCommerceContext } from "../plugins/storefront-auth";

function cartToken(req: FastifyRequest): string {
  const t = req.headers["x-altyapi-cart-token"];
  if (typeof t !== "string" || t.length < 20 || t.length > 100) throw new AppError("not_found", "errors.cart.not_found");
  return t;
}

function clientIp(req: FastifyRequest): string {
  const ip = req.headers["x-altyapi-client-ip"];
  return typeof ip === "string" && ip ? ip : req.ip;
}

/** Shopper-facing cart representation (no internal ids beyond what the UI needs). */
export function cartView(cart: CartRow, calc: CartCalculation) {
  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    locale: cart.locale,
    email: cart.email,
    phone: cart.phone,
    acceptsMarketing: cart.acceptsMarketing,
    note: cart.note,
    itemCount: calc.itemCount,
    lines: calc.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      title: l.title,
      variantTitle: l.variantTitle,
      handle: l.handle,
      sku: l.sku,
      imageObjectKey: l.imageObjectKey,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      compareAtUnitPrice: l.compareAtUnitPrice,
      subtotal: l.subtotal,
      discount: l.discount,
      total: l.total,
      taxAmount: l.taxAmount,
      available: l.available,
      availableQuantity: l.availableQuantity,
      issues: l.issues,
    })),
    discounts: calc.discounts.map((d) => ({ code: d.code, description: d.description, amount: d.lineAmounts.reduce((s, x) => s + x.amount, 0n) + d.shippingAmount })),
    couponCodes: calc.appliedCodes,
    shipping: calc.shipping ? { rateId: calc.shipping.rateId, name: calc.shipping.name, amount: calc.shipping.amount, discount: calc.shipping.discount } : null,
    requiresShipping: calc.requiresShipping,
    shippingAddress: calc.shippingAddress,
    billingAddress: calc.billingAddress,
    totals: calc.totals,
    issues: calc.issues,
  };
}

export const storefrontCartRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const cd = { db: deps.db, discounts: deps.discounts };
  const limit = { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => clientIp(r) } };

  app.post("/storefront/v1/carts", { config: limit, schema: { hide: true, body: createCartSchema } }, async (req, reply) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { token } = await createCart(deps.db, ctx, req.body);
    const { cart, calc } = await viewCart(cd, ctx, token);
    return reply.status(201).send({ token, cart: cartView(cart, calc) });
  });

  app.get("/storefront/v1/cart", { config: limit, schema: { hide: true } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await viewCart(cd, ctx, cartToken(req));
    return cartView(cart, calc);
  });

  app.post("/storefront/v1/cart/lines", { config: limit, schema: { hide: true, body: addLineSchema } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await addLine(cd, ctx, cartToken(req), req.body);
    return cartView(cart, calc);
  });

  app.patch("/storefront/v1/cart/lines/:lineId", { config: limit, schema: { hide: true, params: z.object({ lineId: z.uuid() }), body: updateLineSchema } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await updateLine(cd, ctx, cartToken(req), req.params.lineId, req.body);
    return cartView(cart, calc);
  });

  app.put("/storefront/v1/cart/contact", { config: limit, schema: { hide: true, body: setContactSchema } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await setContact(cd, ctx, cartToken(req), req.body);
    return cartView(cart, calc);
  });

  app.put("/storefront/v1/cart/addresses", { config: limit, schema: { hide: true, body: setAddressesSchema } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await setAddresses(cd, ctx, cartToken(req), req.body);
    return cartView(cart, calc);
  });

  app.get("/storefront/v1/cart/shipping-rates", { config: limit, schema: { hide: true } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    return { items: await shippingOptions(cd, ctx, cartToken(req)) };
  });

  app.put("/storefront/v1/cart/shipping-rate", { config: limit, schema: { hide: true, body: z.object({ rateId: z.uuid() }) } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await selectShippingRate(cd, ctx, cartToken(req), req.body.rateId);
    return cartView(cart, calc);
  });

  app.post("/storefront/v1/cart/coupons", { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => clientIp(r) } }, schema: { hide: true, body: couponSchema } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await applyCoupon(cd, ctx, cartToken(req), req.body.code);
    return cartView(cart, calc);
  });

  app.delete("/storefront/v1/cart/coupons/:code", { config: limit, schema: { hide: true, params: z.object({ code: z.string().max(64) }) } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    const { cart, calc } = await removeCoupon(cd, ctx, cartToken(req), req.params.code.toUpperCase());
    return cartView(cart, calc);
  });

  app.put("/storefront/v1/cart/attribution", { config: limit, schema: { hide: true, body: attributionSchema } }, async (req, reply) => {
    const ctx = await storefrontCommerceContext(deps, req);
    await setAttribution(cd, ctx, cartToken(req), req.body);
    return reply.status(204).send();
  });

  app.get("/storefront/v1/payment-methods", { config: limit, schema: { hide: true } }, async (req) => {
    const ctx = await storefrontCommerceContext(deps, req);
    return { items: await checkoutPaymentMethods({ ...cd, payments: deps.payments, apiUrl: deps.env.API_URL, reservationMinutes: 30 }, ctx) };
  });

  app.post(
    "/storefront/v1/checkout",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => clientIp(r) } }, schema: { hide: true, body: startCheckoutSchema } },
    async (req, reply) => {
      const ctx = await storefrontCommerceContext(deps, req);
      const result = await startCheckout(
        { ...cd, payments: deps.payments, apiUrl: deps.env.API_URL, reservationMinutes: 30, appEnv: deps.env.APP_ENV },
        ctx,
        cartToken(req),
        req.body,
        { ip: clientIp(req), userAgent: typeof req.headers["x-altyapi-client-ua"] === "string" ? req.headers["x-altyapi-client-ua"] : null },
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/storefront/v1/orders/:orderId",
    { config: limit, schema: { hide: true, params: z.object({ orderId: z.uuid() }), querystring: z.object({ t: z.string().min(20).max(100) }) } },
    async (req) => {
      const ctx = await storefrontCommerceContext(deps, req);
      const o = await getOrderByAccessToken(deps.db, ctx, req.params.orderId, req.query.t);
      return {
        id: o.order.id,
        number: o.order.number,
        status: o.order.status,
        paymentStatus: o.order.paymentStatus,
        fulfillmentStatus: o.order.fulfillmentStatus,
        email: o.order.email,
        currency: o.order.currency,
        totals: { subtotal: o.order.subtotal, discountTotal: o.order.discountTotal, shippingTotal: o.order.shippingTotal, taxTotal: o.order.taxTotal, total: o.order.total },
        lines: o.lines.map((l) => ({ itemId: catalogItemId(l), title: l.title, variantTitle: l.variantTitle, quantity: l.quantity, total: l.total, imageObjectKey: l.imageObjectKey })),
        shippingAddress: o.shippingAddress,
        createdAt: o.order.createdAt,
      };
    },
  );
};
