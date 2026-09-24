import { z } from "zod";
import { AppError, conflict, decodeCursor, encodeCursor, invalid, LOCALE_CODES, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  contentEntries,
  contentTypes,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  recordVersions,
  sql,
  withTenantTx,
  type ContentTranslationState,
  type Database,
  type SeoFields,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { currentContext } from "@altyapi/observability";
import { can, type StoreContext } from "@altyapi/tenancy";
import { compileEntrySchema, fieldValueIn } from "../fields/compile";
import { collectEntryRefs } from "../fields/refs";
import { nextTranslationState, staleTranslations, type TranslationStatus } from "../fields/translation";
import type { FieldDef, LeafFieldDef } from "../fields/types";
import type { Credential } from "../fields/values";
import { CONTENT_LIMITS } from "../limits";
import { isSameSitePath } from "../paths";
import {
  ensureBaseline,
  getRevisionTx,
  listRevisionsTx,
  moveDraftTx,
  nextRevisionNumber,
  recordRevision,
  type DraftActor,
  type DraftAdapter,
  type DraftMove,
  type RevisionMeta,
} from "../revisions";
import type { EffectiveContentType } from "../types/definition";
import {
  contentIssues,
  currentData,
  entryTypeTx,
  lockEntry,
  preparePublicationTx,
  publishEntryTx,
  takeDownTx,
  unpublishEntryTx,
  zodIssues,
  type EntryRow,
} from "./publish";
import {
  assertParentValid,
  assertReferencesValid,
  assertSlugFormat,
  assertSlugsFree,
  assertContent,
  assertTypeActive,
  ENTRY_RESOURCE,
  ENTRY_REVISION_RESOURCE,
  fillSlugs,
  findTypeTx,
  isUniqueViolation,
  orderedLocales,
  scopeOf,
  setContentReferencesTx,
  storeInfoOf,
  syncEntryAssetReferences,
  type Scope,
} from "./shared";

export { ENTRY_REVISION_RESOURCE };

/** Index that allows one non-archived entry per singleton type (content_entries.is_singleton). */
const SINGLETON_INDEX = "content_entries_singleton_uq";

/** The non-archived entry of a singleton type other than `exceptId`, if any. */
async function otherSingletonEntry(tx: Transaction, typeId: string, exceptId: string | null): Promise<string | null> {
  const [row] = await tx
    .select({ id: contentEntries.id })
    .from(contentEntries)
    .where(and(eq(contentEntries.typeId, typeId), ne(contentEntries.status, "archived"), exceptId ? ne(contentEntries.id, exceptId) : undefined))
    .limit(1);
  return row?.id ?? null;
}

/** Runs an insert or status change of a singleton's entry, turning the index's refusal into the domain error. */
async function singletonGuard<T>(typeId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err, SINGLETON_INDEX)) throw conflict("errors.content_entry.singleton_exists", { typeId });
    throw err;
  }
}

/**
 * A scheduled publish puts live the revision a principal with content:publish approved. When
 * such a principal saves or moves the draft of a scheduled entry, the new revision is approved
 * in its place; anyone else's edits stay in the draft and go live only with a later publish.
 */
function schedulePin(entry: EntryRow, revision: number, actor: DraftActor): Partial<EntryRow> {
  if (entry.publishAt === null || !actor.can("content:publish")) return {};
  return { scheduledRevision: revision, scheduledByPrincipalId: actor.principalId };
}

