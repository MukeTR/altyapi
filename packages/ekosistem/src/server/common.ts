import type { Redis } from "ioredis";
import { AppError } from "@altyapi/commerce-core";
import { and, asc, desc, eq, siteProfiles, storeDomains, stores, type DbExecutor, type Database, type EkosistemPeerAccount, type ekosistemLinks } from "@altyapi/database";
import type { Queue } from "@altyapi/events";
import type { Logger } from "@altyapi/observability";
import { decryptJson, encryptJson, type EnvelopeRecord, type KeyProvider } from "@altyapi/secrets";
import { ACCOUNT_LABEL_MAX_LENGTH } from "../constants";
import { EkosistemError } from "../errors";
import type { PeerClient, PeerLinkCredentials } from "../peer-client";
import { cleanPlainText } from "../schemas";

/** Dependencies of the server-side ekosistem services (API and worker). */
export interface EkosistemServerDeps {
  db: Database;
  keys: KeyProvider | null;
  redis: Redis | null;
  peers: PeerClient;
  logger: Logger;
  queue: Queue | null;
  /** Default store hostnames are {slug}.{storeRootDomain}. */
  storeRootDomain: string;
  /** Public base of the storefront-public bucket; null when media URLs cannot be built. */
  mediaBaseUrl: string | null;
}

export type LinkRow = typeof ekosistemLinks.$inferSelect;

// ---------------------------------------------------------------------------
// Link secrets (§4.1): envelope-encrypted, bound to the store and the link id.
// ---------------------------------------------------------------------------

export const linkSecretContext = (storeId: string, linkId: string) => ({ storeId, purpose: `ekosistem-link:${linkId}` });

/** Admin-facing: secrets cannot be handled without a key provider. */
export function requireKeysForAdmin(keys: KeyProvider | null): KeyProvider {
  if (!keys) throw new AppError("dependency_unavailable", "errors.secrets.not_configured");
  return keys;
}

/** Peer-facing: a missing key provider is a temporary server problem. */
export function requireKeysForPeer(keys: KeyProvider | null): KeyProvider {
  if (!keys) throw new EkosistemError("unavailable");
  return keys;
}

export async function encryptLinkSecret(keys: KeyProvider, storeId: string, linkId: string, linkSecret: string): Promise<EnvelopeRecord> {
  return encryptJson(keys, { s: linkSecret }, linkSecretContext(storeId, linkId));
}

/**
 * Decrypted secrets are kept in process memory for a few minutes so a verified request does
 * not cost a KMS round trip each time. Entries are keyed by the envelope itself (its IV is
 * unique per encryption), so a rotated secret never hits a stale entry.
 */
const SECRET_CACHE_TTL_MS = 5 * 60_000;
const SECRET_CACHE_MAX = 2_000;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

export async function decryptLinkSecret(keys: KeyProvider, storeId: string, linkId: string, envelope: EnvelopeRecord): Promise<string> {
  const cacheKey = `${storeId}:${linkId}:${envelope.iv}:${envelope.authTag}`;
  const now = Date.now();
  const hit = secretCache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = (await decryptJson<{ s: string }>(keys, envelope, linkSecretContext(storeId, linkId))).s;
  if (secretCache.size >= SECRET_CACHE_MAX) {
    for (const [k, v] of secretCache) if (v.expiresAt <= now || secretCache.size >= SECRET_CACHE_MAX) secretCache.delete(k);
  }
  secretCache.set(cacheKey, { value, expiresAt: now + SECRET_CACHE_TTL_MS });
  return value;
}

/** Secrets that verify inbound requests: the current one and, during rotation, the previous one (24 h). */
export async function acceptedSecrets(keys: KeyProvider, link: LinkRow, now: Date): Promise<string[]> {
  const out = [await decryptLinkSecret(keys, link.storeId, link.id, link.secret)];
  if (link.previousSecret && link.previousSecretValidUntil && link.previousSecretValidUntil > now) {
    out.push(await decryptLinkSecret(keys, link.storeId, link.id, link.previousSecret));
  }
  return out;
}

/** Credentials for outbound calls: always the current secret. */
export async function linkCredentials(keys: KeyProvider, link: LinkRow): Promise<PeerLinkCredentials> {
  return { linkId: link.id, secret: await decryptLinkSecret(keys, link.storeId, link.id, link.secret) };
}

// ---------------------------------------------------------------------------
// Store identity and addresses
// ---------------------------------------------------------------------------

export interface StoreIdentity {
  storeId: string;
  organizationId: string;
  slug: string;
  name: string;
  status: string;
  defaultLocale: string;
  supportedLocales: string[];
  defaultCurrency: string;
  countryCode: string;
  /** Host the storefront uses for canonical URLs: the canonical active domain or the default subdomain. */
  canonicalHost: string;
  /** Canonical active domain (custom or platform subdomain) the store verifiably serves; null when none. */
  verifiedDomain: string | null;
  /** Active hostnames serving the store, canonical first. */
  domains: string[];
  /** How the storefront serves pages: /pages/{handle} (prefixed) or /{handle} (root). */
  pageUrlStyle: "prefixed" | "root";
}

/** Loads the store and its domains; the canonical host follows the storefront (canonical active domain, else default subdomain). */
export async function loadStoreIdentity(tx: DbExecutor, storeId: string, storeRootDomain: string): Promise<StoreIdentity | null> {
  const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
  if (!store) return null;
  const domains = await tx
    .select({ hostname: storeDomains.hostname, kind: storeDomains.kind, isCanonical: storeDomains.isCanonical, redirectTo: storeDomains.redirectToHostname })
    .from(storeDomains)
    .where(and(eq(storeDomains.storeId, storeId), eq(storeDomains.status, "active")))
    .orderBy(desc(storeDomains.isCanonical), asc(storeDomains.createdAt));
  const canonical = domains.find((d) => d.isCanonical) ?? null;
  const platform = domains.find((d) => d.kind === "platform_subdomain") ?? null;
  const canonicalHost = canonical?.hostname ?? platform?.hostname ?? `${store.slug}.${storeRootDomain}`;
  const [profile] = await tx.select({ pageUrlStyle: siteProfiles.pageUrlStyle }).from(siteProfiles).where(eq(siteProfiles.storeId, storeId));
  return {
    storeId: store.id,
    organizationId: store.organizationId,
    slug: store.slug,
    name: store.name,
    status: store.status,
    defaultLocale: store.defaultLocale,
    supportedLocales: store.supportedLocales,
    defaultCurrency: store.defaultCurrency,
    countryCode: store.countryCode,
    canonicalHost,
    verifiedDomain: canonical?.hostname ?? null,
    // Hostnames that only redirect elsewhere are aliases, not domains of the store's site.
    domains: domains.filter((d) => !d.redirectTo).map((d) => d.hostname),
    pageUrlStyle: profile?.pageUrlStyle ?? "prefixed",
  };
}

/** The account altyapi presents for a store on a link (§4.3): opaque id, plain-text label, verified domain. */
export function ownAccount(identity: StoreIdentity): EkosistemPeerAccount {
  const label = cleanPlainText(identity.name).slice(0, ACCOUNT_LABEL_MAX_LENGTH) || identity.slug;
  return { id: identity.storeId, label, verifiedDomain: identity.verifiedDomain, ownerEmailMasked: null };
}

/** Storefront path for a locale: "/en/…" for non-default locales (same as the storefront). */
export function localizedStorePath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

export function storeUrl(host: string, path: string): string {
  return `https://${host}${path}`;
}
