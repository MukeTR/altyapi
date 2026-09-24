import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Compact signed value "payload.signature" with an expiry, used for approval links and invites. */
export function signValue(secret: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmacSign(secret, body)}`;
}

export function verifySignedValue<T extends Record<string, unknown>>(secret: string, token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(hmacSign(secret, body), sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