/** The request principal as the actor of a draft change. */
export function draftActorOf(ctx: StoreContext): DraftActor {
  return { principalId: ctx.principal.userId, can: (permission) => can(ctx, permission) };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const localeKey = z.enum(LOCALE_CODES);

export const entrySeoSchema = z.object({
  title: z.partialRecord(localeKey, z.string().trim().max(70)).optional(),
  description: z.partialRecord(localeKey, z.string().trim().max(320)).optional(),
  imageAssetId: z.uuid().nullable().optional(),
  noindex: z.boolean().optional(),
  /** A path on this site (never another host); served in the default language, see buildEntryDto. */
  canonicalPath: z.string().trim().max(500).refine(isSameSitePath, "errors.content.invalid_path").nullable().optional(),
});

/** locale → slug; null or "" removes the draft slug of that language. */
const slugsInput = z.partialRecord(localeKey, z.string().trim().toLowerCase().max(63).nullable());

export const createEntrySchema = z.object({
  /** Content type id or key. */
  type: z.string().min(1).max(64),
  data: z.record(z.string(), z.unknown()).default({}),
  seo: entrySeoSchema.optional(),
  slugs: slugsInput.optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
  /** How translated (non-default language) values in this save were produced. */
  translationStatus: z.enum(["machine", "reviewed", "manual"]).optional(),
});

export const updateEntrySchema = z.object({
  expectedRevision: z.number().int().positive(),
  /** Top-level merge into the draft: a key replaces that field's value, null clears it. */
  data: z.record(z.string(), z.unknown()).optional(),
  seo: entrySeoSchema.optional(),
  slugs: slugsInput.optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
  translationStatus: z.enum(["machine", "reviewed", "manual"]).optional(),
});

export const scheduleEntrySchema = z
  .object({ publishAt: z.coerce.date().nullable(), unpublishAt: z.coerce.date().nullable() })
  .refine((v) => !v.publishAt || !v.unpublishAt || v.publishAt < v.unpublishAt, "errors.content_entry.invalid_schedule");

export const listEntriesQuerySchema = z.object({
  type: z.string().min(1).max(64),
  status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
  q: z.string().trim().max(100).optional(),
  parentId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.adminPageSize).default(50),
  cursor: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// Draft snapshots and the history adapter
// ---------------------------------------------------------------------------

export function entrySnapshot(e: EntryRow): Record<string, unknown> {
  return {
    data: e.draftData,
    seo: e.draftSeo,
    slugs: e.draftSlugs,
    parentId: e.parentId,
    position: e.position,
    translationState: e.translationState,
    schemaVersion: e.schemaVersion,
  };
}

/** Rewrites the draft reference rows and asset references of an entry. */
async function syncDraftReferences(tx: Transaction, scope: Scope, type: EffectiveContentType, entry: Pick<EntryRow, "id" | "draftData" | "draftSeo" | "parentId">) {
  const refs = collectEntryRefs(type.fields, entry.draftData, { seo: entry.draftSeo, parentId: entry.parentId });
  await setContentReferencesTx(tx, scope, { type: ENTRY_RESOURCE, id: entry.id }, "draft", refs);
  await syncEntryAssetReferences(tx, scope, entry.id);
}

/**
 * Draft history of content entries (resource type "entry" in draft_revisions): undo, redo and
 * restore move the draft like they do for pages. A restored slug or parent must still be
 * free and valid.
 */
export const entryDraftAdapter: DraftAdapter = {
  type: ENTRY_REVISION_RESOURCE,
  readPermission: "content:read",
  writePermission: "content:write",
  async load(tx, storeId, id) {
    const [row] = await tx
      .select()
      .from(contentEntries)
      .where(and(eq(contentEntries.id, id), eq(contentEntries.storeId, storeId)))
      .for("update");
    return row ? { revision: row.draftRevision, snapshot: entrySnapshot(row) } : null;
  },
  async apply(tx, scope, id, snap, revision, actor) {
    const entry = await lockEntry(tx, scope.storeId, id);
    if (entry.status === "archived") throw new AppError("precondition_failed", "errors.content_entry.archived");
    const type = await entryTypeTx(tx, entry, { lock: "share" });
    const slugs = (snap.slugs ?? {}) as Record<string, string>;
    const parentId = (snap.parentId as string | null | undefined) ?? null;
    if (type.hasSlugs) await assertSlugsFree(tx, scope.storeId, type, slugs, id, { drafts: true });
    if (parentId !== entry.parentId) await assertParentValid(tx, scope.storeId, type, id, parentId);
    const [updated] = await tx
      .update(contentEntries)
      .set({
        draftData: (snap.data ?? {}) as Record<string, unknown>,
        draftSeo: (snap.seo ?? {}) as SeoFields,
        draftSlugs: slugs,
        parentId,
        position: typeof snap.position === "number" ? snap.position : entry.position,
        translationState: (snap.translationState ?? entry.translationState) as ContentTranslationState,
        schemaVersion: typeof snap.schemaVersion === "number" ? snap.schemaVersion : entry.schemaVersion,
        draftRevision: revision,
        ...schedulePin(entry, revision, actor),
      })
      .where(eq(contentEntries.id, id))
      .returning();
    await syncDraftReferences(tx, scope, type, updated!);
  },
};

// ---------------------------------------------------------------------------
// Draft preparation
// ---------------------------------------------------------------------------

interface LocalizedLeaf {
  path: string;
  field: LeafFieldDef;
  value: unknown;
}

function localizedLeaves(fields: readonly FieldDef[], data: Record<string, unknown>): LocalizedLeaf[] {
  const out: LocalizedLeaf[] = [];
  for (const field of fields) {
    const value = data[field.key];
    if (field.type === "group") {
      const g = (value ?? {}) as Record<string, unknown>;
      for (const c of field.validation.fields) if (c.localized) out.push({ path: `${field.key}.${c.key}`, field: c, value: g[c.key] });
    } else if (field.type === "repeater") {
      ((value as unknown[] | null) ?? []).forEach((item, i) => {
        for (const c of field.validation.fields) if (c.localized) out.push({ path: `${field.key}.${i}.${c.key}`, field: c, value: (item as Record<string, unknown> | null)?.[c.key] });
      });
    } else if (field.localized) out.push({ path: field.key, field, value });
  }
  return out;
}

/**
 * New or changed localized values may only be in languages the store publishes in. Values
 * already stored are compared against, so an entry that still carries a since-disabled
 * language can be saved unchanged.
 */
function assertEditedLocales(fields: readonly FieldDef[], prev: Record<string, unknown>, next: Record<string, unknown>, supported: readonly string[]) {
  const before = new Map(localizedLeaves(fields, prev).map((l) => [l.path, (l.value ?? {}) as Record<string, unknown>]));
  for (const leaf of localizedLeaves(fields, next)) {
    const map = (leaf.value ?? {}) as Record<string, unknown>;
    const old = before.get(leaf.path) ?? {};
    for (const [locale, value] of Object.entries(map)) {
      if (value === null || value === undefined || value === "") continue;
      if (JSON.stringify(value) === JSON.stringify(old[locale] ?? null)) continue;
      if (!supported.includes(locale)) throw invalid("errors.locale.not_enabled", { locale, supported: [...supported], field: `data.${leaf.path}` });
    }
  }
}

function assertEditedSeoLocales(prev: SeoFields, next: SeoFields, supported: readonly string[]) {
  for (const key of ["title", "description"] as const) {
    for (const [locale, text] of Object.entries(next[key] ?? {})) {
      if (!text || text === prev[key]?.[locale]) continue;
      if (!supported.includes(locale)) throw invalid("errors.locale.not_enabled", { locale, supported: [...supported], field: `seo.${key}` });
    }
  }
}

/**
 * Credentials carry a `verified` flag only the site owner may set: for anyone else (other
 * roles, AI actions, imports) a credential keeps the flag it had, and loses it when its
 * identifying facts change.
 */
function protectVerifiedCredentials(fields: readonly FieldDef[], prev: Record<string, unknown>, next: Record<string, unknown>, canVerify: boolean): Record<string, unknown> {
  if (canVerify) return next;
  const identity = (c: Credential) => JSON.stringify([c.kind, c.issuer, c.number ?? null, c.name, c.url ?? null, c.validFrom ?? null, c.validUntil ?? null]);
  const out = { ...next };
  const fix = (field: LeafFieldDef, before: unknown, after: unknown): unknown => {
    if (field.type !== "credentials" || !Array.isArray(after)) return after;
    const verified = new Set(((before as Credential[] | null) ?? []).filter((c) => c.verified).map(identity));
    return (after as Credential[]).map((c) => ({ ...c, verified: verified.has(identity(c)) }));
  };
  for (const field of fields) {
    if (field.type === "group") {
      const g = out[field.key] as Record<string, unknown> | null | undefined;
      if (!g) continue;
      const pg = (prev[field.key] ?? {}) as Record<string, unknown>;
      out[field.key] = Object.fromEntries(Object.entries(g).map(([k, v]) => {
        const child = field.validation.fields.find((c) => c.key === k);
        return [k, child ? fix(child, pg[k], v) : v];
      }));
    } else if (field.type === "repeater") {
      const items = out[field.key] as Record<string, unknown>[] | null | undefined;
      if (!Array.isArray(items)) continue;
      const prevItems = (prev[field.key] as Record<string, unknown>[] | null) ?? [];
      out[field.key] = items.map((item, i) =>
        Object.fromEntries(Object.entries(item ?? {}).map(([k, v]) => {
          const child = field.validation.fields.find((c) => c.key === k);
          return [k, child ? fix(child, prevItems[i]?.[k], v) : v];
        })),
      );
    } else {
      out[field.key] = fix(field, prev[field.key], out[field.key]);
    }
  }
  return out;
}

/** The site owner (site:manage), acting in person: not an AI action or an import. */
function canVerifyCredentials(ctx: StoreContext, meta?: RevisionMeta): boolean {
  if (ctx.principal.kind !== "user") return false;
  if (currentContext()?.agentId || ctx.principal.agentId) return false;
  if (meta?.source === "import" || meta?.source === "ai_action" || meta?.source === "yanit") return false;
  return can(ctx, "site:manage");
}

function mergeData(prev: Record<string, unknown>, patch: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!patch) return prev;
  const out = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function mergeSlugs(prev: Record<string, string>, patch: Record<string, string | null | undefined> | undefined): Record<string, string> {
  const out = { ...prev };
  for (const [locale, slug] of Object.entries(patch ?? {})) {
    if (!slug) delete out[locale];
    else out[locale] = slug;
  }
  return out;
}

interface DraftInput {
  data: Record<string, unknown>;
  seo: SeoFields;
  slugs: Record<string, string>;
  parentId: string | null;
}

/**
 * Validates and normalizes a draft (draft mode: only `always` fields are required), applies
 * the language, size, credential, slug, hierarchy and reference rules, and fills missing slugs
 * from the title.
 */
async function prepareDraft(
  tx: Transaction,
  ctx: StoreContext,
  type: EffectiveContentType,
  next: DraftInput,
  prev: { data: Record<string, unknown>; seo: SeoFields; slugs: Record<string, string>; id: string | null },
  meta: RevisionMeta | undefined,
): Promise<DraftInput> {
  const store = storeInfoOf(ctx);
  // Any registry language parses; assertEditedLocales then limits new text to the store's
  // languages while text already stored in a since-disabled language stays valid.
  const parsed = compileEntrySchema(type, { mode: "draft", locales: [...new Set([...orderedLocales(store), ...LOCALE_CODES])], hiddenFields: type.hiddenFields }).safeParse(next.data);
  if (!parsed.success) contentIssues(zodIssues(parsed.error));
  assertEditedLocales(type.fields, prev.data, parsed.data, store.supportedLocales);
  assertEditedSeoLocales(prev.seo, next.seo, store.supportedLocales);
  const data = protectVerifiedCredentials(type.fields, prev.data, parsed.data, canVerifyCredentials(ctx, meta));
  if (Buffer.byteLength(JSON.stringify(data)) > CONTENT_LIMITS.entryBytes) throw invalid("errors.content_entry.too_large", { maxBytes: CONTENT_LIMITS.entryBytes });

  let slugs: Record<string, string> = {};
  if (type.hasSlugs) {
    const edited = Object.fromEntries(Object.entries(next.slugs).filter(([l, s]) => prev.slugs[l] !== s));
    for (const locale of Object.keys(edited)) {
      if (!store.supportedLocales.includes(locale)) throw invalid("errors.locale.not_enabled", { locale, supported: store.supportedLocales, field: "slugs" });
    }
    assertSlugFormat(type, next.slugs);
    await assertSlugsFree(tx, store.storeId, type, edited, prev.id, { drafts: true });
    slugs = await fillSlugs(tx, store.storeId, type, data, next.slugs, store.supportedLocales, prev.id);
  }
  await assertParentValid(tx, store.storeId, type, prev.id, next.parentId);
  await assertReferencesValid(tx, store.storeId, type, collectEntryRefs(type.fields, data, { seo: next.seo, parentId: next.parentId }));
  return { data, seo: next.seo, slugs, parentId: next.parentId };
}

function translationStatusFor(input: TranslationStatus | undefined): TranslationStatus {
  return input ?? (currentContext()?.agentId ? "machine" : "manual");
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function createEntry(db: Database, ctx: StoreContext, input: z.infer<typeof createEntrySchema>, opts: { revision?: RevisionMeta } = {}): Promise<EntryRow> {
  assertContent(ctx, "content:write");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const { type } = await findTypeTx(tx, ctx.storeId, input.type, { lock: "share" });
    assertTypeActive(type);
    const isSingleton = type.kind === "singleton";
    if (isSingleton) {
      const existing = await otherSingletonEntry(tx, type.id, null);
      if (existing) throw conflict("errors.content_entry.singleton_exists", { entryId: existing });
    }
    const draft = await prepareDraft(
      tx,
      ctx,
      type,
      { data: input.data, seo: (input.seo ?? {}) as SeoFields, slugs: mergeSlugs({}, input.slugs), parentId: input.parentId ?? null },
      { data: {}, seo: {}, slugs: {}, id: null },
      opts.revision,
    );
    let position = input.position;
    if (position === undefined) {
      const [row] = await tx
        .select({ max: sql<number | null>`max(${contentEntries.position})` })
        .from(contentEntries)
        .where(and(eq(contentEntries.typeId, type.id), draft.parentId ? eq(contentEntries.parentId, draft.parentId) : isNull(contentEntries.parentId)));
      position = row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
    }
    // Two concurrent creates of a singleton's entry both pass the check above; the partial
    // unique index refuses the second.
    const [row] = await singletonGuard(type.id, () =>
      tx
        .insert(contentEntries)
        .values({
          id: newId(),
          ...scope,
          typeId: type.id,
          parentId: draft.parentId,
          draftData: draft.data,
          draftSeo: draft.seo,
          draftSlugs: draft.slugs,
          schemaVersion: type.version,
          position,
          isSingleton,
          translationState: nextTranslationState(type.fields, {}, draft.data, {}, ctx.store.defaultLocale, translationStatusFor(input.translationStatus)),
          createdByPrincipalId: ctx.principal.userId,
          updatedByPrincipalId: ctx.principal.userId,
        })
        .returning(),
    );
    await recordRevision(tx, scope, {
      type: ENTRY_REVISION_RESOURCE,
      id: row!.id,
      revision: row!.draftRevision,
      parent: null,
      snapshot: entrySnapshot(row!),
      ...(opts.revision ? { meta: opts.revision } : {}),
    });
    await syncDraftReferences(tx, scope, type, row!);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_entry.created",
      resourceType: "content_entry",
      resourceId: row!.id,
      after: { typeKey: type.key, slugs: draft.slugs, ...(opts.revision?.source ? { source: opts.revision.source } : {}) },
    });
    return row!;
  });
}

