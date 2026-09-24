import type { z } from "zod";
import type { ExternalOrderLine } from "@altyapi/database";
import type { Logger } from "@altyapi/observability";
import type { HttpClient } from "./http";

export type ProviderId =
  | "stockmount"
  | "dopigo"
  | "entegra"
  | "sopyo"
  | "prapazar"
  | "trendyol"
  | "hepsiburada"
  | "n11"
  | "feed";

export type ProviderKind = "integrator" | "marketplace" | "feed";

export type NormalizedOrderStatus =
  | "pending_payment"
  | "awaiting_approval"
  | "processing"
  | "ready_to_ship"
  | "shipped"
  | "delivered"
  | "undelivered"
  | "cancelled"
  | "returned"
  | "unknown";

export interface Capabilities {
  readOrders: boolean;
  readListings: boolean;
  /** Writes are only offered where the provider's documentation confirms them. */
  writeStock: boolean;
  writePrice: boolean;
}

/**
 * How well the provider's API is known. Connectors are built only from "verified" sources;
 * "pending" providers can be listed but not connected until documentation is available.
 */
export interface ProviderDocs {
  status: "verified" | "pending";
  sources: string[];
  notes: string[];
}

export interface ExternalOrderInput {
  externalId: string;
  externalNumber: string | null;
  channel: string | null;
  rawStatus: string | null;
  status: NormalizedOrderStatus;
  currency: string;
  total: bigint | null;
  lines: ExternalOrderLine[];
  shipping: { carrier: string | null; trackingNumber: string | null } | null;
  customer: { name: string | null; city: string | null; district: string | null } | null;
  orderedAt: Date | null;
  externalUpdatedAt: Date | null;
  /**
   * Partial updates for channels that report an order in pieces: "lines" merges these lines
   * into the stored order (by line id); "status" only moves the order's status forward.
   */
  merge?: "lines" | "status";
}

export interface ExternalListingInput {
  externalId: string;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  stock: number | null;
  price: bigint | null;
  listPrice: bigint | null;
  currency: string | null;
  active: boolean | null;
  externalUpdatedAt: Date | null;
}

export interface PullResult<T> {
  items: T[];
  /** Cursor to persist; the next call resumes from it. */
  cursor: Record<string, unknown>;
  /** False while more pages remain in the current pass. */
  done: boolean;
}

export interface StockWrite {
  sku: string;
  quantity: number;
  /** The provider's listing id for this SKU, from the last listing sync. */
  externalId?: string | null;
}

export interface PriceWrite {
  sku: string;
  /** Minor units. */
  price: bigint;
  listPrice?: bigint | null;
  externalId?: string | null;
}

export interface WriteResult {
  sku: string;
  ok: boolean;
  message?: string;
}

export interface Connector {
  /** Checks the credentials against the provider and returns a label for the account. */
  verify(): Promise<{ ok: true; label: string | null } | { ok: false; message: string }>;
  pullOrders?(cursor: Record<string, unknown>): Promise<PullResult<ExternalOrderInput>>;
  pullListings?(cursor: Record<string, unknown>): Promise<PullResult<ExternalListingInput>>;
  pushStock?(items: StockWrite[]): Promise<WriteResult[]>;
  pushPrice?(items: PriceWrite[], currency: string): Promise<WriteResult[]>;
}

/** Encrypted per-connection session storage (API tokens). */
export interface SessionStore {
  get<T extends Record<string, unknown>>(): T | null;
  set(value: Record<string, unknown> | null): void;
}

export interface ConnectorContext<C, S> {
  credentials: C;
  settings: S;
  session: SessionStore;
  http: HttpClient;
  logger: Logger;
  /** Store currency used when a provider does not report one. */
  defaultCurrency: string;
}

export interface ProviderDefinition<C = Record<string, string>, S = Record<string, unknown>> {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  docs: ProviderDocs;
  capabilities: Capabilities;
  credentialsSchema: z.ZodType<C>;
  settingsSchema: z.ZodType<S>;
  /** Credential field names, for the connect form (values are never returned). */
  credentialFields: string[];
  defaultPollMinutes: number;
  /** Hosts the connector talks to (also used for rate-limit keys). */
  hosts: string[];
  create?(ctx: ConnectorContext<C, S>): Connector;
}
