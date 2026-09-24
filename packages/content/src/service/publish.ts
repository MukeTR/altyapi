import { AppError, conflict, invalid, LOCALE_CODES, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  contentAssets,
  contentEntries,
  contentReferences,
  contentTypes,
  desc,
  draftRevisions,
  eq,
  inArray,
  isNull,
  ne,
  recordSlugs,
  recordVersions,
  sql,
  type ContentEntryVersionData,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { compileEntrySchema, publishableLocales } from "../fields/compile";
import { collectEntryRefs } from "../fields/refs";
import { CONTENT_LIMITS } from "../limits";
import { entryPath, termArchivePath } from "../paths";
import { releasePath, savePathRedirect } from "../redirects";
import type { EffectiveContentType } from "../types/definition";
import { upgradeEntryData } from "../types/registry";
import { deriveEntry } from "./derive";
import {
  activeTypesTx,
  assertSlugsFree,
  assertTypeActive,
  bumpContentVersion,
  effectiveType,
  ENTRY_RESOURCE,
  ENTRY_REVISION_RESOURCE,
  fillSlugs,
  isUniqueViolation,
  orderedLocales,
  setContentReferencesTx,
  syncEntryAssetReferences,
  type Scope,
  type StoreInfo,
  type TypeLock,
} from "./shared";

export type EntryRow = typeof contentEntries.$inferSelect;
export type RecordVersionRow = typeof recordVersions.$inferSelect;

export interface ContentIssue {
  path: string;
  message: string;
}

export function contentIssues(issues: ContentIssue[]): never {
  throw new AppError("validation_failed", "errors.content.invalid", { issues });
}

export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }, prefix = "data"): ContentIssue[] {
  return error.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].join("."), message: i.message }));
}

/** Locks an entry of this store for a state change. */
export async function lockEntry(tx: Transaction, storeId: string, entryId: string): Promise<EntryRow> {
  const [row] = await tx
    .select()
    .from(contentEntries)
    .where(and(eq(contentEntries.id, entryId), eq(contentEntries.storeId, storeId)))
    .for("update");
  if (!row) throw notFound("content_entry", entryId);
  return row;
}

/**
 * The type of an entry. State changes that rely on the type staying active (save, schedule,
 * publish, unarchive) take a share lock, so they serialize with archiveType (see TypeLock).
 */
export async function entryTypeTx(tx: Transaction, entry: EntryRow, opts: { lock?: TypeLock } = {}): Promise<EffectiveContentType> {
  const query = tx.select().from(contentTypes).where(eq(contentTypes.id, entry.typeId));
  const [row] = opts.lock ? await query.for(opts.lock) : await query;
  if (!row) throw notFound("content_type", entry.typeId);
  return effectiveType(row);
}

/**
 * The entry as it was at a draft revision (its draft_revisions snapshot): what a scheduled
 * publish approved, while the draft may have moved on since.
 */
async function entryAtRevision(tx: Transaction, entry: EntryRow, revision: number): Promise<EntryRow> {
  const [row] = await tx
    .select({ snapshot: draftRevisions.snapshot })
    .from(draftRevisions)
    .where(and(eq(draftRevisions.resourceType, ENTRY_REVISION_RESOURCE), eq(draftRevisions.resourceId, entry.id), eq(draftRevisions.revision, revision)));
  if (!row) throw new AppError("precondition_failed", "errors.content_entry.scheduled_revision_missing", { revision });
  const snap = row.snapshot;
  return {
    ...entry,
    draftData: (snap.data ?? {}) as Record<string, unknown>,
    draftSeo: (snap.seo ?? {}) as EntryRow["draftSeo"],
    draftSlugs: (snap.slugs ?? {}) as Record<string, string>,
    parentId: (snap.parentId as string | null | undefined) ?? null,
    position: typeof snap.position === "number" ? snap.position : entry.position,
    schemaVersion: typeof snap.schemaVersion === "number" ? snap.schemaVersion : entry.schemaVersion,
    draftRevision: revision,
  };
}

/** Entry data brought up to the type's current schema version. */
export function currentData(type: EffectiveContentType, entry: EntryRow): { data: Record<string, unknown>; upgraded: boolean } {
  if (!type.builtin || entry.schemaVersion >= type.version) return { data: entry.draftData, upgraded: false };
  return { data: upgradeEntryData(type.builtin, entry.draftData, entry.schemaVersion), upgraded: true };
}

