import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { imageSize } from "image-size";
import { newId } from "@altyapi/commerce-core";
import { contentAssets, withTenantTx, type Database } from "@altyapi/database";
import { objectKeyFor } from "./assets";
import type { R2Storage } from "./r2";

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return false;
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * DNS lookup used by the outbound connection itself, so the address that is checked is the
 * address that is connected to (no DNS-rebinding window between check and connect).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as { address: string; family: number }[];
    const safe = list.filter((a) => !isPrivateAddress(a.address));
    if (!safe.length || safe.length !== list.length) return callback(new Error("host_not_allowed"), "", 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof safe) => void)(null, safe);
    callback(null, safe[0]!.address, safe[0]!.family);
  });
};

const outboundAgent = new Agent({ connect: { lookup: safeLookup, timeout: 10_000 } });

/**
 * SSRF-safe fetch of a merchant-provided image URL: https only, public addresses only
 * (checked after DNS resolution), no redirects to other hosts, size and type limits.
 */
export async function fetchRemoteImage(rawUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password) throw new Error("credentials_in_url");
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) throw new Error("host_not_allowed");

  const res = await undiciFetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "image/*" },
    dispatcher: outboundAgent,
  });
  if (res.status >= 300 && res.status < 400) throw new Error("redirect_not_followed");
  if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!EXT[contentType]) throw new Error("unsupported_content_type");
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_REMOTE_IMAGE_BYTES) throw new Error("too_large");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_REMOTE_IMAGE_BYTES) throw new Error("too_large");
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

const DOCUMENT_TYPES = new Set([
  "text/csv",
  "text/plain",
  "text/xml",
  "application/xml",
  "application/rss+xml",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/**
 * SSRF-safe download of a merchant-provided export (XML/CSV/XLSX feed of an integrator):
 * https only, public addresses only, optional Basic auth, no redirects, size limit.
 */
export async function fetchRemoteDocument(
  rawUrl: string,
  opts: { maxBytes?: number; basicAuth?: { username: string; password: string } | null } = {},
): Promise<{ bytes: Buffer; contentType: string }> {
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password) throw new Error("credentials_in_url");
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) throw new Error("host_not_allowed");
  const headers: Record<string, string> = { accept: "text/csv, application/xml, text/xml, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*;q=0.1" };
  if (opts.basicAuth) headers.authorization = `Basic ${Buffer.from(`${opts.basicAuth.username}:${opts.basicAuth.password}`, "utf8").toString("base64")}`;
  const res = await undiciFetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000), headers, dispatcher: outboundAgent });
  if (res.status >= 300 && res.status < 400) throw new Error("redirect_not_followed");
  if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType && !DOCUMENT_TYPES.has(contentType)) throw new Error("unsupported_content_type");
  if (Number(res.headers.get("content-length") ?? "0") > maxBytes) throw new Error("too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("too_large");
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

/** Downloads an image into the storefront-public bucket and registers a ready asset. */
export async function importRemoteImage(
  db: Database,
  r2: R2Storage,
  scope: { organizationId: string; storeId: string },
  rawUrl: string,
): Promise<string> {
  const { bytes, contentType } = await fetchRemoteImage(rawUrl);
  const dims = imageSize(bytes);
  if (!dims.width || !dims.height) throw new Error("unreadable_image");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const assetId = newId();
  const extension = EXT[contentType]!;
  const objectKey = objectKeyFor(scope.storeId, assetId, hash, extension);
  await r2.put("storefront-public", objectKey, bytes, contentType);
  await withTenantTx(db, scope, (tx) =>
    tx.insert(contentAssets).values({
      id: assetId,
      ...scope,
      bucket: "storefront-public",
      objectKey,
      kind: "image",
      status: "ready",
      contentType,
      extension,
      byteSize: bytes.length,
      contentHash: hash,
      originalFilename: new URL(rawUrl).pathname.split("/").pop()?.slice(0, 255) ?? null,
      width: dims.width,
      height: dims.height,
      readyAt: new Date(),
    }),
  );
  return assetId;
}
