import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  HEADER_KEYS,
  HEADERS,
  MAX_REQUEST_BODY_BYTES,
  NONCE_MAX_LENGTH,
  NONCE_MIN_LENGTH,
  TIMESTAMP_SKEW_SECONDS,
  isEkosistemProduct,
  isSignedMethod,
  type EkosistemProduct,
  type SignedMethod,
} from "./constants";
import type { EkosistemErrorCode } from "./errors";

/**
 * Request signing (§5):
 *
 *   key       = ASCII bytes of the 43-character secret (never base64url-decoded)
 *   message   = timestamp \n senderProduct \n METHOD \n canonicalPathAndQuery \n hex(sha256(rawBody)) [\n nonce]
 *   signature = "v1=" + lowercase hex(HMAC-SHA256(key, message))
 *
 * The nonce line is present for every method except GET.
 */

const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const PREFIX_RE = /\/ekosistem\/v1(?=\/|$)/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_RE = /^[A-Za-z0-9_-]+$/;
const TIMESTAMP_RE = /^\d{10}$/;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type CanonicalizationFailure = "path_invalid" | "query_invalid" | "query_duplicate_key";

export class CanonicalizationError extends Error {
  override name = "CanonicalizationError";
  constructor(readonly reason: CanonicalizationFailure) {
    super(`ekosistem canonicalization failed: ${reason}`);
  }
}

/** A generated link secret: 32 random bytes as 43 base64url characters. */
export function isValidLinkSecret(secret: string): boolean {
  return SECRET_RE.test(secret);
}

export function generateLinkSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Request nonce: 128 random bits as base64url (22 characters). */
export function generateRequestNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function isValidNonce(nonce: string): boolean {
  return nonce.length >= NONCE_MIN_LENGTH && nonce.length <= NONCE_MAX_LENGTH && NONCE_RE.test(nonce);
}

/**
 * The signed part of a path: everything from `/ekosistem/v1` on, without a trailing slash,
 * each segment matching [A-Za-z0-9._~-]+. Product prefixes before it (/api/public, /api)
 * are dropped. Dot segments are rejected because HTTP clients normalise them away.
 */
export function canonicalPath(pathname: string): string {
  const idx = pathname.search(PREFIX_RE);
  if (idx < 0) throw new CanonicalizationError("path_invalid");
  const path = pathname.slice(idx);
  if (path.endsWith("/")) throw new CanonicalizationError("path_invalid");
  for (const segment of path.split("/").slice(1)) {
    if (!SEGMENT_RE.test(segment) || segment === "." || segment === "..") throw new CanonicalizationError("path_invalid");
  }
  return path;
}

/** RFC 3986 strict encoding: encodeURIComponent plus !'()* escaped, upper-case hex. */
export function strictEncode(value: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    // Lone surrogates cannot be encoded as UTF-8.
    throw new CanonicalizationError("query_invalid");
  }
  return encoded.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeComponent(value: string): string {
  try {
    // decodeURIComponent keeps "+" as a literal plus, as §5 requires.
    return decodeURIComponent(value);
  } catch {
    throw new CanonicalizationError("query_invalid");
  }
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function canonicalFromPairs(pairs: Array<[string, string]>): string {
  const seen = new Set<string>();
  for (const [key] of pairs) {
    if (key === "") throw new CanonicalizationError("query_invalid");
    if (seen.has(key)) throw new CanonicalizationError("query_duplicate_key");
    seen.add(key);
  }
  return [...pairs]
    .sort((a, b) => compareBytes(a[0], b[0]))
    .map(([k, v]) => `${strictEncode(k)}=${strictEncode(v)}`)
    .join("&");
}

/** Parses a raw query string into decoded pairs ("+" stays "+"); empty parts are ignored. */
export function parseRawQuery(rawQuery: string): Array<[string, string]> {
  const query = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  if (query === "") return [];
  const pairs: Array<[string, string]> = [];
  for (const part of query.split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : part.slice(eq + 1);
    pairs.push([decodeComponent(key), decodeComponent(value)]);
  }
  return pairs;
}

/**
 * Canonical query (§5): decode keys and values, reject repeated keys, sort by key bytes,
 * re-encode strictly and join `k=v` with `&`. Returns "" for an empty query.
 */
export function canonicalQuery(rawQuery: string): string {
  return canonicalFromPairs(parseRawQuery(rawQuery));
}

/** Canonical query built from decoded parameters (used by the sender). */
export function canonicalQueryFromParams(params: Record<string, string | number | boolean | null | undefined>): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    pairs.push([k, String(v)]);
  }
  return canonicalFromPairs(pairs);
}