export interface PreparedPublication {
  data: Record<string, unknown>;
  locales: string[];
  slugs: Record<string, string>;
  upgraded: boolean;
}

/**
 * Checks that the draft can go live and works out what goes live: the languages whose required
 * fields are filled (the default language must be one of them), their slugs (filled from the
 * title where missing, never another entry's live slug), and that every asset it shows is
 * ready. Throws the validation issues otherwise. Used by publish, scheduling and the scheduler.
 */
export async function preparePublicationTx(tx: Transaction, store: StoreInfo, type: EffectiveContentType, entry: EntryRow): Promise<PreparedPublication> {
  assertTypeActive(type);
  const { data, upgraded } = currentData(type, entry);
  const candidates = orderedLocales(store);
  const allowed = [...new Set([...candidates, ...LOCALE_CODES])];
  let locales = publishableLocales(type, data, candidates, type.hiddenFields);
  let slugs: Record<string, string> = {};
  if (type.hasSlugs) {
    const own = Object.fromEntries(Object.entries(entry.draftSlugs).filter(([l]) => locales.includes(l)));
    slugs = await fillSlugs(tx, store.storeId, type, data, own, locales, entry.id);
    locales = locales.filter((l) => slugs[l]);
    slugs = Object.fromEntries(locales.map((l) => [l, slugs[l]!]));
  }
  if (!locales.includes(store.defaultLocale)) {
    const check = compileEntrySchema(type, { mode: "publish", locales: allowed, requiredLocales: [store.defaultLocale], hiddenFields: type.hiddenFields }).safeParse(data);
    if (!check.success) contentIssues(zodIssues(check.error));
    throw invalid("errors.content_entry.slug_required", { locale: store.defaultLocale });
  }
  const parsed = compileEntrySchema(type, { mode: "publish", locales: allowed, requiredLocales: locales, hiddenFields: type.hiddenFields }).safeParse(data);
  if (!parsed.success) contentIssues(zodIssues(parsed.error));
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > CONTENT_LIMITS.entryBytes) throw invalid("errors.content_entry.too_large", { maxBytes: CONTENT_LIMITS.entryBytes });
  if (type.hasSlugs) await assertSlugsFree(tx, store.storeId, type, slugs, entry.id, { drafts: false });

  const assetIds = collectEntryRefs(type.fields, parsed.data, { seo: entry.draftSeo })
    .filter((r) => r.targetKind === "asset")
    .map((r) => r.targetId);
  if (assetIds.length) {
    const ready = await tx
      .select({ id: contentAssets.id })
      .from(contentAssets)
      .where(and(eq(contentAssets.storeId, store.storeId), inArray(contentAssets.id, [...new Set(assetIds)]), eq(contentAssets.status, "ready"), isNull(contentAssets.deletedAt)));
    const readyIds = new Set(ready.map((r) => r.id));
    const pending = [...new Set(assetIds)].filter((id) => !readyIds.has(id));
    if (pending.length) throw new AppError("precondition_failed", "errors.content.asset_not_ready", { assetIds: pending });
  }
  return { data: parsed.data, locales, slugs, upgraded };
}

/** The open (live) version of an entry, locked. */
async function openVersion(tx: Transaction, entryId: string): Promise<RecordVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(recordVersions)
    .where(and(eq(recordVersions.resourceType, ENTRY_RESOURCE), eq(recordVersions.resourceId, entryId), isNull(recordVersions.liveTo)))
    .for("update");
  return row;
}

async function latestVersion(tx: Transaction, entryId: string): Promise<RecordVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(recordVersions)
    .where(and(eq(recordVersions.resourceType, ENTRY_RESOURCE), eq(recordVersions.resourceId, entryId)))
    .orderBy(desc(recordVersions.version))
    .limit(1);
  return row;
}

/**
 * Live periods use the database clock at statement time (clock_timestamp): a transaction that
 * waited for the entry lock started before the one it waited for committed, so its now()
 * could precede the live_from it closes.
 */
const DB_CLOCK = sql`clock_timestamp()`;

/** Closes the live version (record_versions accepts exactly this update: live_to set once). */
async function closeVersion(tx: Transaction, versionId: string): Promise<void> {
  await tx.update(recordVersions).set({ liveTo: DB_CLOCK }).where(and(eq(recordVersions.id, versionId), isNull(recordVersions.liveTo)));
}

