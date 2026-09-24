import type { EkosistemProduct } from "./constants";

/**
 * Scopes (§3). A scope is defined by the product that gives the data; a link carries the
 * scopes each side granted to the other.
 */

export const SCOPES_BY_GRANTER = {
  altyapi: ["brand:read", "catalog:read", "costs:read", "orders:read", "content:read"],
  karmatik: ["products:read", "profit:read", "profit:summary", "profit:quote", "pricing:read", "pricing:decide", "competitors:read", "market:read"],
  yanit: ["visibility:read", "opportunities:read", "citations:read", "discovery:read"],
} as const satisfies Record<EkosistemProduct, readonly string[]>;

export type AltyapiScope = (typeof SCOPES_BY_GRANTER.altyapi)[number];
export type KarmatikScope = (typeof SCOPES_BY_GRANTER.karmatik)[number];
export type YanitScope = (typeof SCOPES_BY_GRANTER.yanit)[number];
export type EkosistemScope = AltyapiScope | KarmatikScope | YanitScope;

export const ALL_SCOPES: readonly EkosistemScope[] = [...SCOPES_BY_GRANTER.altyapi, ...SCOPES_BY_GRANTER.karmatik, ...SCOPES_BY_GRANTER.yanit];

/** Never granted implicitly: the user must tick each one in the approval step (§3). */
export const EXPLICIT_CONSENT_SCOPES: readonly EkosistemScope[] = ["costs:read", "orders:read", "profit:read"];

/**
 * Default grants per pair (§3), keyed `granter → receiver`: the most a granter may give.
 * Users may narrow these while approving a link; they cannot widen them. Explicit-consent
 * scopes in this list are granted only when ticked (see implicitGrants).
 */
export const DEFAULT_GRANTS: Record<EkosistemProduct, Partial<Record<EkosistemProduct, readonly EkosistemScope[]>>> = {
  altyapi: {
    karmatik: ["brand:read", "catalog:read", "costs:read", "orders:read"],
    yanit: ["brand:read", "catalog:read", "content:read"],
  },
  karmatik: {
    altyapi: ["profit:read", "profit:quote", "pricing:read", "pricing:decide", "competitors:read", "market:read"],
    yanit: ["products:read", "profit:summary", "competitors:read", "market:read"],
  },
  yanit: {
    altyapi: ["visibility:read", "opportunities:read", "citations:read", "discovery:read"],
    karmatik: ["visibility:read", "opportunities:read", "citations:read"],
  },
};

export function isScopeOf(granter: EkosistemProduct, scope: string): scope is EkosistemScope {
  return (SCOPES_BY_GRANTER[granter] as readonly string[]).includes(scope);
}

/** Scopes `granter` may give `receiver` on a link (the default set; narrowing only). */
export function allowedGrants(granter: EkosistemProduct, receiver: EkosistemProduct): readonly EkosistemScope[] {
  return DEFAULT_GRANTS[granter][receiver] ?? [];
}

export function defaultGrants(granter: EkosistemProduct, receiver: EkosistemProduct): EkosistemScope[] {
  return [...allowedGrants(granter, receiver)];
}

export function isExplicitConsentScope(scope: string): boolean {
  return (EXPLICIT_CONSENT_SCOPES as readonly string[]).includes(scope);
}

/**
 * What a user grants when they tick nothing (§3): the pair's defaults without the
 * explicit-consent scopes (costs:read, orders:read, profit:read), which are given only when
 * the request lists each of them.
 */
export function implicitGrants(granter: EkosistemProduct, receiver: EkosistemProduct): EkosistemScope[] {
  return allowedGrants(granter, receiver).filter((s) => !isExplicitConsentScope(s));
}

export type GrantValidation = { ok: true; grants: EkosistemScope[] } | { ok: false; invalid: string[] };

/**
 * Validates a grant list from `granter` to `receiver`: every scope must belong to the
 * granter and be allowed for the pair. The result is de-duplicated in canonical order.
 */
export function validateGrants(granter: EkosistemProduct, receiver: EkosistemProduct, grants: readonly string[]): GrantValidation {
  const allowed = allowedGrants(granter, receiver);
  const invalid = grants.filter((g) => !(allowed as readonly string[]).includes(g));
  if (invalid.length) return { ok: false, invalid: [...new Set(invalid)] };
  const set = new Set(grants);
  return { ok: true, grants: allowed.filter((s) => set.has(s)) };
}

/** True when `grants` contains at least one of `required`. */
export function hasAnyScope(grants: readonly string[], ...required: EkosistemScope[]): boolean {
  return required.some((r) => grants.includes(r));
}

// ---------------------------------------------------------------------------
// Push event types (§10)
// ---------------------------------------------------------------------------

export const PUSH_EVENT_TYPES = [
  "altyapi.order.updated",
  "altyapi.product.updated",
  "altyapi.product.deleted",
  "altyapi.brand.updated",
  "altyapi.content.updated",
  "karmatik.profit.updated",
  "karmatik.suggestion.created",
] as const;
export type PushEventType = (typeof PUSH_EVENT_TYPES)[number];

export function isPushEventType(value: string): value is PushEventType {
  return (PUSH_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Read scopes the receiver must hold for a push type to be sent (any one suffices);
 * null for types outside the contract (receivers ignore them).
 */
export function scopesForPushEvent(type: string): readonly EkosistemScope[] | null {
  const [, family] = type.split(".");
  if (type.startsWith("karmatik.profit.")) return ["profit:read", "profit:summary"];
  if (type.startsWith("karmatik.suggestion.")) return ["pricing:read"];
  if (!type.startsWith("altyapi.")) return null;
  switch (family) {
    case "order":
      return ["orders:read"];
    case "product":
      return ["catalog:read"];
    case "brand":
      return ["brand:read"];
    case "content":
      return ["content:read"];
    default:
      return null;
  }
}
