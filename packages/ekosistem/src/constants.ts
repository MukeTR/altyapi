/**
 * Ekosistem v1 contract constants (docs/ekosistem/v1.md). Values that the contract fixes
 * live here so the API, the worker and the peer client cannot drift apart.
 */

export const EKOSISTEM_PRODUCTS = ["altyapi", "karmatik", "yanit"] as const;
export type EkosistemProduct = (typeof EKOSISTEM_PRODUCTS)[number];

/** This application. */
export const SELF_PRODUCT = "altyapi" satisfies EkosistemProduct;

/** Products altyapi links with. */
export const PEER_PRODUCTS = ["karmatik", "yanit"] as const;
export type PeerProduct = (typeof PEER_PRODUCTS)[number];

export function isEkosistemProduct(value: unknown): value is EkosistemProduct {
  return typeof value === "string" && (EKOSISTEM_PRODUCTS as readonly string[]).includes(value);
}

export function isPeerProduct(value: unknown): value is PeerProduct {
  return typeof value === "string" && (PEER_PRODUCTS as readonly string[]).includes(value);
}

/** Every signed path starts with this; product-specific prefixes (/api/public, /api) are not signed. */
export const EKOSISTEM_V1_PREFIX = "/ekosistem/v1";

/** Header names as sent on the wire. */
export const HEADERS = {
  link: "Ekosistem-Link",
  product: "Ekosistem-Product",
  timestamp: "Ekosistem-Timestamp",
  nonce: "Ekosistem-Nonce",
  signature: "Ekosistem-Signature",
} as const;

/** Lower-case header names as exposed by Node's IncomingMessage. */
export const HEADER_KEYS = {
  link: "ekosistem-link",
  product: "ekosistem-product",
  timestamp: "ekosistem-timestamp",
  nonce: "ekosistem-nonce",
  signature: "ekosistem-signature",
} as const;

export const SIGNED_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export type SignedMethod = (typeof SIGNED_METHODS)[number];

export function isSignedMethod(value: string): value is SignedMethod {
  return (SIGNED_METHODS as readonly string[]).includes(value);
}

/** Allowed clock difference between signer and verifier (§5). */
export const TIMESTAMP_SKEW_SECONDS = 300;
/** A (linkId, nonce) pair seen within this window is a replay (§5). */
export const NONCE_TTL_SECONDS = 600;
/** Minimum nonce entropy: 128 bits = 16 bytes = 22 base64url characters. */
export const NONCE_MIN_LENGTH = 22;
export const NONCE_MAX_LENGTH = 128;

/** Link codes are valid for 10 minutes and single use (§4.2). */
export const CODE_TTL_SECONDS = 600;
/** pending / awaiting_approval links are removed after 10 minutes (§4.3). */
export const PENDING_LINK_TTL_SECONDS = 600;
/** Same code + same claimNonce within this window receives the same claim response (§4.3). */
export const CLAIM_REPLAY_WINDOW_SECONDS = 600;
/** Both sides accept the old and the new secret for 24 hours after rotation (§4.4). */
export const PREVIOUS_SECRET_GRACE_SECONDS = 24 * 3600;
/** Revocation is re-delivered to the peer with exponential backoff for 72 hours (§4.4). */
export const REVOKE_DELIVERY_WINDOW_SECONDS = 72 * 3600;
/** Three link_invalid answers at least 10 minutes apart mark a link revoked_by_peer (§4.4). */
export const LINK_INVALID_REVOKE_THRESHOLD = 3;
export const LINK_INVALID_MIN_INTERVAL_SECONDS = 600;

/** Request body limit for signed POST/PATCH (§5). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
/** Response body limit for outbound peer calls (§2). */
export const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;
/** Outbound peer call timeouts (§1, §2). */
export const PEER_TIMEOUT_MS = 10_000;
export const PROFIT_QUOTE_TIMEOUT_MS = 1_500;
export const PROFIT_QUOTE_PATH = "/ekosistem/v1/profit/quote";

/** Circuit breaker: 5 consecutive failures open it for 60 seconds (§1). */
export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_OPEN_MS = 60_000;

/** Incremental endpoints (§6.3). */
export const INCREMENTAL_DEFAULT_LIMIT = 100;
export const INCREMENTAL_MAX_LIMIT = 200;
/** Consumers use asOf minus this overlap as the next `since`. */
export const SINCE_OVERLAP_MS = 10 * 60_000;
/** Snapshot endpoints return at most this many items. */
export const SNAPSHOT_MAX_ITEMS = 100;
/** Consumers pull a peer at most once an hour (§6.4, §7.5). */
export const PULL_MIN_INTERVAL_MS = 3600_000;
/** `refs=a,b` lookups accept at most this many refs (§7.2). */
export const MAX_REFS_PER_LOOKUP = 50;

/** Tombstones are kept at least this long (§6.3). */
export const TOMBSTONE_RETENTION_DAYS = { product: 30, content: 30, order: 90 } as const;

/** Push delivery (§10). */
export const PUSH_MAX_ATTEMPTS = 5;
export const PUSH_MAX_BACKOFF_MS = 3600_000;
/** Receivers coalesce pulls for the same (type, ref) for at least this long. */
export const PUSH_COALESCE_MS = 30_000;
export const PUSH_RATE_PER_MINUTE = 120;

/** Signed rate limits per link (§6.4) and the coarse per-IP limit applied before verification. */
export const SIGNED_READ_RATE_PER_MINUTE = 60;
export const PROFIT_QUOTE_RATE_PER_MINUTE = 600;
export const UNSIGNED_IP_RATE_PER_MINUTE = 300;
export const CLAIM_IP_RATE_PER_MINUTE = 10;

/** Account label shown to the other side: plain text, at most 80 characters (§4.3). */
export const ACCOUNT_LABEL_MAX_LENGTH = 80;