/** Canonical `path[?query]` from a request target such as `/api/ekosistem/v1/x?b=2&a=1`. */
export function canonicalTarget(target: string): string {
  const q = target.indexOf("?");
  const path = canonicalPath(q < 0 ? target : target.slice(0, q));
  const query = q < 0 ? "" : canonicalQuery(target.slice(q + 1));
  return query ? `${path}?${query}` : path;
}

export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(typeof body === "string" ? Buffer.from(body, "utf8") : body).digest("hex");
}

export interface SigningMessageInput {
  timestamp: string;
  product: EkosistemProduct;
  method: SignedMethod;
  /** Canonical path and query, e.g. `/ekosistem/v1/catalog/products?limit=2`. */
  canonical: string;
  bodySha256: string;
  /** Required for every method except GET; ignored for GET. */
  nonce: string | null;
}

export function signingMessage(input: SigningMessageInput): string {
  const lines = [input.timestamp, input.product, input.method, input.canonical, input.bodySha256];
  if (input.method !== "GET") {
    if (!input.nonce) throw new Error("ekosistem: a nonce is required for non-GET requests");
    lines.push(input.nonce);
  }
  return lines.join("\n");
}

function keyBytes(secret: string): Buffer {
  if (!isValidLinkSecret(secret)) throw new Error("ekosistem: link secret must be 43 base64url characters");
  return Buffer.from(secret, "ascii");
}

/** Lowercase hex HMAC-SHA256 over the message with the secret's ASCII bytes as key. */
export function computeSignatureHex(secret: string, message: string): string {
  return createHmac("sha256", keyBytes(secret)).update(message, "utf8").digest("hex");
}

export function formatSignatureHeader(hex: string): string {
  return `v1=${hex}`;
}

/** Returns the 64-character hex digest of a `v1=` header, or null when malformed. */
export function parseSignatureHeader(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = SIGNATURE_RE.exec(value);
  return m ? m[1]! : null;
}