/**
 * Saves the draft of an entry (optimistic concurrency on expectedRevision) as a new draft
 * revision; the live version (its fields, parent and position alike) is untouched until the
 * next publish. On a scheduled entry, a save by a publisher re-approves the schedule.
 */
export async function updateEntryDraft(db: Database, ctx: StoreContext, entryId: string, input: z.infer<typeof updateEntrySchema>, opts: { revision?: RevisionMeta } = {}): Promise<EntryRow> {
  assertContent(ctx, "content:write");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const entry = await lockEntry(tx, ctx.storeId, entryId);
    if (entry.status === "archived") throw new AppError("precondition_failed", "errors.content_entry.archived");
    if (entry.draftRevision !== input.expectedRevision) throw conflict("errors.content.revision_conflict", { currentRevision: entry.draftRevision });
    const type = await entryTypeTx(tx, entry, { lock: "share" });
    assertTypeActive(type);
    const { data: base } = currentData(type, entry);
    const draft = await prepareDraft(
      tx,
      ctx,
      type,
      {
        data: mergeData(base, input.data),
        seo: (input.seo as SeoFields | undefined) ?? entry.draftSeo,
        slugs: mergeSlugs(entry.draftSlugs, input.slugs),
        parentId: input.parentId === undefined ? entry.parentId : input.parentId,
      },
      { data: base, seo: entry.draftSeo, slugs: entry.draftSlugs, id: entry.id },
      opts.revision,
    );
    await ensureBaseline(tx, scope, ENTRY_REVISION_RESOURCE, entry.id, entry.draftRevision, entrySnapshot(entry));
    const revision = await nextRevisionNumber(tx, ENTRY_REVISION_RESOURCE, entry.id, entry.draftRevision);
    const [updated] = await tx
      .update(contentEntries)
      .set({
        draftData: draft.data,
        draftSeo: draft.seo,
        draftSlugs: draft.slugs,
        parentId: draft.parentId,
        position: input.position ?? entry.position,
        schemaVersion: type.version,
        translationState: nextTranslationState(type.fields, base, draft.data, entry.translationState, ctx.store.defaultLocale, translationStatusFor(input.translationStatus)),
        draftRevision: revision,
        updatedByPrincipalId: ctx.principal.userId,
        ...schedulePin(entry, revision, draftActorOf(ctx)),
      })
      .where(eq(contentEntries.id, entry.id))
      .returning();
    await recordRevision(tx, scope, {
      type: ENTRY_REVISION_RESOURCE,
      id: entry.id,
      revision,
      parent: entry.draftRevision,
      snapshot: entrySnapshot(updated!),
      ...(opts.revision ? { meta: opts.revision } : {}),
    });
    await syncDraftReferences(tx, scope, type, updated!);
    return updated!;
  });
}