/** True when a field marked significant, or the set of published languages, changed since the previous version. */
function isSignificantChange(type: EffectiveContentType, previous: RecordVersionRow | undefined, data: Record<string, unknown>, locales: string[]): boolean {
  if (!previous) return true;
  const prev = previous.data as unknown as ContentEntryVersionData;
  if (locales.some((l) => !previous.locales.includes(l))) return true;
  return type.fields.some((f) => f.significant && JSON.stringify(prev.data?.[f.key] ?? null) !== JSON.stringify(data[f.key] ?? null));
}

/**
 * Makes the slugs of the publish current in record_slugs and answers moved URLs with 301s:
 * a language whose live slug changed gets a redirect from its previous path (for taxonomy
 * terms: every archive path of the owner types); a language no longer published loses its
 * current slug. Paths that are live again stop redirecting.
 */
async function syncSlugs(tx: Transaction, store: StoreInfo, type: EffectiveContentType, entryId: string, slugs: Record<string, string>, previous: RecordVersionRow | undefined): Promise<void> {
  const scope: Scope = { organizationId: store.organizationId, storeId: store.storeId };
  const rows = await tx
    .select()
    .from(recordSlugs)
    .where(and(eq(recordSlugs.resourceType, ENTRY_RESOURCE), eq(recordSlugs.resourceId, entryId)));
  const previousSlugs = ((previous?.data as unknown as ContentEntryVersionData | undefined)?.slugs ?? {}) as Record<string, string>;
  const owners = type.kind === "taxonomy" && type.builtin ? (await activeTypesTx(tx, store.storeId)).filter((t) => t.taxonomies.some((b) => b.typeKey === type.builtin!.key)) : [];
  const pathsOf = (locale: string, slug: string): string[] =>
    type.kind === "taxonomy"
      ? owners.flatMap((o) => {
          const p = termArchivePath(o, type.builtin!.key, locale, store.defaultLocale, slug);
          return p ? [p] : [];
        })
      : [entryPath(type, locale, store.defaultLocale, slug)].filter((p): p is string => !!p);

  for (const row of rows) {
    if (row.isCurrent && slugs[row.locale] !== row.slug) {
      await tx.update(recordSlugs).set({ isCurrent: false }).where(eq(recordSlugs.id, row.id));
    }
  }
  for (const [locale, slug] of Object.entries(slugs)) {
    const existing = rows.find((r) => r.locale === locale && r.slug === slug);
    try {
      if (existing && !existing.isCurrent) await tx.update(recordSlugs).set({ isCurrent: true }).where(eq(recordSlugs.id, existing.id));
      if (!existing) {
        await tx.insert(recordSlugs).values({
          id: newId(),
          ...scope,
          resourceType: ENTRY_RESOURCE,
          resourceId: entryId,
          scopeKey: type.id,
          locale,
          slug,
          isCurrent: true,
        });
      }
    } catch (err) {
      // Another entry went live under the slug after the check (concurrent publish).
      if (isUniqueViolation(err)) throw conflict("errors.content_entry.slug_taken", { locale, slug });
      throw err;
    }
    const newPaths = pathsOf(locale, slug);
    for (const path of newPaths) await releasePath(tx, store.storeId, path);
    const before = previousSlugs[locale];
    if (before && before !== slug) {
      const oldPaths = pathsOf(locale, before);
      for (const [i, from] of oldPaths.entries()) {
        const to = newPaths[i];
        if (to && from !== to) await savePathRedirect(tx, scope, { fromPath: from, toPath: to, statusCode: 301, matchType: "exact", source: "slug_change" });
      }
    }
  }
}

export interface PublishResult {
  entry: EntryRow;
  version: RecordVersionRow;
  /** Referenced entries that are not live (the editor offers to publish them too). */
  unpublishedDependencies: { id: string; typeKey: string; status: EntryRow["status"] }[];
}

/**
 * Publishes the draft of an entry as a new immutable version: closes the live version, writes
 * version N+1 with its derived output, points the entry at it, makes its slugs current (301s
 * for moved URLs), rewrites the live references, bumps the content version and announces
 * content.entry.published. Serialized per entry by the row lock. With `revision`, the draft
 * revision a scheduled publish was approved at goes live, and the draft (which may hold later
 * edits) is left as it is.
 */
