import { z } from "zod";
import { AppError } from "@altyapi/commerce-core";
import { and, carts, desc, eq, orders, paymentAttempts, paymentProviderConnections, sql, stores, withPlatformTx, withTenantTx, type Transaction } from "@altyapi/database";
import { reserveStock } from "@altyapi/inventory";
import { cancelUnpaidOrder, createOrder, type OrderDraft } from "@altyapi/orders";
import {
  createAttempt,
  markAttemptFailed,
  markSessionCreated,
  providerForConnection,
  selectConnection,
  type CreatePaymentInput,
  type PaymentsDeps,
  type ProviderName,
} from "@altyapi/payments";
import { calculateCart, type CartCalculation, type CartRow } from "./calculate";
import { loadCart, type CartDeps, type StoreRef } from "./cart";

export interface CheckoutDeps extends CartDeps {
  payments: PaymentsDeps;
  /** Public base URL of the API (payment callbacks). */
  apiUrl: string;
  reservationMinutes: number;
}

export const startCheckoutSchema = z.object({
  provider: z.enum(["paytr", "iyzico"]).optional(),
  /** Storefront origin used for return/status URLs; validated against the store's hostnames. */
  returnBaseUrl: z.url(),
});

export interface CheckoutStart {
  orderId: string;
  orderNumber: string;
  accessToken: string;
  statusUrl: string;
  payment: { attemptId: string; provider: ProviderName; kind: string; url: string | null; html: string | null; expiresAt: Date };
}

function validateForCheckout(cart: CartRow, calc: CartCalculation, requiresPhone: boolean) {
  const problems: string[] = [];
  if (!calc.lines.length) problems.push("empty_cart");
  if (calc.lines.some((l) => !l.available)) problems.push("unavailable_lines");
  if (!cart.email) problems.push("email_required");
  if (requiresPhone && !cart.phone && !calc.billingAddress?.phone) problems.push("phone_required");
  if (calc.requiresShipping && !calc.shippingAddress) problems.push("shipping_address_required");
  if (calc.requiresShipping && !calc.shipping) problems.push("shipping_method_required");
  if (!calc.billingAddress) problems.push("billing_address_required");
  if (calc.totals.total <= 0n) problems.push("zero_total");
  if (problems.length) throw new AppError("unprocessable", "errors.checkout.not_ready", { problems, issues: calc.issues });
}

function draftFromCalc(cart: CartRow, calc: CartCalculation): OrderDraft {
  const adjustments: OrderDraft["adjustments"] = [];
  for (const d of calc.discounts) {
    for (const la of d.lineAmounts) {
      const idx = calc.lines.findIndex((l) => l.id === la.lineId);
      if (la.amount > 0n) adjustments.push({ lineIndex: idx >= 0 ? idx : null, type: "discount", campaignId: d.campaignId, code: d.code, amount: la.amount, description: d.description });
    }
    if (d.shippingAmount > 0n) adjustments.push({ lineIndex: null, type: "shipping_discount", campaignId: d.campaignId, code: d.code, amount: d.shippingAmount, description: d.description });
  }
  const lines = calc.lines.filter((l) => l.available);
  return {
    cartId: cart.id,
    customerId: cart.customerId,
    email: cart.email,
    phone: cart.phone ?? calc.billingAddress?.phone ?? null,
    currency: cart.currency,
    locale: cart.locale,
    channelId: cart.channelId,
    note: cart.note,
    lines: lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      sku: l.sku,
      title: l.title,
      variantTitle: l.variantTitle,
      imageObjectKey: l.imageObjectKey,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      compareAtUnitPrice: l.compareAtUnitPrice,
      unitCost: l.unitCost,
      discountAmount: l.discount,
      taxRateBps: l.taxRateBps,
      taxAmount: l.taxAmount,
      taxIncluded: l.taxIncluded,
      total: l.total,
      requiresShipping: l.requiresShipping,
      properties: l.properties,
    })),
    adjustments: adjustments.map((a) => ({ ...a, lineIndex: a.lineIndex === null ? null : lines.indexOf(calc.lines[a.lineIndex]!) })),
    totals: calc.totals,
    shippingAddress: calc.shippingAddress,
    billingAddress: calc.billingAddress,
    shippingMethod: calc.shipping ? { rateId: calc.shipping.rateId, name: calc.shipping.name, carrierCode: calc.shipping.carrierCode, amount: calc.shipping.amount } : null,
    attribution: { ...cart.attribution, couponCode: calc.appliedCodes[0] ?? null },
    couponCodes: calc.appliedCodes,
    source: "storefront",
  };
}