/** Publishes the current draft (optionally only if it is still at expectedRevision). */
export async function publishEntry(db: Database, ctx: StoreContext, entryId: string, input: { expectedRevision?: number | undefined } = {}) {
  assertContent(ctx, "content:publish");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    publishEntryTx(tx, storeInfoOf(ctx), entryId, { principalId: ctx.principal.userId, reason: "manual", expectedRevision: input.expectedRevision }),
  );
}

export async function unpublishEntry(db: Database, ctx: StoreContext, entryId: string): Promise<EntryRow> {
  assertContent(ctx, "content:publish");
  return withTenantTx(db, scopeOf(ctx), (tx) => unpublishEntryTx(tx, storeInfoOf(ctx), entryId, { reason: "manual" }));
}

/**
 * Sets when the draft goes live (publishAt) and when the live version comes down
 * (unpublishAt). A live entry with publishAt gets a scheduled update and stays published until
 * then. Scheduling approves the current draft revision: that revision is what goes live, even
 * if someone without content:publish edits the draft in the meantime (schedulePin). The draft
 * is checked now, so an unattended publish does not fail on something the merchant could have
 * fixed.
 */
export async function scheduleEntry(db: Database, ctx: StoreContext, entryId: string, input: z.infer<typeof scheduleEntrySchema>): Promise<EntryRow> {
  assertContent(ctx, "content:publish");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const entry = await lockEntry(tx, ctx.storeId, entryId);
    if (entry.status === "archived") throw new AppError("precondition_failed", "errors.content_entry.archived");
    const type = await entryTypeTx(tx, entry, { lock: "share" });
    const live = entry.status === "published";
    if (input.unpublishAt && !live && !input.publishAt) throw invalid("errors.content_entry.unpublish_without_publish");
    if (input.publishAt) {
      await preparePublicationTx(tx, storeInfoOf(ctx), type, entry);
      // The scheduler publishes the approved revision's snapshot: make sure it is recorded.
      await ensureBaseline(tx, scope, ENTRY_REVISION_RESOURCE, entry.id, entry.draftRevision, entrySnapshot(entry));
    }
    const status: EntryRow["status"] = live ? "published" : input.publishAt ? "scheduled" : "draft";
    const pin = input.publishAt
      ? { scheduledRevision: entry.draftRevision, scheduledByPrincipalId: ctx.principal.userId }
      : { scheduledRevision: null, scheduledByPrincipalId: null };
    const [updated] = await tx
      .update(contentEntries)
      .set({ publishAt: input.publishAt, unpublishAt: input.unpublishAt, status, ...pin })
      .where(eq(contentEntries.id, entry.id))
      .returning();
    await appendEvent(tx, {
      type: "content.entry.scheduled",
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      aggregateType: "content_entry",
      aggregateId: entry.id,
      payload: {
        entryId: entry.id,
        typeId: type.id,
        publishAt: input.publishAt?.toISOString() ?? null,
        unpublishAt: input.unpublishAt?.toISOString() ?? null,
        scheduledRevision: pin.scheduledRevision,
      },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_entry.scheduled",
      resourceType: "content_entry",
      resourceId: entry.id,
      before: { status: entry.status, publishAt: entry.publishAt, unpublishAt: entry.unpublishAt, scheduledRevision: entry.scheduledRevision },
      after: { status, publishAt: input.publishAt, unpublishAt: input.unpublishAt, scheduledRevision: pin.scheduledRevision },
    });
    return updated!;
  });
}

