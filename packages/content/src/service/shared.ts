import { AppError, conflict, invalid, isValidSlug, notFound, slugify } from "@altyapi/commerce-core";
import {
  and,
  collections,
  contentAssets,
  contentEntries,
  contentReferences,
  contentTypes,
  eq,
  inArray,
  ne,
  or,
  pages,
  products,
  recordSlugs,
  siteLocations,
  sql,
  stores,
  type Transaction,
} from "@altyapi/database";
import { setAssetReferences } from "@altyapi/storage";
import { assertCan, assertModule, type StoreContext } from "@altyapi/tenancy";
import type { Permission } from "@altyapi/auth";
import { fieldValueIn } from "../fields/compile";
import type { EntryRef } from "../fields/refs";
import type { FieldDef } from "../fields/types";
import { resolveContentType, type ContentTypeRow, type EffectiveContentType } from "../types/definition";
import { getContentTypeDefinition } from "../types/registry";

/** record_versions / record_slugs / content_references resource type of content entries. */
export const ENTRY_RESOURCE = "content_entry";

/** draft_revisions resource type of content entries. */
export const ENTRY_REVISION_RESOURCE = "entry" as const;

/**
 * A unique violation (23505) raised by Postgres, optionally of one constraint or index. The
 * driver error (postgres.js: constraint_name) is the query error itself or, through the ORM,
 * its cause.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  type PgError = { code?: unknown; constraint_name?: unknown };
  const pgError = (e: unknown): PgError | null => (e && typeof e === "object" ? (e as PgError) : null);
  for (const e of [pgError(err), pgError((err as { cause?: unknown } | null)?.cause)]) {
    if (e?.code === "23505" && (!constraint || e.constraint_name === constraint)) return true;
  }
  return false;
}

export type Scope = { organizationId: string; storeId: string };

/** What content services need to know about the store (from the request context or, in the worker, the stores row). */
export interface StoreInfo extends Scope {
  defaultLocale: string;
  supportedLocales: string[];
}

/**
 * Gate of every content service: the principal's permission (content:* is shared with pages)
 * and the store's content module (site_modules), which content entries and types belong to.
 */
export function assertContent(ctx: StoreContext, permission: Permission): void {
  assertCan(ctx, permission);
  assertModule(ctx, "content");
}

export const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

export const storeInfoOf = (ctx: StoreContext): StoreInfo => ({
  organizationId: ctx.organizationId,
  storeId: ctx.storeId,
  defaultLocale: ctx.store.defaultLocale,
  supportedLocales: ctx.store.supportedLocales,
});

export async function loadStoreInfo(tx: Transaction, scope: Scope): Promise<StoreInfo> {
  const [store] = await tx
    .select({ defaultLocale: stores.defaultLocale, supportedLocales: stores.supportedLocales })
    .from(stores)
    .where(eq(stores.id, scope.storeId));
  if (!store) throw notFound("store", scope.storeId);
  return { ...scope, defaultLocale: store.defaultLocale, supportedLocales: store.supportedLocales };
}

/** Store languages with the default first. */
export function orderedLocales(store: Pick<StoreInfo, "defaultLocale" | "supportedLocales">): string[] {
  return [store.defaultLocale, ...store.supportedLocales.filter((l) => l !== store.defaultLocale)];
}