/** Constant-time comparison of two lowercase hex digests. */
export function signaturesEqual(expectedHex: string, receivedHex: string): boolean {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(receivedHex, "utf8");
  if (a.length !== b.length) {
    // Compare against itself so the call costs the same; the result is still false.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Index of the candidate secret (current first, then the previous one during rotation) that
 * produced the signature, or -1 when none did.
 */
export function matchSignatureSecret(secrets: readonly string[], message: string, receivedHex: string): number {
  let match = -1;
  secrets.forEach((secret, index) => {
    if (!isValidLinkSecret(secret)) return;
    // No early exit: each candidate costs the same regardless of which one matches.
    if (signaturesEqual(computeSignatureHex(secret, message), receivedHex) && match < 0) match = index;
  });
  return match;
}

/** Checks a signature against every candidate secret (current and, during rotation, previous). */
export function verifySignatureHex(secrets: readonly string[], message: string, receivedHex: string): boolean {
  return matchSignatureSecret(secrets, message, receivedHex) >= 0;
}

export function unixSeconds(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatTimestamp(seconds: number): string {
  const s = String(Math.floor(seconds));
  if (!TIMESTAMP_RE.test(s)) throw new Error("ekosistem: timestamp must be a 10-digit unix time");
  return s;
}

/** Validates the 10-digit header and the ±300 s window. */
export function checkTimestamp(header: string | undefined | null, nowSeconds: number): "ok" | "malformed" | "skew" {
  if (!header || !TIMESTAMP_RE.test(header)) return "malformed";
  return Math.abs(nowSeconds - Number(header)) > TIMESTAMP_SKEW_SECONDS ? "skew" : "ok";
}

export interface SignRequestInput {
  secret: string;
  linkId: string;
  product: EkosistemProduct;
  method: SignedMethod;
  /** Canonical path and query (see canonicalTarget / canonicalQueryFromParams). */
  canonical: string;
  body: Uint8Array;
  timestamp?: number;
  nonce?: string;
}

export interface SignedHeaders {
  headers: Record<string, string>;
  timestamp: string;
  nonce: string | null;
}

/** Produces the five Ekosistem-* headers for an outbound request. */
export function signRequest(input: SignRequestInput): SignedHeaders {
  const timestamp = formatTimestamp(input.timestamp ?? unixSeconds());
  const nonce = input.method === "GET" ? null : (input.nonce ?? generateRequestNonce());
  if (nonce !== null && !isValidNonce(nonce)) throw new Error("ekosistem: nonce must be at least 128 bits of base64url");
  const message = signingMessage({ timestamp, product: input.product, method: input.method, canonical: input.canonical, bodySha256: sha256Hex(input.body), nonce });
  const headers: Record<string, string> = {
    [HEADERS.link]: input.linkId,
    [HEADERS.product]: input.product,
    [HEADERS.timestamp]: timestamp,
    [HEADERS.signature]: formatSignatureHeader(computeSignatureHex(input.secret, message)),
  };
  if (nonce !== null) headers[HEADERS.nonce] = nonce;
  return { headers, timestamp, nonce };
}

// ---------------------------------------------------------------------------
// Inbound verification
// ---------------------------------------------------------------------------

export type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, key: string): string | undefined {
  const v = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined;
  return v;
}

export interface InboundRequest {
  method: string;
  /** Request target exactly as received: raw path plus optional `?query`. */
  target: string;
  headers: HeaderBag;
  rawBody: Uint8Array;
  nowSeconds: number;
}

/** A request that passed every check that does not need the link record. */
export interface PrecheckedRequest {
  linkId: string;
  product: EkosistemProduct;
  method: SignedMethod;
  canonical: string;
  timestamp: string;
  nonce: string | null;
  signatureHex: string;
  message: string;
}

export type VerificationFailure = { ok: false; code: EkosistemErrorCode; detail: string };
export type PrecheckResult = ({ ok: true } & PrecheckedRequest) | VerificationFailure;

const fail = (code: EkosistemErrorCode, detail: string): VerificationFailure => ({ ok: false, code, detail });

/**
 * Stateless part of §5 verification, in contract order: method allowlist, transport shape
 * (bodyless GET/DELETE, no Content-Encoding, JSON up to 64 KB), canonical target, headers
 * and the ±300 s timestamp window. The caller then loads the link (link_invalid /
 * link_pending), calls verifyAgainstLink, records the nonce (replay) and checks scopes.
 */
export function precheckSignedRequest(req: InboundRequest): PrecheckResult {
  const method = req.method;
  if (!isSignedMethod(method)) return fail("method_not_allowed", `method ${method} is not allowed`);

  const body = req.rawBody;
  if (header(req.headers, "content-encoding")) return fail("bad_request", "Content-Encoding is not accepted");
  if (method === "GET" || method === "DELETE") {
    if (body.byteLength > 0) return fail("bad_request", `${method} requests must not carry a body`);
  } else {
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) return fail("payload_too_large", "body exceeds 64 KB");
    const contentType = header(req.headers, "content-type") ?? "";
    if (contentType.split(";")[0]!.trim().toLowerCase() !== "application/json") return fail("bad_request", "Content-Type must be application/json");
  }

  let canonical: string;
  try {
    canonical = canonicalTarget(req.target);
  } catch (err) {
    return fail("bad_request", err instanceof CanonicalizationError ? err.reason : "canonicalization failed");
  }

  const ts = checkTimestamp(header(req.headers, HEADER_KEYS.timestamp), req.nowSeconds);
  if (ts === "skew") return fail("timestamp_skew", "timestamp outside ±300 s");
  if (ts === "malformed") return fail("signature_invalid", "timestamp header must be a 10-digit unix time");

  const linkId = header(req.headers, HEADER_KEYS.link);
  if (!linkId || !UUID_RE.test(linkId)) return fail("link_invalid", "missing or malformed link header");

  const product = header(req.headers, HEADER_KEYS.product);
  if (!isEkosistemProduct(product)) return fail("signature_invalid", "unknown sender product");

  const signatureHex = parseSignatureHeader(header(req.headers, HEADER_KEYS.signature));
  if (!signatureHex) return fail("signature_invalid", "missing or malformed signature header");

  let nonce: string | null = null;
  if (method !== "GET") {
    nonce = header(req.headers, HEADER_KEYS.nonce) ?? null;
    if (!nonce || !isValidNonce(nonce)) return fail("signature_invalid", "non-GET requests need a nonce of at least 128 bits");
  }

  const timestamp = header(req.headers, HEADER_KEYS.timestamp)!;
  const message = signingMessage({ timestamp, product, method, canonical, bodySha256: sha256Hex(body), nonce });
  return { ok: true, linkId: linkId.toLowerCase(), product, method, canonical, timestamp, nonce, signatureHex, message };
}

/**
 * Link-dependent part: the sender product must be the link's peer and the signature must
 * match one of the link's accepted secrets. Both failures are signature_invalid (§5).
 */
export function verifyAgainstLink(
  req: PrecheckedRequest,
  link: { peerProduct: EkosistemProduct; secrets: readonly string[] },
): { ok: true; secretIndex: number } | VerificationFailure {
  const secretIndex = matchSignatureSecret(link.secrets, req.message, req.signatureHex);
  if (req.product !== link.peerProduct) return fail("signature_invalid", "sender product is not this link's peer");
  if (secretIndex < 0) return fail("signature_invalid", "signature mismatch");
  // secretIndex 0 is the current secret; callers that need the current key (rotate, §4.4) check it.
  return { ok: true, secretIndex };
}

/** Composite key for replay detection of (linkId, nonce) pairs. */
export function replayKey(linkId: string, nonce: string): string {
  return `ekosistem:nonce:${linkId}:${sha256Hex(nonce).slice(0, 32)}`;
}