/** Archives an entry: hidden from lists and editors' default views, taken off the site if live. */
export async function archiveEntry(db: Database, ctx: StoreContext, entryId: string): Promise<EntryRow> {
  assertContent(ctx, "content:write");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const entry = await lockEntry(tx, ctx.storeId, entryId);
    if (entry.status === "archived") return entry;
    const wasLive = entry.status === "published";
    if (wasLive) assertContent(ctx, "content:publish");
    const type = await entryTypeTx(tx, entry);
    let contentVersion: number | null = null;
    if (wasLive) contentVersion = await takeDownTx(tx, storeInfoOf(ctx), entry, { status: "archived" });
    else {
      await tx
        .update(contentEntries)
        .set({ status: "archived", archivedAt: new Date(), publishAt: null, scheduledRevision: null, scheduledByPrincipalId: null, unpublishAt: null })
        .where(eq(contentEntries.id, entry.id));
    }
    await appendEvent(tx, {
      type: "content.entry.archived",
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      aggregateType: "content_entry",
      aggregateId: entry.id,
      payload: { entryId: entry.id, typeId: type.id, wasLive, contentVersion },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_entry.archived",
      resourceType: "content_entry",
      resourceId: entry.id,
      before: { status: entry.status },
      after: { status: "archived", wasLive },
    });
    const [row] = await tx.select().from(contentEntries).where(eq(contentEntries.id, entry.id));
    return row!;
  });
}

