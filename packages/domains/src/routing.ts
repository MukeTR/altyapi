import { and, eq, storeDomains, stores, withPlatformTx, type Database } from "@altyapi/database";
import type { CloudflareClient } from "./cloudflare";
import { normalizeHostname } from "./hostname";

/** What the edge router needs to route a hostname. Contains no secrets. */
export interface RouteResolution {
  hostname: string;
  organizationId: string;
  storeId: string;
  storeSlug: string;
  storeStatus: string;
  defaultLocale: string;
  routingVersion: number;
  /** Storefront content version; part of the edge HTML cache key (versioned invalidation). */
  contentVersion: number;
  canonicalHostname: string;
  action: "render" | "redirect";
  redirectTo: string | null;
}

/**
 * Resolves a Host header against PostgreSQL (source of truth). Only active hostnames
 * resolve; non-canonical hostnames resolve to a redirect to the canonical host.
 */
export async function resolveHostname(db: Database, rawHost: string): Promise<RouteResolution | null> {
  const norm = normalizeHostname(rawHost);
  if (!norm.ok) return null;
  return withPlatformTx(db, async (tx) => {
    const rows = await tx
      .select({ domain: storeDomains, store: stores })
      .from(storeDomains)
      .innerJoin(stores, eq(stores.id, storeDomains.storeId))
      .where(and(eq(storeDomains.hostname, norm.hostname), eq(storeDomains.status, "active")))
      .limit(1);
    const row = rows[0];
    if (!row || row.store.status === "closed") return null;
    const canonical = await tx.query.storeDomains.findFirst({
      where: and(eq(storeDomains.storeId, row.store.id), eq(storeDomains.isCanonical, true), eq(storeDomains.status, "active")),
    });
    const canonicalHostname = canonical?.hostname ?? row.domain.hostname;
    const isCanonical = canonicalHostname === row.domain.hostname;
    return {
      hostname: row.domain.hostname,
      organizationId: row.store.organizationId,
      storeId: row.store.id,
      storeSlug: row.store.slug,
      storeStatus: row.store.status,
      defaultLocale: row.store.defaultLocale,
      routingVersion: row.store.routingVersion,
      contentVersion: row.store.contentVersion,
      canonicalHostname,
      action: isCanonical ? "render" : "redirect",
      redirectTo: isCanonical ? null : canonicalHostname,
    };
  });
}

export const routingKvKey = (hostname: string) => `host:${hostname}`;

/**
 * Pushes the current routing projection for the given hostnames to the edge KV speed
 * layer. Entries carry routingVersion so the edge can discard stale copies; hostnames
 * that no longer resolve (removed, inactive, store closed) are deleted from KV.
 */
export async function publishRouting(db: Database, cf: CloudflareClient, hostnames: string[]): Promise<void> {
  for (const hostname of new Set(hostnames)) {
    const resolution = await resolveHostname(db, hostname);
    if (resolution) await cf.putRoutingEntry(routingKvKey(hostname), JSON.stringify(resolution));
    else await cf.deleteRoutingEntry(routingKvKey(hostname));
  }
}

/** Hostnames of a store that currently route (for re-publishing after content changes). */
export async function storeHostnames(db: Database, storeId: string): Promise<string[]> {
  const rows = await withPlatformTx(db, (tx) =>
    tx.select({ hostname: storeDomains.hostname }).from(storeDomains).where(and(eq(storeDomains.storeId, storeId), eq(storeDomains.status, "active"))),
  );
  return rows.map((r) => r.hostname);
}