export function effectiveType(row: ContentTypeRow): EffectiveContentType {
  return resolveContentType(row, getContentTypeDefinition);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Row lock on a content type: "update" for changes of the type itself (update, archive);
 * "share" for entry state changes that rely on the type staying active (create, save,
 * schedule, publish, unarchive). archiveType's FOR UPDATE waits for every share holder to
 * commit, so its check for live entries sees their publish, and a share lock taken after the
 * archive sees the archived type.
 */
export type TypeLock = "update" | "share";

/** A type of this store by id or key (optionally locked). */
export async function findTypeTx(tx: Transaction, storeId: string, typeRef: string, opts: { lock?: TypeLock } = {}): Promise<{ row: ContentTypeRow; type: EffectiveContentType }> {
  const where = and(eq(contentTypes.storeId, storeId), UUID_RE.test(typeRef) ? eq(contentTypes.id, typeRef) : eq(contentTypes.key, typeRef));
  const query = tx.select().from(contentTypes).where(where);
  const [row] = opts.lock ? await query.for(opts.lock) : await query;
  if (!row) throw notFound("content_type", typeRef);
  return { row, type: effectiveType(row) };
}

export async function activeTypesTx(tx: Transaction, storeId: string): Promise<EffectiveContentType[]> {
  const rows = await tx
    .select()
    .from(contentTypes)
    .where(and(eq(contentTypes.storeId, storeId), eq(contentTypes.status, "active")));
  return rows.map(effectiveType);
}

/** Bumps the store's content version (part of every storefront and edge cache key); returns the new value. */
export async function bumpContentVersion(tx: Transaction, storeId: string): Promise<number> {
  const [row] = await tx
    .update(stores)
    .set({ contentVersion: sql`${stores.contentVersion} + 1` })
    .where(eq(stores.id, storeId))
    .returning({ contentVersion: stores.contentVersion });
  return row!.contentVersion;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Rewrites the reference rows of one state (draft or live) of a source record. */
export async function setContentReferencesTx(
  tx: Transaction,
  scope: Scope,
  source: { type: string; id: string },
  state: "draft" | "live",
  refs: EntryRef[],
): Promise<void> {
  await tx
    .delete(contentReferences)
    .where(
      and(
        eq(contentReferences.storeId, scope.storeId),
        eq(contentReferences.sourceType, source.type),
        eq(contentReferences.sourceId, source.id),
        eq(contentReferences.state, state),
      ),
    );
  if (!refs.length) return;
  await tx
    .insert(contentReferences)
    .values(refs.map((r) => ({ ...scope, sourceType: source.type, sourceId: source.id, state, targetKind: r.targetKind, targetId: r.targetId, fieldPath: r.fieldPath })))
    .onConflictDoNothing();
}

/**
 * asset_references of an entry: every asset its draft or live version uses, so storage cleanup
 * never removes an image the live site still shows after the draft dropped it.
 */
export async function syncEntryAssetReferences(tx: Transaction, scope: Scope, entryId: string): Promise<void> {
  const rows = await tx
    .selectDistinct({ id: contentReferences.targetId })
    .from(contentReferences)
    .where(
      and(
        eq(contentReferences.storeId, scope.storeId),
        eq(contentReferences.sourceType, ENTRY_RESOURCE),
        eq(contentReferences.sourceId, entryId),
        eq(contentReferences.targetKind, "asset"),
      ),
    );
  await setAssetReferences(tx, scope, { type: ENTRY_RESOURCE, id: entryId }, rows.map((r) => r.id));
}

/** The field a reference path belongs to ("gallery.2" → gallery, "authors.0.role" → the repeater child). */
function fieldForPath(fields: readonly FieldDef[], path: string): FieldDef | null {
  const [head, second, third] = path.split(".");
  const field = fields.find((f) => f.key === head);
  if (!field) return null;
  if (field.type === "group") return field.validation.fields.find((c) => c.key === second) ?? null;
  if (field.type === "repeater") return field.validation.fields.find((c) => c.key === third) ?? null;
  return field;
}

/**
 * Every record an entry points at must exist in this store: assets (not deleted, of a kind the
 * field accepts), entries (of the allowed types), products, collections, pages, locations.
 */
export async function assertReferencesValid(tx: Transaction, storeId: string, type: EffectiveContentType, refs: EntryRef[]): Promise<void> {
  const byKind = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!byKind.has(r.targetKind)) byKind.set(r.targetKind, new Set());
    byKind.get(r.targetKind)!.add(r.targetId);
  }
  const ids = (kind: string) => [...(byKind.get(kind) ?? [])];
  const missing = (kind: string, found: Set<string>) => {
    const gone = ids(kind).filter((id) => !found.has(id));
    if (gone.length) throw invalid("errors.content.reference_not_found", { kind, ids: gone });
  };

  if (ids("asset").length) {
    const rows = await tx
      .select({ id: contentAssets.id, kind: contentAssets.kind, deletedAt: contentAssets.deletedAt })
      .from(contentAssets)
      .where(and(eq(contentAssets.storeId, storeId), inArray(contentAssets.id, ids("asset"))));
    const live = rows.filter((r) => !r.deletedAt);
    missing("asset", new Set(live.map((r) => r.id)));
    const kindOf = new Map(live.map((r) => [r.id, r.kind]));
    for (const r of refs.filter((x) => x.targetKind === "asset")) {
      const field = r.fieldPath === "seo.imageAssetId" ? null : fieldForPath(type.fields, r.fieldPath);
      const allowed =
        r.fieldPath === "seo.imageAssetId" || field?.type === "richDoc" || field?.type === "gallery"
          ? ["image"]
          : field?.type === "asset"
            ? field.validation.kinds
            : null;
      const kind = kindOf.get(r.targetId);
      if (allowed && kind && !allowed.includes(kind as never)) throw invalid("errors.content.asset_kind_not_allowed", { field: r.fieldPath, assetId: r.targetId, kind, allowed });
    }
  }
  if (ids("entry").length) {
    const rows = await tx
      .select({ id: contentEntries.id, typeKey: contentTypes.key, builtinKey: contentTypes.builtinKey })
      .from(contentEntries)
      .innerJoin(contentTypes, eq(contentTypes.id, contentEntries.typeId))
      .where(and(eq(contentEntries.storeId, storeId), inArray(contentEntries.id, ids("entry"))));
    missing("entry", new Set(rows.map((r) => r.id)));
    const typeOf = new Map(rows.map((r) => [r.id, r]));
    for (const r of refs.filter((x) => x.targetKind === "entry")) {
      const field = fieldForPath(type.fields, r.fieldPath);
      if (!field || (field.type !== "reference" && field.type !== "multiReference") || !field.validation.typeKeys) continue;
      const target = typeOf.get(r.targetId);
      // typeKeys name built-in types; an installed copy under another key (practice_area for service) qualifies too.
      if (target && !field.validation.typeKeys.includes(target.typeKey) && !(target.builtinKey && field.validation.typeKeys.includes(target.builtinKey))) {
        throw invalid("errors.content.reference_type_not_allowed", { field: r.fieldPath, entryId: r.targetId, allowed: field.validation.typeKeys });
      }
    }
  }
  const simple: [string, () => Promise<{ id: string }[]>][] = [
    ["product", () => tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, ids("product"))))],
    ["collection", () => tx.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, storeId), inArray(collections.id, ids("collection"))))],
    ["page", () => tx.select({ id: pages.id }).from(pages).where(and(eq(pages.storeId, storeId), inArray(pages.id, ids("page"))))],
    ["location", () => tx.select({ id: siteLocations.id }).from(siteLocations).where(and(eq(siteLocations.storeId, storeId), inArray(siteLocations.id, ids("location"))))],
  ];
  for (const [kind, query] of simple) {
    if (!ids(kind).length) continue;
    missing(kind, new Set((await query()).map((r) => r.id)));
  }
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Slugs an entry of a type may not use in a language: the archive segments of its taxonomies (/blog/kategori). */
function reservedSlugs(type: EffectiveContentType, locale: string): Set<string> {
  return new Set(type.taxonomies.map((t) => (t.archiveSegment as Record<string, string>)[locale] ?? t.archiveSegment.en));
}