/**
 * Brings an archived entry back as a draft (its old slugs are free again only if nobody took
 * them). A singleton's entry comes back only while the type has no other entry.
 */
export async function unarchiveEntry(db: Database, ctx: StoreContext, entryId: string): Promise<EntryRow> {
  assertContent(ctx, "content:write");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const entry = await lockEntry(tx, ctx.storeId, entryId);
    if (entry.status !== "archived") throw new AppError("precondition_failed", "errors.content_entry.not_archived");
    const type = await entryTypeTx(tx, entry, { lock: "share" });
    assertTypeActive(type);
    if (entry.isSingleton) {
      const existing = await otherSingletonEntry(tx, type.id, entry.id);
      if (existing) throw conflict("errors.content_entry.singleton_exists", { entryId: existing });
    }
    if (type.hasSlugs) await assertSlugsFree(tx, ctx.storeId, type, entry.draftSlugs, entry.id, { drafts: true });
    if (entry.parentId) await assertParentValid(tx, ctx.storeId, type, entry.id, entry.parentId);
    const [row] = await singletonGuard(type.id, () =>
      tx.update(contentEntries).set({ status: "draft", archivedAt: null }).where(eq(contentEntries.id, entry.id)).returning(),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_entry.unarchived",
      resourceType: "content_entry",
      resourceId: entry.id,
      before: { status: "archived" },
      after: { status: "draft" },
    });
    return row!;
  });
}

const COPY_SUFFIX: Record<string, string> = { tr: " (kopya)", en: " (copy)", de: " (Kopie)", fr: " (copie)", ru: " (копия)", ar: " (نسخة)" };