/** Basket for providers: one item per line at its final price, plus shipping and exclusive tax, summing to the total. */
function paymentItems(calc: CartCalculation): CreatePaymentInput["items"] {
  const items: CreatePaymentInput["items"] = calc.lines
    .filter((l) => l.available)
    .map((l) => ({
      id: l.id,
      name: l.variantTitle ? `${l.title} (${l.variantTitle}) x${l.quantity}` : `${l.title} x${l.quantity}`,
      category: "Ürün",
      quantity: 1,
      unitPrice: l.total,
      kind: l.requiresShipping ? "physical" : "digital",
    }));
  if (calc.shipping && calc.shipping.amount - calc.shipping.discount > 0n) {
    items.push({ id: "shipping", name: calc.shipping.name || "Kargo", category: "Kargo", quantity: 1, unitPrice: calc.shipping.amount - calc.shipping.discount, kind: "shipping" });
  }
  const exclusiveTax = calc.lines.filter((l) => l.available && !l.taxIncluded).reduce((s, l) => s + l.taxAmount, 0n);
  if (exclusiveTax > 0n) items.push({ id: "tax", name: "KDV", category: "Vergi", quantity: 1, unitPrice: exclusiveTax, kind: "digital" });
  return items;
}

async function assertReturnBase(tx: Transaction, storeId: string, returnBaseUrl: string, appEnv: string) {
  const url = new URL(returnBaseUrl);
  if (appEnv === "local" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.origin;
  const rows = await tx.execute<{ hostname: string }>(
    sql`select hostname from store_domains where store_id = ${storeId} and status = 'active'`,
  );
  if (url.protocol !== "https:" || !rows.some((r) => r.hostname === url.hostname)) throw new AppError("validation_failed", "errors.checkout.invalid_return_url");
  return url.origin;
}

/**
 * Starts payment for a cart: validates it, creates the pending order, reserves stock and
 * opens a provider session. A repeated call for an unchanged cart returns the same session.
 */
export async function startCheckout(
  deps: CheckoutDeps & { appEnv: string },
  ref: StoreRef,
  token: string,
  input: z.infer<typeof startCheckoutSchema>,
  clientIp: string,
): Promise<CheckoutStart> {
  const prepared = await withTenantTx(deps.db, ref, async (tx) => {
    const cart = await loadCart(tx, ref, token, true);
    if (cart.status === "completed") throw new AppError("conflict", "errors.cart.completed");
    const origin = await assertReturnBase(tx, ref.storeId, input.returnBaseUrl, deps.appEnv);
    const store = await tx.query.stores.findFirst({ where: eq(stores.id, ref.storeId) });

    // Reuse an in-flight session when nothing changed (double submit, page refresh).
    const pending = await tx.query.orders.findFirst({ where: and(eq(orders.cartId, cart.id), eq(orders.status, "awaiting_payment")) });
    if (pending) {
      const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, pending.id)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
      const data = attempt?.clientData as { cartVersion?: number; accessToken?: string; kind?: string; url?: string | null; html?: string | null } | null;
      if (
        attempt?.status === "session_created" &&
        attempt.sessionExpiresAt &&
        attempt.sessionExpiresAt.getTime() > Date.now() + 120_000 &&
        data?.cartVersion === cart.version &&
        (!input.provider || input.provider === attempt.provider)
      ) {
        return {
          reuse: {
            orderId: pending.id,
            orderNumber: pending.number,
            accessToken: data.accessToken ?? "",
            statusUrl: `${origin}/checkout/complete?order=${pending.id}&t=${data.accessToken ?? ""}`,
            payment: { attemptId: attempt.id, provider: attempt.provider, kind: data.kind ?? "iframe", url: data.url ?? null, html: data.html ?? null, expiresAt: attempt.sessionExpiresAt },
          } satisfies CheckoutStart,
        };
      }
      await cancelUnpaidOrder(tx, ref, pending.id, "checkout_restarted");
    }

    const connection = await selectConnection(tx, ref.storeId, input.provider);
    const def = deps.payments.registry[connection.provider];
    const calc = await calculateCart(tx, cart, deps.discounts, { defaultLocale: store!.defaultLocale });
    validateForCheckout(cart, calc, def.requiresPhone);
    const { order, accessToken } = await createOrder(tx, ref, draftFromCalc(cart, calc));
    await reserveStock(tx, ref, {
      lines: calc.lines.filter((l) => l.available).map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      orderId: order.id,
      cartId: cart.id,
      ttlMinutes: deps.reservationMinutes,
    });
    const attempt = await createAttempt(tx, ref, {
      orderId: order.id,
      connection,
      amount: calc.totals.total,
      currency: cart.currency,
      idempotencyKey: `checkout:${order.id}`,
    });
    await tx.update(carts).set({ status: "checking_out" }).where(eq(carts.id, cart.id));
    const settings = (store!.settings as { checkout?: { maxInstallments?: number } }).checkout ?? {};
    return { cart, calc, order, accessToken, attempt, connection, origin, maxInstallments: settings.maxInstallments ?? 12, locale: cart.locale };
  });
  if ("reuse" in prepared && prepared.reuse) return prepared.reuse;

  const { cart, calc, order, accessToken, attempt, connection, origin } = prepared;
  const statusUrl = `${origin}/checkout/complete?order=${order.id}&t=${accessToken}`;
  const billing = calc.billingAddress!;
  const toAddr = (a: NonNullable<CartCalculation["shippingAddress"]>) => ({
    contactName: `${a.firstName} ${a.lastName}`,
    line: [a.line1, a.line2, a.district].filter(Boolean).join(", "),
    city: a.province ?? a.city,
    country: a.countryCode === "TR" ? "Turkey" : a.countryCode,
    postalCode: a.postalCode ?? null,
  });
  try {
    const provider = await providerForConnection(deps.payments, connection);
    const session = await provider.createSession({
      attemptId: attempt.id,
      reference: attempt.providerReference,
      orderNumber: order.number,
      amount: calc.totals.total,
      currency: cart.currency,
      locale: prepared.locale,
      items: paymentItems(calc),
      buyer: {
        id: cart.customerId ?? cart.id,
        email: cart.email!,
        firstName: billing.firstName,
        lastName: billing.lastName,
        phone: cart.phone ?? billing.phone ?? null,
        identityNumber: billing.identityNumber ?? null,
        ip: clientIp,
        registeredAt: null,
      },
      shippingAddress: calc.shippingAddress ? toAddr(calc.shippingAddress) : null,
      billingAddress: toAddr(billing),
      urls: {
        success: statusUrl,
        failure: `${statusUrl}&failed=1`,
        callback: `${deps.apiUrl}/payments/v1/iyzico/callback/${attempt.id}`,
      },
      maxInstallments: prepared.maxInstallments,
      timeoutMinutes: deps.reservationMinutes,
    });
    await markSessionCreated(deps.db, attempt.id, session);
    // Keep what is needed to resume the session (no secrets): cart version, access token, return URL.
    await withTenantTx(deps.db, ref, (tx) =>
      tx
        .update(paymentAttempts)
        .set({ clientData: { kind: session.kind, url: session.url, html: session.html, cartVersion: cart.version, accessToken, statusUrl } })
        .where(eq(paymentAttempts.id, attempt.id)),
    );
    return {
      orderId: order.id,
      orderNumber: order.number,
      accessToken,
      statusUrl,
      payment: { attemptId: attempt.id, provider: connection.provider, kind: session.kind, url: session.url, html: session.html, expiresAt: session.expiresAt },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withTenantTx(deps.db, ref, async (tx) => {
      await markAttemptFailed(tx, attempt.id, "session_failed", message);
      await cancelUnpaidOrder(tx, ref, order.id, "payment_session_failed");
    });
    throw new AppError("dependency_unavailable", "errors.checkout.payment_session_failed", { provider: connection.provider, message: message.slice(0, 300) });
  }
}

/** Connections usable at checkout (for the storefront payment method picker). */
export async function checkoutPaymentMethods(deps: CheckoutDeps, ref: StoreRef) {
  const rows = await withPlatformTx(deps.db, (tx) =>
    tx.select().from(paymentProviderConnections).where(and(eq(paymentProviderConnections.storeId, ref.storeId), eq(paymentProviderConnections.status, "active"))).orderBy(desc(paymentProviderConnections.priority)),
  );
  return rows.map((r) => ({ provider: r.provider, mode: r.mode, requiresPhone: deps.payments.registry[r.provider].requiresPhone }));
}