export function assertSlugFormat(type: EffectiveContentType, slugs: Record<string, string>): void {
  for (const [locale, slug] of Object.entries(slugs)) {
    if (!isValidSlug(slug)) throw invalid("errors.content_entry.invalid_slug", { locale, slug });
    if (reservedSlugs(type, locale).has(slug)) throw invalid("errors.content_entry.slug_reserved", { locale, slug });
  }
}

/** (locale, slug) pairs of `slugs` that another entry of the type uses: live, or (with drafts) in its draft. */
export async function takenSlugs(
  tx: Transaction,
  storeId: string,
  type: EffectiveContentType,
  slugs: Record<string, string>,
  exceptId: string | null,
  opts: { drafts: boolean },
): Promise<{ locale: string; slug: string }[]> {
  const pairs = Object.entries(slugs);
  if (!pairs.length) return [];
  const taken: { locale: string; slug: string }[] = [];
  const live = await tx
    .select({ locale: recordSlugs.locale, slug: recordSlugs.slug })
    .from(recordSlugs)
    .where(
      and(
        eq(recordSlugs.storeId, storeId),
        eq(recordSlugs.scopeKey, type.id),
        eq(recordSlugs.isCurrent, true),
        exceptId ? ne(recordSlugs.resourceId, exceptId) : undefined,
        or(...pairs.map(([locale, slug]) => and(eq(recordSlugs.locale, locale), eq(recordSlugs.slug, slug)))),
      ),
    );
  taken.push(...live);
  if (opts.drafts) {
    const drafts = await tx
      .select({ slugs: contentEntries.draftSlugs })
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.storeId, storeId),
          eq(contentEntries.typeId, type.id),
          ne(contentEntries.status, "archived"),
          exceptId ? ne(contentEntries.id, exceptId) : undefined,
          or(...pairs.map(([locale, slug]) => sql`${contentEntries.draftSlugs} ->> ${locale} = ${slug}`)),
        ),
      );
    for (const d of drafts) for (const [locale, slug] of pairs) if (d.slugs[locale] === slug) taken.push({ locale, slug });
  }
  return taken;
}