/** A new draft with the entry's draft content, a "(kopya)" title and free slugs. */
export async function duplicateEntry(db: Database, ctx: StoreContext, entryId: string): Promise<EntryRow> {
  assertContent(ctx, "content:write");
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, async (tx) => {
    const [source] = await tx.select().from(contentEntries).where(and(eq(contentEntries.id, entryId), eq(contentEntries.storeId, ctx.storeId)));
    if (!source) throw notFound("content_entry", entryId);
    const type = await entryTypeTx(tx, source, { lock: "share" });
    assertTypeActive(type);
    if (type.kind === "singleton") throw conflict("errors.content_entry.singleton_exists", { entryId: source.id });
    const { data: base } = currentData(type, source);
    const data = { ...base };
    const titleField = type.fields.find((f) => f.key === type.titleField);
    const title = data[type.titleField];
    if (titleField?.type === "text") {
      const max = titleField.validation.maxLength;
      const withSuffix = (text: string, locale: string) => `${text.slice(0, max - (COPY_SUFFIX[locale] ?? COPY_SUFFIX.en!).length)}${COPY_SUFFIX[locale] ?? COPY_SUFFIX.en}`;
      if (titleField.localized && title && typeof title === "object") {
        data[type.titleField] = Object.fromEntries(Object.entries(title as Record<string, string>).map(([l, t]) => [l, t ? withSuffix(t, l) : t]));
      } else if (typeof title === "string" && title) data[type.titleField] = withSuffix(title, ctx.store.defaultLocale);
    }
    const slugs = await fillSlugs(tx, ctx.storeId, type, data, {}, ctx.store.supportedLocales, null);
    const [row] = await tx
      .insert(contentEntries)
      .values({
        id: newId(),
        ...scope,
        typeId: type.id,
        parentId: source.parentId,
        draftData: data,
        draftSeo: source.draftSeo,
        draftSlugs: slugs,
        schemaVersion: type.version,
        position: source.position + 1,
        translationState: source.translationState,
        createdByPrincipalId: ctx.principal.userId,
        updatedByPrincipalId: ctx.principal.userId,
      })
      .returning();
    await recordRevision(tx, scope, {
      type: ENTRY_REVISION_RESOURCE,
      id: row!.id,
      revision: row!.draftRevision,
      parent: null,
      snapshot: entrySnapshot(row!),
      meta: { source: "duplicate", label: `duplicate:${source.id}` },
    });
    await syncDraftReferences(tx, scope, type, row!);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_entry.duplicated",
      resourceType: "content_entry",
      resourceId: row!.id,
      after: { sourceId: source.id, typeKey: type.key, slugs },
    });
    return row!;
  });
}

/** Title of an entry in a language (falling back to the default language, then any). */
function titleOf(type: EffectiveContentType, data: Record<string, unknown>, locale: string, fallback: string): string {
  const field = type.fields.find((f) => f.key === type.titleField);
  if (!field) return "";
  const v = fieldValueIn(field, data[type.titleField], locale) ?? fieldValueIn(field, data[type.titleField], fallback);
  if (typeof v === "string" && v) return v;
  if (field.localized && data[type.titleField] && typeof data[type.titleField] === "object") {
    return Object.values(data[type.titleField] as Record<string, string>).find((t) => typeof t === "string" && t) ?? "";
  }
  return "";
}

