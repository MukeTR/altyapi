import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CLAIM_IP_RATE_PER_MINUTE,
  EKOSISTEM_ERROR_STATUS,
  EkosistemError,
  NONCE_TTL_SECONDS,
  PUSH_RATE_PER_MINUTE,
  SIGNED_READ_RATE_PER_MINUTE,
  UNSIGNED_IP_RATE_PER_MINUTE,
  acceptedSecrets,
  ekosistemErrorEnvelope,
  isLive,
  loadLinkById,
  parseRawQuery,
  precheckSignedRequest,
  replayKey,
  requireKeysForPeer,
  sha256Hex,
  storeIsOpen,
  unixSeconds,
  verifyAgainstLink,
  type EkosistemErrorCode,
  type EkosistemScope,
  type LinkRow,
  type VerificationFailure,
} from "@altyapi/ekosistem";
import { enrichContext } from "@altyapi/observability";
import type { AppDeps } from "../deps";

/**
 * Machine-to-machine request verification for /ekosistem/v1 (docs/ekosistem/v1.md §5, §6.4).
 *
 * Order of checks: coarse per-IP limit (counts failed verifications only, so verified peer
 * traffic is limited per link, never per IP) → transport shape and ±300 s timestamp →
 * link lookup (401 link_invalid) → constant-time signature check against the current and,
 * during rotation, the previous secret (401 signature_invalid; rotate only with the current
 * one, except a same-nonce retry) → (linkId, nonce) replay
 * via Redis SET NX EX 600 (401 replay) → link state (409 link_pending on data endpoints) →
 * per-link rate limit (429) → scope (403 scope_missing, by the handler).
 * Signatures, secrets and codes are never logged.
 */

export type SignedEndpointKind = "link" | "data" | "events";

export interface SignedRouteOptions {
  kind: SignedEndpointKind;
  /**
   * POST /links/{linkId}/rotate: must be signed with the current secret (§4.4). The previous
   * secret is accepted only for a retry of the rotation it was replaced by (same nonce), and
   * such a retry must return the same secret, so it bypasses the replay check.
   */
  rotate?: boolean;
}

export interface VerifiedRequest {
  link: LinkRow;
  nonce: string | null;
  rawBody: Buffer;
  /** Decoded query pairs ("+" is a literal plus, as signed). */
  query: Array<[string, string]>;
  /** The request was signed with the previous secret (still valid for 24 h after a rotation). */
  signedWithPrevious: boolean;
}

/** Per-link budgets per minute (§6.4: reads at least 60/min; §10: pushes 120/min). */
const LINK_RATE: Record<SignedEndpointKind, number> = {
  data: SIGNED_READ_RATE_PER_MINUTE * 2,
  events: PUSH_RATE_PER_MINUTE,
  link: SIGNED_READ_RATE_PER_MINUTE,
};

const WINDOW_SECONDS = 60;

/** Client address this many trusted proxy hops from the socket (§6.4: proxy count set explicitly). */
export function clientIp(req: FastifyRequest, trustedHops: number): string {
  const chain = req.ips && req.ips.length ? req.ips : [req.socket.remoteAddress ?? req.ip];
  return chain[Math.min(trustedHops, chain.length - 1)] ?? req.ip;
}

function windowKey(name: string): { key: string; retryAfter: number } {
  const now = Math.floor(Date.now() / 1000);
  const slot = Math.floor(now / WINDOW_SECONDS);
  return { key: `ekosistem:rl:${name}:${slot}`, retryAfter: WINDOW_SECONDS - (now % WINDOW_SECONDS) };
}

/** Fixed-window counter; Redis problems fail open for limits (never for replay protection). */
export async function hitLimit(deps: AppDeps, name: string, limit: number): Promise<void> {
  const { key, retryAfter } = windowKey(name);
  let count = 0;
  try {
    const res = await deps.redis.multi().incr(key).expire(key, WINDOW_SECONDS + 5).exec();
    count = Number(res?.[0]?.[1] ?? 0);
  } catch (err) {
    deps.logger.warn({ err }, "ekosistem rate limiter unavailable");
    return;
  }
  if (count > limit) throw new EkosistemError("rate_limited", undefined, retryAfter);
}

async function overLimit(deps: AppDeps, name: string, limit: number): Promise<number | null> {
  const { key, retryAfter } = windowKey(name);
  try {
    const current = Number((await deps.redis.get(key)) ?? 0);
    return current >= limit ? retryAfter : null;
  } catch {
    return null;
  }
}

async function countFailure(deps: AppDeps, name: string): Promise<void> {
  const { key } = windowKey(name);
  try {
    await deps.redis.multi().incr(key).expire(key, WINDOW_SECONDS + 5).exec();
  } catch {
    // Advisory.
  }
}

export function sendEkosistemError(req: FastifyRequest, reply: FastifyReply, code: EkosistemErrorCode, message?: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) reply.header("retry-after", String(retryAfterSeconds));
  if (code === "method_not_allowed") reply.header("allow", "GET, POST, PATCH, DELETE");
  return reply.status(EKOSISTEM_ERROR_STATUS[code]).type("application/json; charset=utf-8").send(ekosistemErrorEnvelope(code, req.id, message));
}

export function requireScope(link: LinkRow, scope: EkosistemScope): void {
  if (!link.grantedScopes.includes(scope)) throw new EkosistemError("scope_missing", `Bu uç için "${scope}" kapsamı gerekir.`);
}

export function hasScope(link: LinkRow, scope: EkosistemScope): boolean {
  return link.grantedScopes.includes(scope);
}

