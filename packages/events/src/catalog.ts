/**
 * Versioned domain event catalog. Payloads contain identifiers and the minimal facts a
 * consumer needs; consumers re-read current state when they need more. Payloads never
 * contain secrets, credentials or card data.
 */
export interface DomainEventMap {
  "member.invited": { memberId: string; email: string };
  "store.created": { storeId: string; slug: string; name: string };
  "domain.activated": { domainId: string; hostname: string; storeId: string };
  "domain.routing_changed": { storeId: string; routingVersion: number; hostnames: string[] };
  "domain.status_changed": { domainId: string; hostname: string; from: string; to: string };
  "product.created": { productId: string };
  "product.published": { productId: string };
  "product.updated": { productId: string; fields: string[] };
  "inventory.changed": { inventoryItemId: string; locationId: string; variantId: string; available: number };
  "cart.abandoned": { cartId: string; customerId: string | null; email: string | null };
  "checkout.started": { cartId: string; orderId: string };
  "order.created": { orderId: string; orderNumber: string };
  "order.confirmed": { orderId: string; orderNumber: string };
  "order.fulfilled": { orderId: string; fulfillmentId: string };
  "order.cancelled": { orderId: string; reason: string | null };
  "payment.paid": { paymentAttemptId: string; orderId: string; provider: string };
  "payment.failed": { paymentAttemptId: string; orderId: string; provider: string; reason: string | null };
  "refund.completed": { refundId: string; orderId: string };
  "campaign.activated": { campaignId: string };
  "customer.created": { customerId: string };
  "theme.published": { publicationId: string; themeVersionId: string };
  "page.published": { pageId: string; pageVersionId: string };
  "marketing.consent_changed": { customerId: string | null; anonymousId: string | null; categories: Record<string, boolean> };
  "geo.visibility_changed": { snapshotId: string; score: number; previousScore: number | null };
  "profit.margin_breached": { productId: string | null; campaignId: string | null; marginBps: number };
  "asset.uploaded": { assetId: string };
  "import.requested": { importJobId: string };
  "feed.requested": { feedId: string };
  "ai_action.executed": { actionId: string; actionType: string };
}

export type DomainEventType = keyof DomainEventMap;
