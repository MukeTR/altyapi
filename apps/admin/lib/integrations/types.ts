/**
 * Response shapes of the integration endpoints (/v1/integrations/providers and
 * /v1/…/integrations/*). Credentials are write-only: the API never returns them. Rows of
 * orders, listings and discrepancies are raw database rows, so extra fields may appear.
 */

export type IntegrationKind = "integrator" | "marketplace" | "feed";

export interface ProviderCapabilities {
  readOrders: boolean;
  readListings: boolean;
  writeStock: boolean;
  writePrice: boolean;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  kind: IntegrationKind | (string & {});
  /** The connector is implemented and its documentation verified; only these can be connected. */
  available: boolean;
  /** Sources and notes are written in Turkish by the platform team. */
  docs: { status: string; sources: string[]; notes: string[] };
  capabilities: ProviderCapabilities;
  /** Credential keys (plain names such as "apiKey"); labels come from the admin's catalog. */
  credentialFields: string[];
  defaultPollMinutes: number;
}

export type ConnectionStatus = "active" | "paused" | "error";

export interface IntegrationConnection {
  id: string;
  provider: string;
  providerName: string;
  kind: IntegrationKind | (string & {});
  name: string;
  status: ConnectionStatus | (string & {});
  /** Non-secret settings (store ids, environment, feed mapping). */
  settings: Record<string, unknown>;
  capabilities: ProviderCapabilities | null;
  pollIntervalMinutes: number;
  nextSyncAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  resource: string;
  status: "running" | "succeeded" | "partial" | "failed" | (string & {});
  fetched: number;
  changed: number;
  unchanged: number;
  hasMore: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ConnectionDetail extends IntegrationConnection {
  recentRuns: SyncRun[];
}

export interface ConnectResult {
  connection: IntegrationConnection;
  /** Account label reported by the provider during verification. */
  account: string | null;
}

export const EXTERNAL_ORDER_STATUSES = [
  "pending_payment",
  "awaiting_approval",
  "processing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "undelivered",
  "cancelled",
  "returned",
  "unknown",
] as const;
export type ExternalOrderStatus = (typeof EXTERNAL_ORDER_STATUSES)[number];

export interface ExternalOrderLine {
  externalId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  quantity: number;
  unitPrice: string | null;
  status?: string;
}

export interface ExternalOrder {
  id: string;
  connectionId: string;
  provider: string;
  externalId: string;
  externalNumber: string | null;
  channel: string | null;
  rawStatus: string | null;
  status: ExternalOrderStatus | (string & {});
  currency: string;
  /** Minor units (bigint serialized as a string). */
  total: string | null;
  itemCount: number;
  lines: ExternalOrderLine[];
  shipping: { carrier: string | null; trackingNumber: string | null } | null;
  customer: { name: string | null; city: string | null; district: string | null } | null;
  orderedAt: string | null;
  createdAt: string;
}

/** Page size of the listings table (the endpoint pages by offset without a total). */
export const LISTINGS_PAGE = 100;

/** Page size of the discrepancy list ("load more" with before=). */
export const DISCREPANCIES_PAGE = 100;

export interface ExternalListing {
  id: string;
  connectionId: string;
  provider: string;
  externalId: string;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  stock: number | null;
  price: string | null;
  listPrice: string | null;
  currency: string | null;
  active: boolean | null;
  /** Matched local variant; null when no SKU or barcode matched. */
  variantId: string | null;
  lastSeenAt: string | null;
}

export interface DiscrepancyValue {
  /** "altyapi" or a connection id. */
  source: string;
  label: string;
  value: string | null;
  /** This system owns the data (per the ownership map). */
  owner: boolean;
}

export interface Discrepancy {
  id: string;
  variantId: string | null;
  sku: string;
  field: "stock" | "price" | (string & {});
  values: DiscrepancyValue[];
  status: "open" | "acknowledged" | "resolved" | (string & {});
  detectedAt: string;
  lastCheckedAt: string;
  resolvedAt: string | null;
}

export const OWNERSHIP_DOMAINS = ["stock", "price", "content", "order_fulfillment"] as const;
export type OwnershipDomain = (typeof OWNERSHIP_DOMAINS)[number];

export interface OwnerInfo {
  domain: OwnershipDomain;
  /** null: altyapi owns the data (unless an external owner label is set). */
  connectionId: string | null;
  connectionName: string | null;
  provider: string | null;
  externalOwnerLabel: string | null;
}