/** Admin list of a type's entries, most recently edited first (keyset pagination). */
export async function listEntries(db: Database, ctx: StoreContext, query: z.infer<typeof listEntriesQuerySchema>) {
  assertContent(ctx, "content:read");
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { type } = await findTypeTx(tx, ctx.storeId, query.type);
    const search = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await tx
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.storeId, ctx.storeId),
          eq(contentEntries.typeId, type.id),
          query.status ? eq(contentEntries.status, query.status) : ne(contentEntries.status, "archived"),
          query.parentId ? eq(contentEntries.parentId, query.parentId) : undefined,
          search ? sql`(${contentEntries.draftData} -> ${type.titleField})::text ilike ${search}` : undefined,
          after ? sql`(${contentEntries.updatedAt}, ${contentEntries.id}) < (${new Date(String(after[0])).toISOString()}::timestamptz, ${String(after[1])}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(contentEntries.updatedAt), desc(contentEntries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const defaultLocale = ctx.store.defaultLocale;
    return {
      items: page.map((e) => ({
        id: e.id,
        typeId: e.typeId,
        title: titleOf(type, e.draftData, defaultLocale, defaultLocale),
        status: e.status,
        slugs: e.draftSlugs,
        publishedLocales: e.publishedLocales,
        hasUnpublishedChanges: e.publishedRevision !== e.draftRevision,
        draftRevision: e.draftRevision,
        parentId: e.parentId,
        position: e.position,
        publishAt: e.publishAt,
        /** Draft revision the scheduled publish puts live (edits after it stay in the draft). */
        scheduledRevision: e.scheduledRevision,
        unpublishAt: e.unpublishAt,
        firstPublishedAt: e.firstPublishedAt,
        contentModifiedAt: e.contentModifiedAt,
        updatedAt: e.updatedAt,
        columns: Object.fromEntries(type.fields.filter((f) => f.listColumn && !type.hiddenFields.has(f.key) && f.key !== type.titleField).map((f) => [f.key, fieldValueIn(f, e.draftData[f.key], defaultLocale) ?? null])),
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.updatedAt.toISOString(), last.id]) : null,
    };
  });
}

/** An entry for the editor: draft, live version summary, pending translations. */
export async function getEntry(db: Database, ctx: StoreContext, entryId: string) {
  assertContent(ctx, "content:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [entry] = await tx.select().from(contentEntries).where(and(eq(contentEntries.id, entryId), eq(contentEntries.storeId, ctx.storeId)));
    if (!entry) throw notFound("content_entry", entryId);
    const type = await entryTypeTx(tx, entry);
    const { data, upgraded } = currentData(type, entry);
    const live = entry.liveVersionId
      ? (
          await tx
            .select({ id: recordVersions.id, version: recordVersions.version, locales: recordVersions.locales, liveFrom: recordVersions.liveFrom, sourceRevision: recordVersions.sourceRevision })
            .from(recordVersions)
            .where(eq(recordVersions.id, entry.liveVersionId))
        )[0] ?? null
      : null;
    const [{ versions }] = (await tx
      .select({ versions: sql<number>`count(*)::int` })
      .from(recordVersions)
      .where(and(eq(recordVersions.resourceType, ENTRY_RESOURCE), eq(recordVersions.resourceId, entry.id)))) as [{ versions: number }];
    return {
      entry: { ...entry, draftData: data },
      type: { id: type.id, key: type.key, kind: type.kind, titleField: type.titleField, hasSlugs: type.hasSlugs, routable: type.routable, version: type.version },
      schemaUpgradePending: upgraded,
      title: titleOf(type, data, ctx.store.defaultLocale, ctx.store.defaultLocale),
      hasUnpublishedChanges: entry.publishedRevision !== entry.draftRevision,
      live,
      versionCount: versions,
      staleTranslations: staleTranslations(type.fields, data, entry.translationState, ctx.store.defaultLocale),
    };
  });
}

/** Published versions of an entry, newest first ("what was live when"). */
export async function listEntryVersions(db: Database, ctx: StoreContext, entryId: string, limit = 50) {
  assertContent(ctx, "content:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [entry] = await tx.select({ id: contentEntries.id }).from(contentEntries).where(and(eq(contentEntries.id, entryId), eq(contentEntries.storeId, ctx.storeId)));
    if (!entry) throw notFound("content_entry", entryId);
    return tx
      .select({
        id: recordVersions.id,
        version: recordVersions.version,
        locales: recordVersions.locales,
        liveFrom: recordVersions.liveFrom,
        liveTo: recordVersions.liveTo,
        sourceRevision: recordVersions.sourceRevision,
        publishedByPrincipalId: recordVersions.publishedByPrincipalId,
      })
      .from(recordVersions)
      .where(and(eq(recordVersions.resourceType, ENTRY_RESOURCE), eq(recordVersions.resourceId, entryId)))
      .orderBy(desc(recordVersions.version))
      .limit(Math.min(Math.max(limit, 1), 200));
  });
}

// ---------------------------------------------------------------------------
// History (the same operations theme-engine exposes for pages)
// ---------------------------------------------------------------------------

export async function listEntryRevisions(db: Database, ctx: StoreContext, entryId: string, limit = 100) {
  assertContent(ctx, entryDraftAdapter.readPermission);
  return withTenantTx(db, scopeOf(ctx), (tx) => listRevisionsTx(tx, ctx.storeId, entryDraftAdapter, entryId, limit));
}

export async function getEntryRevision(db: Database, ctx: StoreContext, entryId: string, revision: number) {
  assertContent(ctx, entryDraftAdapter.readPermission);
  return withTenantTx(db, scopeOf(ctx), (tx) => getRevisionTx(tx, ctx.storeId, ENTRY_REVISION_RESOURCE, entryId, revision));
}

/** Undo / redo / restore on an entry draft. */
export async function moveEntryDraft(db: Database, ctx: StoreContext, entryId: string, op: DraftMove, expectedRevision: number) {
  assertContent(ctx, entryDraftAdapter.writePermission);
  const scope = scopeOf(ctx);
  return withTenantTx(db, scope, (tx) => moveDraftTx(tx, scope, entryDraftAdapter, entryId, op, expectedRevision, draftActorOf(ctx)));
}

/** Entry counts per active type and status (admin navigation badges). */
export async function entryCountsByType(db: Database, ctx: StoreContext) {
  assertContent(ctx, "content:read");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    tx
      .select({ typeId: contentEntries.typeId, status: contentEntries.status, count: sql<number>`count(*)::int` })
      .from(contentEntries)
      .innerJoin(contentTypes, eq(contentTypes.id, contentEntries.typeId))
      .where(and(eq(contentEntries.storeId, ctx.storeId), inArray(contentTypes.status, ["active"])))
      .groupBy(contentEntries.typeId, contentEntries.status)
      .orderBy(asc(contentEntries.typeId)),
  );
}
