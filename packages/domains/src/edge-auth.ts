import { hmacSign, safeEqual } from "@altyapi/auth";

/**
 * Edge ↔ origin request signing. The edge router signs "<timestamp>.<payload>" with the
 * shared EDGE_ROUTING_SECRET; origins reject missing, invalid or stale (>60s) signatures.
 * The same scheme is implemented with Web Crypto in apps/edge-router.
 */
export const EDGE_MAX_SKEW_SECONDS = 60;

export function signEdgePayload(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `${timestamp}.${hmacSign(secret, `${timestamp}.${payload}`)}`;
}

export function verifyEdgeSignature(secret: string, payload: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const [ts, sig] = signature.split(".");
  const timestamp = Number(ts);
  if (!Number.isInteger(timestamp) || !sig) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > EDGE_MAX_SKEW_SECONDS) return false;
  return safeEqual(hmacSign(secret, `${timestamp}.${payload}`), sig);
}
