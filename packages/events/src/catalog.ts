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
  /** Hard delete (never-published drafts); an ekosistem tombstone is written in the same transaction. */
  "product.deleted": { productId: string };
  /** A collection was saved, its manual membership was set, or it was deleted. */
  "collection.changed": { collectionId: string; change: "created" | "updated" | "products" | "deleted" };
  /** Store settings changed (name, locales, currencies, status…); fields lists the submitted setting keys. */
  "store.settings_updated": { fields: string[]; contentVersion: number };
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
  /**
   * A scheduled publish or unpublish of a page was refused (errorKey, e.g. a handle another
   * page is served under) and the page left the schedule so the merchant can fix it.
   */
  "page.schedule_failed": { pageId: string; operation: "publish" | "unpublish"; errorKey: string; details: Record<string, unknown> };
  /**
   * The live storefront pointer moved to another publication (publish, unpublish, scheduled
   * publishing or rollback). contentVersion is the store's content version after the switch.
   */
  "storefront.publication_switched": {
    publicationId: string;
    previousPublicationId: string | null;
    number: number;
    reason: string;
    contentVersion: number;
  };
  /** A merchant redirect was created, changed or removed; contentVersion is the store's content version after it. */
  "redirect.changed": {
    redirectId: string;
    fromPath: string;
    toPath: string | null;
    change: "created" | "updated" | "deleted";
    contentVersion: number;
  };
  "tracking.updated": { version: number };
  "marketing.consent_changed": { customerId: string | null; anonymousId: string | null; categories: Record<string, boolean> };
  /**
   * AI visibility moved noticeably. From the ekosistem bridge: a Yanıt summary whose
   * visibilityBps differs by at least 1500 bps from the previous stored snapshot (§9.1).
   */
  "geo.visibility_changed": {
    snapshotId: string;
    score: number;
    previousScore: number | null;
    source?: "yanit";
    windowDays?: number;
    linkId?: string;
  };
  /**
   * A price or campaign is below the margin floor. From the ekosistem bridge: a Kârmatik
   * profitability row newly became loss-making, or its safe discount dropped to 0 (§8.2).
   */
  "profit.margin_breached": {
    productId: string | null;
    campaignId: string | null;
    marginBps: number;
    source?: "karmatik";
    reason?: "loss_making" | "no_safe_discount";
    variantId?: string | null;
    channel?: string | null;
    ref?: string;
    linkId?: string;
  };
  "asset.uploaded": { assetId: string };
  "import.requested": { importJobId: string };
  "feed.requested": { feedId: string };
  "ai_action.executed": { actionId: string; actionType: string };
  /**
   * Ekosistem link lifecycle (docs/ekosistem/v1.md §4.1): link creation, removal and scope
   * changes are reported to the store owner. Never carries secrets or codes.
   */
  "ekosistem.link_changed": {
    linkId: string;
    peerProduct: string;
    change: "awaiting_approval" | "activated" | "rejected" | "revoked" | "revoked_by_peer" | "peer_grants_changed";
    grants?: string[];
  };
}

export type DomainEventType = keyof DomainEventMap;
