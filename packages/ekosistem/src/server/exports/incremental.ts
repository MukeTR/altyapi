import { sql, type SQL, type Transaction } from "@altyapi/database";
import { INCREMENTAL_DEFAULT_LIMIT, INCREMENTAL_MAX_LIMIT, MAX_REFS_PER_LOOKUP } from "../../constants";
import { EkosistemError } from "../../errors";
import type { Tombstone } from "../../schemas";

/**
 * Incremental endpoints (docs/ekosistem/v1.md §6.3):
 *   ?since=<ISO>&cursor=<base64url>&limit=<1..200, default 100>
 *   → { items, nextCursor, asOf }
 * Without `since` the full current set is returned (deleted records excluded). With
 * `since` every record with updatedAt >= since is returned, deleted ones as tombstones.
 * Paging is keyset over (updatedAt, ref) with microsecond timestamps, so no record is
 * skipped or repeated between pages.
 */

export interface IncrementalRequest {
  since: string | null;
  cursor: { updatedAt: string; ref: string } | null;
  limit: number;
  /** `refs=a,b` lookup (≤ 50); only where the endpoint supports it. */
  refs: string[] | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,1024}$/;
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const invalidQuery = (message: string) => new EkosistemError("validation_failed", message);

/** Parses the decoded query pairs of an incremental endpoint; unknown parameters are rejected. */
export function parseIncrementalQuery(pairs: ReadonlyArray<readonly [string, string]>, opts: { allowRefs: boolean; extra?: readonly string[] }): IncrementalRequest {
  const q = new Map(pairs.map(([k, v]) => [k, v] as const));
  const allowed = new Set(["since", "cursor", "limit", ...(opts.allowRefs ? ["refs"] : []), ...(opts.extra ?? [])]);
  for (const key of q.keys()) if (!allowed.has(key)) throw invalidQuery(`Bilinmeyen sorgu parametresi: ${key.slice(0, 40)}`);

  let since: string | null = null;
  const rawSince = q.get("since");
  if (rawSince !== undefined) {
    if (!ISO_RE.test(rawSince) || Number.isNaN(Date.parse(rawSince))) throw invalidQuery("since, saat dilimi içeren ISO 8601 zamanı olmalıdır.");
    since = new Date(rawSince).toISOString();
  }

  let limit = INCREMENTAL_DEFAULT_LIMIT;
  const rawLimit = q.get("limit");
  if (rawLimit !== undefined) {
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > INCREMENTAL_MAX_LIMIT) throw invalidQuery(`limit 1 ile ${INCREMENTAL_MAX_LIMIT} arasında olmalıdır.`);
    limit = Number(rawLimit);
  }

  let cursor: IncrementalRequest["cursor"] = null;
  const rawCursor = q.get("cursor");
  if (rawCursor !== undefined) cursor = decodeCursor(rawCursor, since);

  let refs: string[] | null = null;
  const rawRefs = q.get("refs");
  if (rawRefs !== undefined) {
    if (since !== null || cursor !== null) throw invalidQuery("refs, since ve cursor ile birlikte kullanılamaz.");
    refs = [...new Set(rawRefs.split(",").map((r) => r.trim()).filter(Boolean))];
    if (!refs.length || refs.length > MAX_REFS_PER_LOOKUP) throw invalidQuery(`refs 1 ile ${MAX_REFS_PER_LOOKUP} arasında kimlik içermelidir.`);
    if (refs.some((r) => r.length > 200)) throw invalidQuery("refs içindeki kimlik çok uzun.");
  }
  return { since, cursor, limit, refs };
}

/** Cursors are base64url JSON bound to the `since` they were issued for. */
export function encodeCursor(updatedAt: string, ref: string, since: string | null): string {
  return Buffer.from(JSON.stringify({ u: updatedAt, r: ref, s: since }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string, since: string | null): { updatedAt: string; ref: string } {
  if (!CURSOR_RE.test(raw)) throw invalidQuery("cursor base64url olmalıdır.");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidQuery("cursor geçersiz.");
  }
  const v = value as { u?: unknown; r?: unknown; s?: unknown };
  if (typeof v.u !== "string" || !CURSOR_TS_RE.test(v.u) || typeof v.r !== "string" || v.r.length > 200 || (v.s !== null && typeof v.s !== "string")) {
    throw invalidQuery("cursor geçersiz.");
  }
  if ((v.s ?? null) !== since) throw invalidQuery("cursor başka bir since değeri için üretilmiş.");
  return { updatedAt: v.u, ref: v.r };
}

export interface PageKey {
  ref: string;
  deleted: boolean;
  updatedAt: Date;
  /** Microsecond-precision text of updatedAt, used for the cursor. */
  updatedAtText: string;
}

/**
 * Runs keyset paging over `source`, a query yielding (ref text, deleted boolean,
 * eff timestamptz). Returns the page's keys and the cursor of the next page.
 */
export async function pageKeys(tx: Transaction, source: SQL, req: IncrementalRequest): Promise<{ keys: PageKey[]; nextCursor: string | null }> {
  const since = req.since ? sql`and k.eff >= ${req.since}::timestamptz` : sql``;
  const after = req.cursor ? sql`and (k.eff, k.ref) > (${req.cursor.updatedAt}::timestamptz, ${req.cursor.ref})` : sql``;
  const rows = await tx.execute<{ ref: string; deleted: boolean; eff: Date | string; eff_text: string }>(sql`
    select k.ref, k.deleted, k.eff, to_char(k.eff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as eff_text
      from (${source}) k
     where true ${since} ${after}
     order by k.eff, k.ref
     limit ${req.limit + 1}`);
  const list = [...rows];
  const more = list.length > req.limit;
  const keys = list.slice(0, req.limit).map((r) => ({
    ref: r.ref,
    deleted: r.deleted === true,
    updatedAt: r.eff instanceof Date ? r.eff : new Date(r.eff),
    updatedAtText: r.eff_text,
  }));
  const last = keys.at(-1);
  return { keys, nextCursor: more && last ? encodeCursor(last.updatedAtText, last.ref, req.since) : null };
}

export async function transactionNow(tx: Transaction): Promise<Date> {
  const [row] = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
  const v = row!.now;
  return v instanceof Date ? v : new Date(v);
}

export function tombstone(key: Pick<PageKey, "ref" | "updatedAt">): Tombstone {
  return { ref: key.ref, deleted: true, updatedAt: key.updatedAt.toISOString() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refs are altyapi UUIDs; anything else cannot match and is dropped before querying. */
export function uuidRefs(refs: readonly string[]): string[] {
  return refs.filter((r) => UUID_RE.test(r)).map((r) => r.toLowerCase());
}

export function isUuidRef(ref: string): boolean {
  return UUID_RE.test(ref);
}

export interface IncrementalPage<T> {
  items: Array<T | Tombstone>;
  nextCursor: string | null;
  asOf: string;
}