export async function publishEntryTx(
  tx: Transaction,
  store: StoreInfo,
  entryId: string,
  opts: {
    principalId: string | null;
    reason: "manual" | "scheduled";
    expectedRevision?: number | undefined;
    /** Compliance policy snapshot and lint report the publish was checked against (compliance core, later phase). */
    policy?: { snapshotId: string | null; lintReportId: string | null } | undefined;
    /** Draft revision to publish instead of the current draft (the approved revision of a scheduled publish). */
    revision?: number | undefined;
  },
): Promise<PublishResult> {
  const scope: Scope = { organizationId: store.organizationId, storeId: store.storeId };
  const entry = await lockEntry(tx, store.storeId, entryId);
  if (entry.status === "archived") throw new AppError("precondition_failed", "errors.content_entry.archived");
  if (opts.expectedRevision !== undefined && entry.draftRevision !== opts.expectedRevision) {
    throw conflict("errors.content.revision_conflict", { currentRevision: entry.draftRevision });
  }
  const type = await entryTypeTx(tx, entry, { lock: "share" });
  const isDraft = opts.revision === undefined || opts.revision === entry.draftRevision;
  const source = isDraft ? entry : await entryAtRevision(tx, entry, opts.revision!);
  const prepared = await preparePublicationTx(tx, store, type, source);
  const now = new Date();

  const live = await openVersion(tx, entry.id);
  const previous = live ?? (await latestVersion(tx, entry.id));
  if (live) await closeVersion(tx, live.id);
  const significant = isSignificantChange(type, previous, prepared.data, prepared.locales);

  const versionData: ContentEntryVersionData = {
    typeId: type.id,
    schemaVersion: type.version,
    data: prepared.data,
    seo: source.draftSeo,
    slugs: prepared.slugs,
    parentId: source.parentId,
    position: source.position,
  };
  const [version] = await tx
    .insert(recordVersions)
    .values({
      id: newId(),
      ...scope,
      resourceType: ENTRY_RESOURCE,
      resourceId: entry.id,
      version: (previous?.version ?? 0) + 1,
      data: versionData as unknown as Record<string, unknown>,
      derived: deriveEntry(type, prepared.data, prepared.locales) as unknown as Record<string, Record<string, unknown>>,
      locales: prepared.locales,
      liveFrom: DB_CLOCK,
      sourceRevision: source.draftRevision,
      publishedByPrincipalId: opts.principalId,
      policySnapshotId: opts.policy?.snapshotId ?? null,
      lintReportId: opts.policy?.lintReportId ?? null,
    })
    .returning();

  const [updated] = await tx
    .update(contentEntries)
    .set({
      status: "published",
      liveVersionId: version!.id,
      publishedRevision: source.draftRevision,
      publishedLocales: prepared.locales,
      publishAt: null,
      scheduledRevision: null,
      scheduledByPrincipalId: null,
      archivedAt: null,
      firstPublishedAt: entry.firstPublishedAt ?? now,
      contentModifiedAt: significant || !entry.contentModifiedAt ? now : entry.contentModifiedAt,
      // Slugs filled in at publish (and an upgraded schema) are written back to the draft that
      // went live; a draft that moved on past a scheduled revision keeps its own.
      ...(isDraft ? { draftSlugs: { ...entry.draftSlugs, ...prepared.slugs } } : {}),
      ...(isDraft && prepared.upgraded ? { draftData: prepared.data, schemaVersion: type.version } : {}),
    })
    .where(eq(contentEntries.id, entry.id))
    .returning();

  if (type.hasSlugs) await syncSlugs(tx, store, type, entry.id, prepared.slugs, previous);
  const refs = collectEntryRefs(type.fields, prepared.data, { seo: source.draftSeo, parentId: source.parentId });
  await setContentReferencesTx(tx, scope, { type: ENTRY_RESOURCE, id: entry.id }, "live", refs);
  await syncEntryAssetReferences(tx, scope, entry.id);

  const entryRefIds = [...new Set(refs.filter((r) => r.targetKind === "entry").map((r) => r.targetId))];
  const dependencies = entryRefIds.length
    ? await tx
        .select({ id: contentEntries.id, typeKey: contentTypes.key, status: contentEntries.status })
        .from(contentEntries)
        .innerJoin(contentTypes, eq(contentTypes.id, contentEntries.typeId))
        .where(and(inArray(contentEntries.id, entryRefIds), ne(contentEntries.status, "published")))
    : [];

  const contentVersion = await bumpContentVersion(tx, store.storeId);
  await appendEvent(tx, {
    type: "content.entry.published",
    organizationId: store.organizationId,
    storeId: store.storeId,
    aggregateType: "content_entry",
    aggregateId: entry.id,
    payload: {
      entryId: entry.id,
      typeId: type.id,
      typeKey: type.key,
      versionId: version!.id,
      version: version!.version,
      locales: prepared.locales,
      reason: opts.reason,
      contentVersion,
    },
  });
  await recordAudit(tx, {
    organizationId: store.organizationId,
    storeId: store.storeId,
    action: "content_entry.published",
    resourceType: "content_entry",
    resourceId: entry.id,
    before: live ? { versionId: live.id, version: live.version, locales: live.locales } : { status: entry.status },
    after: { versionId: version!.id, version: version!.version, sourceRevision: source.draftRevision, locales: prepared.locales, slugs: prepared.slugs, reason: opts.reason, significant },
  });
  return { entry: updated!, version: version!, unpublishedDependencies: dependencies };
}