/** Refuses slugs another entry of the type is live under or has in its draft (one URL, one entry). */
export async function assertSlugsFree(tx: Transaction, storeId: string, type: EffectiveContentType, slugs: Record<string, string>, exceptId: string | null, opts: { drafts: boolean }): Promise<void> {
  assertSlugFormat(type, slugs);
  const [clash] = await takenSlugs(tx, storeId, type, slugs, exceptId, opts);
  if (clash) throw conflict("errors.content_entry.slug_taken", clash);
}

/**
 * Fills missing slugs from the title in every language that has one, picking a free variant
 * ("hizmet-2") when the plain slug is taken. Slugs the editor set are kept as they are.
 */
export async function fillSlugs(
  tx: Transaction,
  storeId: string,
  type: EffectiveContentType,
  data: Record<string, unknown>,
  slugs: Record<string, string>,
  locales: readonly string[],
  exceptId: string | null,
): Promise<Record<string, string>> {
  if (!type.hasSlugs) return {};
  const out = { ...slugs };
  const titleField = type.fields.find((f) => f.key === type.titleField);
  if (!titleField) return out;
  for (const locale of locales) {
    if (out[locale]) continue;
    const title = fieldValueIn(titleField, data[type.titleField], locale);
    if (typeof title !== "string" || !title.trim()) continue;
    const base = slugify(title, 60) || "icerik";
    const reserved = reservedSlugs(type, locale);
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? base : `${base.slice(0, 60)}-${n}`;
      if (reserved.has(candidate)) continue;
      if (!(await takenSlugs(tx, storeId, type, { [locale]: candidate }, exceptId, { drafts: true })).length) {
        out[locale] = candidate;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

/**
 * A parent must be another entry of the same (hierarchical) type; the tree stays acyclic and
 * within the type's maximum depth, subtree included.
 */
export async function assertParentValid(tx: Transaction, storeId: string, type: EffectiveContentType, entryId: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (!type.settings.hierarchical) throw invalid("errors.content_entry.not_hierarchical");
  if (parentId === entryId) throw invalid("errors.content_entry.parent_cycle");
  const [parent] = await tx
    .select({ id: contentEntries.id, status: contentEntries.status })
    .from(contentEntries)
    .where(and(eq(contentEntries.id, parentId), eq(contentEntries.storeId, storeId), eq(contentEntries.typeId, type.id)));
  if (!parent || parent.status === "archived") throw invalid("errors.content_entry.invalid_parent", { parentId });
  const ancestors = await tx.execute<{ id: string; depth: number }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 1 from content_entries where id = ${parentId}
      union all
      select e.id, e.parent_id, up.depth + 1 from content_entries e join up on e.id = up.parent_id where up.depth < 50
    )
    select id, depth from up`);
  if (entryId && ancestors.some((a) => a.id === entryId)) throw invalid("errors.content_entry.parent_cycle");
  let height = 1;
  if (entryId) {
    const [row] = await tx.execute<{ height: number }>(sql`
      with recursive down(id, depth) as (
        select id, 1 from content_entries where parent_id = ${entryId}
        union all
        select e.id, down.depth + 1 from content_entries e join down on e.parent_id = down.id where down.depth < 50
      )
      select coalesce(max(depth), 0) + 1 as height from down`);
    height = Number(row?.height ?? 1);
  }
  const maxDepth = type.settings.maxDepth ?? 5;
  if (ancestors.length + height > maxDepth) throw invalid("errors.content_entry.too_deep", { maxDepth });
}

/** Refuses when a type is archived (no new entries, edits or publishes). */
export function assertTypeActive(type: EffectiveContentType): void {
  if (type.status !== "active") throw new AppError("precondition_failed", "errors.content_type.archived", { typeId: type.id });
}