/** Request target exactly as received (raw path and query), used for the canonical form. */
export function rawTarget(req: FastifyRequest): string {
  return req.raw.url ?? req.url;
}

export function rawQueryPairs(req: FastifyRequest): Array<[string, string]> {
  const target = rawTarget(req);
  const q = target.indexOf("?");
  return q < 0 ? [] : parseRawQuery(target.slice(q + 1));
}

/** A GET must not carry a body; Fastify never reads it, so the framing headers decide. */
function getHasBody(req: FastifyRequest): boolean {
  const length = req.headers["content-length"];
  return (length !== undefined && length !== "0") || req.headers["transfer-encoding"] !== undefined;
}

/** Turkish messages for the 400 cases §5 names without a code. */
const BAD_REQUEST_MESSAGES: Array<[RegExp, string]> = [
  [/Content-Encoding/, "Content-Encoding kabul edilmez."],
  [/Content-Type/, "Content-Type application/json olmalıdır."],
  [/must not carry a body/, "GET ve DELETE istekleri gövde taşıyamaz."],
  [/query_duplicate_key/, "Sorgu dizesinde tekrarlanan anahtar var."],
  [/query_invalid/, "Sorgu dizesi geçersiz."],
  [/path_invalid/, "Yol kanonik biçimde değil (sonda / olamaz, her kesim [A-Za-z0-9._~-])."],
];

function failure(f: VerificationFailure): EkosistemError {
  if (f.code !== "bad_request") return new EkosistemError(f.code);
  const message = BAD_REQUEST_MESSAGES.find(([re]) => re.test(f.detail))?.[1];
  return new EkosistemError("bad_request", message);
}

/** JSON body of a verified request; invalid UTF-8 or JSON is a 400. */
export function parseJsonBody(raw: Buffer): unknown {
  if (raw.byteLength === 0) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new EkosistemError("bad_request", "Gövde geçerli UTF-8 değil.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EkosistemError("bad_request", "Gövde geçerli JSON değil.");
  }
}

export function createVerifier(deps: AppDeps) {
  const sdeps = deps.ekosistem;
  const hops = deps.env.EKOSISTEM_TRUSTED_PROXY_HOPS;

  /** Coarse limit for the unsigned claim endpoint: 10 requests per IP per minute. */
  async function limitClaim(req: FastifyRequest): Promise<void> {
    await hitLimit(deps, `claim:${clientIp(req, hops)}`, CLAIM_IP_RATE_PER_MINUTE);
  }

  async function verify(req: FastifyRequest, opts: SignedRouteOptions): Promise<VerifiedRequest> {
    const ip = clientIp(req, hops);
    const ipBucket = `ip:${ip}`;
    const blockedFor = await overLimit(deps, ipBucket, UNSIGNED_IP_RATE_PER_MINUTE);
    if (blockedFor !== null) throw new EkosistemError("rate_limited", undefined, blockedFor);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const reject = async (err: EkosistemError, detail: string, linkId?: string): Promise<never> => {
      await countFailure(deps, ipBucket);
      req.log.warn({ code: err.code, detail, linkId, method: req.method, path: req.routeOptions.url }, "ekosistem request rejected");
      throw err;
    };

    if (req.method === "GET" && getHasBody(req)) return reject(new EkosistemError("bad_request", "GET istekleri gövde taşıyamaz."), "get_with_body");
    const pre = precheckSignedRequest({ method: req.method, target: rawTarget(req), headers: req.headers, rawBody, nowSeconds: unixSeconds() });
    if (!pre.ok) return reject(failure(pre), pre.detail);

    const now = new Date();
    const link = await loadLinkById(sdeps, pre.linkId);
    if (!link || !isLive(link, now) || !(await storeIsOpen(sdeps, link))) return reject(new EkosistemError("link_invalid"), "unknown_or_inactive_link", pre.linkId);

    const secrets = await acceptedSecrets(requireKeysForPeer(sdeps.keys), link, now);
    const checked = verifyAgainstLink(pre, { peerProduct: link.peerProduct, secrets });
    if (!checked.ok) return reject(failure(checked), checked.detail, link.id);
    // acceptedSecrets lists the current secret first.
    const signedWithPrevious = checked.secretIndex > 0;
    const repeatRotate = opts.rotate === true && pre.nonce !== null && link.rotateNonceHash !== null && link.rotateNonceHash === sha256Hex(pre.nonce);
    // A new rotation needs the current key: a leaked previous key must not be able to rotate again.
    if (opts.rotate === true && signedWithPrevious && !repeatRotate) {
      return reject(new EkosistemError("signature_invalid", "Anahtar yenileme mevcut anahtarla imzalanmalıdır."), "rotate_with_previous_secret", link.id);
    }

    if (pre.nonce) {
      if (!repeatRotate) {
        let stored: string | null;
        try {
          stored = await deps.redis.set(replayKey(link.id, pre.nonce), "1", "EX", NONCE_TTL_SECONDS, "NX");
        } catch (err) {
          // Without replay protection a signed request must not be accepted.
          req.log.error({ err }, "ekosistem nonce store unavailable");
          throw new EkosistemError("unavailable");
        }
        if (stored !== "OK") return reject(new EkosistemError("replay"), "nonce_reused", link.id);
      }
    }

    if (opts.kind !== "link" && link.status !== "active") throw new EkosistemError("link_pending");
    await hitLimit(deps, `link:${link.id}:${opts.kind}`, LINK_RATE[opts.kind]);
    enrichContext({ organizationId: link.organizationId, storeId: link.storeId, principalType: "api_client" });
    return { link, nonce: pre.nonce, rawBody, query: rawQueryPairs(req), signedWithPrevious };
  }

  return { verify, limitClaim };
}