/**
 * Takes an entry off the site (unpublish or archive): closes its live version, clears the live
 * pointer in the same update as the status change, drops its current slugs and live
 * references, bumps the content version. Returns the new content version.
 */
export async function takeDownTx(tx: Transaction, store: StoreInfo, entry: EntryRow, next: { status: "draft" | "archived" }): Promise<number> {
  const scope: Scope = { organizationId: store.organizationId, storeId: store.storeId };
  const now = new Date();
  const live = await openVersion(tx, entry.id);
  if (live) await closeVersion(tx, live.id);
  await tx
    .update(contentEntries)
    .set({
      status: next.status,
      liveVersionId: null,
      publishedRevision: null,
      publishedLocales: [],
      publishAt: null,
      scheduledRevision: null,
      scheduledByPrincipalId: null,
      unpublishAt: null,
      archivedAt: next.status === "archived" ? now : null,
    })
    .where(eq(contentEntries.id, entry.id));
  await tx
    .update(recordSlugs)
    .set({ isCurrent: false })
    .where(and(eq(recordSlugs.resourceType, ENTRY_RESOURCE), eq(recordSlugs.resourceId, entry.id), eq(recordSlugs.isCurrent, true)));
  await setContentReferencesTx(tx, scope, { type: ENTRY_RESOURCE, id: entry.id }, "live", []);
  await syncEntryAssetReferences(tx, scope, entry.id);
  return bumpContentVersion(tx, store.storeId);
}

export async function unpublishEntryTx(tx: Transaction, store: StoreInfo, entryId: string, opts: { reason: "manual" | "scheduled" }): Promise<EntryRow> {
  const entry = await lockEntry(tx, store.storeId, entryId);
  if (entry.status !== "published") throw new AppError("precondition_failed", "errors.content_entry.not_published");
  const type = await entryTypeTx(tx, entry);
  const contentVersion = await takeDownTx(tx, store, entry, { status: "draft" });
  await appendEvent(tx, {
    type: "content.entry.unpublished",
    organizationId: store.organizationId,
    storeId: store.storeId,
    aggregateType: "content_entry",
    aggregateId: entry.id,
    payload: { entryId: entry.id, typeId: type.id, typeKey: type.key, reason: opts.reason, contentVersion },
  });
  await recordAudit(tx, {
    organizationId: store.organizationId,
    storeId: store.storeId,
    action: "content_entry.unpublished",
    resourceType: "content_entry",
    resourceId: entry.id,
    before: { status: entry.status, liveVersionId: entry.liveVersionId, locales: entry.publishedLocales },
    after: { status: "draft", reason: opts.reason },
  });
  const [row] = await tx.select().from(contentEntries).where(eq(contentEntries.id, entry.id));
  return row!;
}

/** Entries whose live version references a record (reverse lists, "used in", cache purge). */
export async function liveReferrers(tx: Transaction, storeId: string, target: { kind: typeof contentReferences.$inferSelect.targetKind; id: string }) {
  return tx
    .select({ sourceId: contentReferences.sourceId, fieldPath: contentReferences.fieldPath })
    .from(contentReferences)
    .where(
      and(
        eq(contentReferences.storeId, storeId),
        eq(contentReferences.sourceType, ENTRY_RESOURCE),
        eq(contentReferences.state, "live"),
        eq(contentReferences.targetKind, target.kind),
        eq(contentReferences.targetId, target.id),
      ),
    );
}
