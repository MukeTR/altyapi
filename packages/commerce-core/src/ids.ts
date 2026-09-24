import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUIDv7 for internal primary keys (index-friendly on PostgreSQL btrees). */
export function newId(): string {
  return uuidv7();
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u",
};

/** Turkish-aware slugify used for store, product and page handles. */
export function slugify(input: string, maxLength = 63): string {
  const replaced = input.replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c] ?? c);
  return replaced
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/**
 * Deterministic UUID (RFC 9562 v8 layout) derived from a name. Used for idempotent job
 * ids such as "domains.check:<domainId>:<slot>" so re-enqueueing is a no-op.
 */
export function deterministicId(name: string): string {
  const hex = createHash("sha256").update(name, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
