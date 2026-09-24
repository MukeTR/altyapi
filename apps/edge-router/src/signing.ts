const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, key);
  }
  return key;
}

function base64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mirrors signEdgePayload in @altyapi/domains: "<ts>.<base64url(HMAC-SHA256(ts.payload))>". */
export async function signEdgePayload(secret: string, payload: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(`${ts}.${payload}`));
  return `${ts}.${base64url(sig)}`;
}
