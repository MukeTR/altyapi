import { z } from "zod";
import { defineModule } from "../manifest";

/**
 * Online selling: cart, checkout, orders, payments, customer accounts and discount campaigns.
 * Needs the catalog for what it sells.
 */
export const commerceModule = defineModule({
  key: "commerce",
  version: "1.0.0",
  label: { tr: "E-ticaret", en: "Commerce" },
  description: {
    tr: "Sepet, ödeme, siparişler, müşteri hesapları, ödeme sağlayıcıları ve kampanyalar.",
    en: "Cart, checkout, orders, customer accounts, payment providers and campaigns.",
  },
  dependsOn: ["catalog"],
  resources: ["orders", "customers", "payments", "campaigns"],
  routes: [
    { id: "commerce.cart", path: "/cart", match: "exact", cacheClass: "private", pageClass: "checkout" },
    { id: "commerce.checkout", path: "/checkout", match: "prefix", cacheClass: "private", pageClass: "checkout" },
  ],
  templates: [],
  settings: z.object({}),
  events: [
    "cart.abandoned",
    "checkout.started",
    "order.created",
    "order.confirmed",
    "order.fulfilled",
    "order.cancelled",
    "payment.paid",
    "payment.failed",
    "refund.completed",
    "campaign.activated",
    "customer.created",
  ],
  adminNav: [
    { key: "orders", label: { tr: "Siparişler", en: "Orders" }, path: "/orders", permission: "orders:read", order: 10 },
    { key: "customers", label: { tr: "Müşteriler", en: "Customers" }, path: "/customers", permission: "customers:read", order: 11 },
    { key: "campaigns", label: { tr: "Kampanyalar", en: "Campaigns" }, path: "/campaigns", permission: "campaigns:read", order: 40 },
    { key: "payments", label: { tr: "Ödeme sağlayıcıları", en: "Payment providers" }, path: "/settings/payments", permission: "payments:read", order: 93 },
  ],
});
