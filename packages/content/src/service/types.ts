import { z } from "zod";
import { AppError, conflict, invalid, LOCALE_CODES, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  contentEntries,
  contentTypes,
  eq,
  inArray,
  isNull,
  ne,
  pages,
  pageVersions,
  publications,
  recordSlugs,
  siteProfiles,
  sql,
  storefrontState,
  withTenantTx,
  type ContentTypeSettings,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { isReservedPathSegment } from "@altyapi/site";
import { appendEvent } from "@altyapi/events";
import type { StoreContext } from "@altyapi/tenancy";
import { toJsonSchema } from "../fields/compile";
import { countFields, customFieldDefsSchema, fieldLabel, type FieldDef } from "../fields/types";
import { CONTENT_LIMITS } from "../limits";
import { isValidPrefix, localizedPath } from "../paths";
import { releasePath, savePathRedirect } from "../redirects";
import {
  customTitleField,
  geoFieldset,
  RESERVED_FIELD_KEYS,
  servesIndexRoute,
  typePrefixFor,
  type ContentTypeDefinition,
  type ContentTypeRow,
  type EffectiveContentType,
} from "../types/definition";
import { CONTENT_TYPE_DEFINITIONS, getContentTypeDefinition } from "../types/registry";
import { zodIssues, contentIssues } from "./publish";
import { activeTypesTx, assertContent, bumpContentVersion, effectiveType, findTypeTx, orderedLocales, scopeOf, storeInfoOf, type StoreInfo } from "./shared";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const localeKey = z.enum(LOCALE_CODES);

export const contentTypeKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "errors.content_type.invalid_key");

const labelsSchema = z.object({ name: fieldLabel, namePlural: fieldLabel });

/** locale → URL prefix ("hizmetler", "en" → "services"); up to three path segments. */
const routePrefixSchema = z.partialRecord(localeKey, z.string().trim().toLowerCase().max(100));

const settingsSchema = z.object({
  hiddenFields: z.array(z.string().max(48)).max(CONTENT_LIMITS.fieldsPerType).optional(),
  defaultSort: z.object({ field: z.enum(["publishedAt", "updatedAt", "position", "title"]), direction: z.enum(["asc", "desc"]) }).optional(),
  indexMode: z.enum(["auto", "page", "none"]).optional(),
  hierarchical: z.boolean().optional(),
  maxDepth: z.number().int().min(1).max(10).optional(),
});

export const installTypeSchema = z.object({
  /** Handle of the installed type (default: the built-in key); a pack installs service as "practice_area". */
  key: contentTypeKeySchema.optional(),
  labels: labelsSchema.optional(),
  /** Overrides of the default prefixes, per language. */
  routePrefix: routePrefixSchema.optional(),
  settings: settingsSchema.optional(),
  /** Extra fields of this site (FieldDef[]). */
  customFields: z.array(z.unknown()).max(CONTENT_LIMITS.fieldsPerType).optional(),
});

export const createCustomTypeSchema = z.object({
  key: contentTypeKeySchema,
  kind: z.enum(["collection", "singleton", "taxonomy"]),
  labels: labelsSchema,
  /** {} = entries have no URL of their own. */
  routePrefix: routePrefixSchema.default({}),
  settings: settingsSchema.default({}),
  fields: z.array(z.unknown()).max(CONTENT_LIMITS.fieldsPerType),
});

export const updateTypeSchema = z.object({
  labels: labelsSchema.optional(),
  /** Full replacement of the prefixes; {} removes the type's routes. */
  routePrefix: routePrefixSchema.optional(),
  settings: settingsSchema.optional(),
  /** Full replacement of the site's own fields. */
  customFields: z.array(z.unknown()).max(CONTENT_LIMITS.fieldsPerType).optional(),
});

/** The type a hook runs for, with the store it belongs to. */
export interface ContentTypeHookTarget {
  organizationId: string;
  storeId: string;
  typeId: string;
  key: string;
  builtinKey: string | null;
  kind: ContentTypeRow["kind"];
  labels: ContentTypeRow["labels"];
  routable: boolean;
}

/**
 * Callbacks the caller injects (content sits below theme-engine and cannot call it): the API
 * passes theme-engine's entryTemplateHooks so a type's draft template pages are created in the
 * same transaction.
 */
export interface ContentTypeHooks {
  /** Runs inside the transaction that installs or creates a type. */
  onInstalled?: (tx: Transaction, type: ContentTypeHookTarget) => Promise<void>;
  /** Runs inside updateType's transaction when a type without routes gets URL prefixes. */
  onRoutable?: (tx: Transaction, type: ContentTypeHookTarget) => Promise<void>;
}

function hookTarget(row: ContentTypeRow, routable: boolean): ContentTypeHookTarget {
  return {
    organizationId: row.organizationId,
    storeId: row.storeId,
    typeId: row.id,
    key: row.key,
    builtinKey: row.builtinKey,
    kind: row.kind,
    labels: row.labels,
    routable,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function cleanPrefixes(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0));
}

/**
 * URL prefixes must be well-formed, stay out of system routes and language prefixes, and not
 * overlap another active type's prefix in the same language ("blog" and "blog/haberler"
 * would shadow each other's entries).
 */
async function assertPrefixesAvailable(tx: Transaction, storeId: string, typeId: string | null, prefixes: Record<string, string>): Promise<void> {
  if (!Object.keys(prefixes).length) return;
  for (const [locale, prefix] of Object.entries(prefixes)) {
    const first = prefix.split("/")[0]!;
    if (!isValidPrefix(prefix)) throw invalid("errors.content_type.invalid_prefix", { locale, prefix });
    if (isReservedPathSegment(first)) throw invalid("errors.content_type.prefix_reserved", { locale, prefix });
  }
  const others = (await activeTypesTx(tx, storeId)).filter((t) => t.id !== typeId && t.routable);
  const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  for (const locale of LOCALE_CODES) {
    const mine = typePrefixFor({ routePrefix: prefixes }, locale);
    if (!mine) continue;
    for (const other of others) {
      const theirs = typePrefixFor(other, locale);
      if (theirs && overlaps(mine, theirs)) throw conflict("errors.content_type.prefix_taken", { locale, prefix: mine, typeKey: other.key });
    }
  }
}

/**
 * With root-level page URLs (site_profiles.page_url_style = 'root'), a page is served at
 * /{handle}. A type that answers /{prefix} itself must not take the path of a page, drafted or
 * live, or that page would disappear behind it.
 */
async function assertRootPagesClear(tx: Transaction, storeId: string, prefixes: Record<string, string>, kind: ContentTypeRow["kind"], settings: ContentTypeSettings): Promise<void> {
  if (!servesIndexRoute({ kind, settings })) return;
  const segments = [...new Set(Object.values(prefixes).filter((p) => !p.includes("/")))];
  if (!segments.length) return;
  const [profile] = await tx.select({ style: siteProfiles.pageUrlStyle }).from(siteProfiles).where(eq(siteProfiles.storeId, storeId));
  if (profile?.style !== "root") return;
  const [draft] = await tx
    .select({ handle: pages.handle })
    .from(pages)
    .where(and(eq(pages.storeId, storeId), inArray(pages.type, ["page", "landing"]), inArray(pages.handle, segments)))
    .limit(1);
  if (draft) throw conflict("errors.content_type.prefix_taken_by_page", { prefix: draft.handle });
  const [live] = await tx
    .select({ handle: pageVersions.handle })
    .from(storefrontState)
    .innerJoin(publications, eq(publications.id, storefrontState.activePublicationId))
    .innerJoin(pageVersions, sql`${pageVersions.id}::text in (select e.value from jsonb_each_text(${publications.pageVersions}) as e)`)
    .where(and(eq(storefrontState.storeId, storeId), inArray(pageVersions.type, ["page", "landing"]), inArray(pageVersions.handle, segments)))
    .limit(1);
  if (live) throw conflict("errors.content_type.prefix_taken_by_page", { prefix: live.handle });
}

/** Only optional fields can be hidden; the title never. */
function assertSettings(kind: ContentTypeRow["kind"], fields: readonly FieldDef[], titleField: string, settings: ContentTypeSettings): void {
  for (const key of settings.hiddenFields ?? []) {
    const field = fields.find((f) => f.key === key);
    if (!field || field.required || key === titleField) throw invalid("errors.content_type.field_not_hideable", { field: key });
  }
  if (settings.hierarchical && kind === "singleton") throw invalid("errors.content_type.singleton_not_hierarchical");
}

/**
 * Parses the site's own fields: the custom-type field set (no built-in-only types), keys clear
 * of entry columns, GEO fields and the built-in fields they extend, within the field limit.
 */
function parseCustomFields(input: unknown[], opts: { builtinFields: readonly FieldDef[]; routable: boolean; custom: boolean }): FieldDef[] {
  const parsed = customFieldDefsSchema.safeParse(input);
  if (!parsed.success) contentIssues(zodIssues(parsed.error, "fields"));
  let fields = parsed.data;
  const builtinKeys = new Set(opts.builtinFields.map((f) => f.key));
  for (const f of fields) {
    if (RESERVED_FIELD_KEYS.has(f.key) || builtinKeys.has(f.key)) throw invalid("errors.content_type.field_key_reserved", { field: f.key });
  }
  if (opts.custom) {
    const title = fields.find((f) => f.key === "title");
    // The title is the entry's H1 and card title: always required, and public.
    if (title && (title.type !== "text" || title.required !== "always" || title.visibility !== "public")) throw invalid("errors.content_type.invalid_title_field");
    if (!title) fields = [customTitleField(), ...fields];
  }
  const geo = opts.custom && opts.routable ? geoFieldset() : [];
  const total = countFields([...opts.builtinFields, ...fields, ...geo]);
  if (total > CONTENT_LIMITS.fieldsPerType) throw invalid("errors.content_type.too_many_fields", { max: CONTENT_LIMITS.fieldsPerType, actual: total });
  return fields;
}

/** A field keeps its type and localization once entries may hold data for it. */
function assertFieldsCompatible(before: readonly FieldDef[], after: readonly FieldDef[]): void {
  for (const next of after) {
    const prev = before.find((f) => f.key === next.key);
    if (!prev) continue;
    if (prev.type !== next.type) throw invalid("errors.content_type.field_type_immutable", { field: next.key });
    if (prev.localized !== next.localized) throw invalid("errors.content_type.field_localization_immutable", { field: next.key });
  }
}

async function assertCustomTypeQuota(tx: Transaction, storeId: string): Promise<void> {
  const [{ count }] = (await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(contentTypes)
    .where(and(eq(contentTypes.storeId, storeId), isNull(contentTypes.builtinKey), eq(contentTypes.status, "active")))) as [{ count: number }];
  if (count >= CONTENT_LIMITS.customTypesPerStore) throw new AppError("precondition_failed", "errors.content_type.limit_reached", { max: CONTENT_LIMITS.customTypesPerStore });
}

/**
 * Keeps old URLs working when a type's prefixes change: per store language, a moved prefix
 * gets a 301 prefix redirect (/blog/x → /yazilar/x), a removed prefix under which entries were
 * live answers 410 Gone, and a newly used prefix stops redirecting.
 */
async function redirectPrefixChanges(tx: Transaction, store: StoreInfo, typeId: string, before: Record<string, string>, after: Record<string, string>): Promise<boolean> {
  let changed = false;
  for (const locale of orderedLocales(store)) {
    const oldPrefix = typePrefixFor({ routePrefix: before }, locale);
    const newPrefix = typePrefixFor({ routePrefix: after }, locale);
    if (oldPrefix === newPrefix) continue;
    changed = true;
    const from = oldPrefix ? localizedPath(locale, store.defaultLocale, `/${oldPrefix}`) : null;
    const to = newPrefix ? localizedPath(locale, store.defaultLocale, `/${newPrefix}`) : null;
    if (from && to) {
      await savePathRedirect(tx, store, { fromPath: from, toPath: to, statusCode: 301, matchType: "prefix", source: "prefix_change" });
    } else if (from) {
      const [live] = await tx
        .select({ id: recordSlugs.id })
        .from(recordSlugs)
        .where(and(eq(recordSlugs.storeId, store.storeId), eq(recordSlugs.scopeKey, typeId), eq(recordSlugs.locale, locale), eq(recordSlugs.isCurrent, true)))
        .limit(1);
      if (live) await savePathRedirect(tx, store, { fromPath: from, toPath: null, statusCode: 410, matchType: "prefix", source: "prefix_removed" });
    } else if (to) {
      await releasePath(tx, store.storeId, to);
    }
  }
  return changed;
}

function typeSummary(row: ContentTypeRow, type: EffectiveContentType) {
  const def = row.builtinKey ? getContentTypeDefinition(row.builtinKey) : undefined;
  return {
    id: row.id,
    key: row.key,
    builtinKey: row.builtinKey,
    builtinVersion: row.builtinVersion,
    upgradeAvailable: Boolean(def && row.builtinVersion !== null && row.builtinVersion < def.version),
    kind: row.kind,
    status: row.status,
    labels: row.labels,
    routePrefix: row.routePrefix,
    settings: row.settings,
    routable: type.routable,
    hasSlugs: type.hasSlugs,
    titleField: type.titleField,
    fieldCount: countFields(type.fields),
    taxonomies: type.taxonomies.map((t) => ({ field: t.field, typeKey: t.typeKey, archiveSegment: t.archiveSegment })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function announce(tx: Transaction, ctx: StoreContext, row: ContentTypeRow, change: "installed" | "created" | "updated" | "archived", prefixesChanged: boolean) {
  const contentVersion = await bumpContentVersion(tx, ctx.storeId);
  await appendEvent(tx, {
    type: "content.type.changed",
    organizationId: ctx.organizationId,
    storeId: ctx.storeId,
    aggregateType: "content_type",
    aggregateId: row.id,
    payload: { typeId: row.id, typeKey: row.key, change, prefixesChanged, contentVersion },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Built-in types a site can install (with what they bring along). */
export function listBuiltinTypes() {
  return CONTENT_TYPE_DEFINITIONS.map((d) => ({
    key: d.key,
    version: d.version,
    kind: d.kind,
    labels: d.labels,
    description: d.description,
    routable: d.routing !== null,
    defaultPrefixes: d.routing?.prefixes ?? {},
    requires: d.requires,
    schemaOrg: d.schemaOrg,
  }));
}

export async function listTypes(db: Database, ctx: StoreContext, opts: { includeArchived?: boolean } = {}) {
  assertContent(ctx, "content:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const rows = await tx
      .select()
      .from(contentTypes)
      .where(and(eq(contentTypes.storeId, ctx.storeId), opts.includeArchived ? undefined : eq(contentTypes.status, "active")))
      .orderBy(asc(contentTypes.key));
    return rows.map((row) => typeSummary(row, effectiveType(row)));
  });
}

/** A type for the editor: its fields (hidden ones flagged) and the JSON Schema of entry data. */
export async function getType(db: Database, ctx: StoreContext, typeRef: string) {
  assertContent(ctx, "content:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { row, type } = await findTypeTx(tx, ctx.storeId, typeRef);
    return {
      ...typeSummary(row, type),
      fields: type.fields.map((f) => ({ ...f, hidden: type.hiddenFields.has(f.key), custom: type.customFieldKeys.has(f.key) })),
      customFields: row.customFields,
      jsonSchema: toJsonSchema(type, { locales: orderedLocales(storeInfoOf(ctx)), hiddenFields: type.hiddenFields }),
    };
  });
}

// ---------------------------------------------------------------------------
// Install / create / update / archive
// ---------------------------------------------------------------------------

async function installTx(
  tx: Transaction,
  ctx: StoreContext,
  def: ContentTypeDefinition,
  input: z.infer<typeof installTypeSchema>,
  hooks: ContentTypeHooks | undefined,
  chain: string[],
): Promise<ContentTypeRow> {
  // Required types first (post brings its category and tag taxonomies); an installed or
  // archived copy of a required built-in is reused.
  for (const req of def.requires) {
    if (chain.includes(req)) continue;
    const [existing] = await tx
      .select()
      .from(contentTypes)
      .where(and(eq(contentTypes.storeId, ctx.storeId), eq(contentTypes.builtinKey, req)))
      .limit(1);
    if (existing?.status === "archived") {
      const [revived] = await tx.update(contentTypes).set({ status: "active" }).where(eq(contentTypes.id, existing.id)).returning();
      await announce(tx, ctx, revived!, "installed", false);
    } else if (!existing) {
      await installTx(tx, ctx, getContentTypeDefinition(req)!, {}, hooks, [...chain, def.key]);
    }
  }
  const key = input.key ?? def.key;
  const [taken] = await tx.select({ id: contentTypes.id }).from(contentTypes).where(and(eq(contentTypes.storeId, ctx.storeId), eq(contentTypes.key, key)));
  if (taken) throw conflict("errors.content_type.key_taken", { key });

  if (input.routePrefix && !def.routing) throw invalid("errors.content_type.not_routable");
  const routePrefix = def.routing ? cleanPrefixes({ ...def.routing.prefixes, ...(input.routePrefix ?? {}) }) : {};
  await assertPrefixesAvailable(tx, ctx.storeId, null, routePrefix);
  const customFields = parseCustomFields(input.customFields ?? [], { builtinFields: def.fields, routable: def.routing !== null, custom: false });
  const settings: ContentTypeSettings = { ...def.defaultSettings, ...(input.settings ?? {}) };
  assertSettings(def.kind, [...def.fields, ...customFields], def.titleField, settings);
  await assertRootPagesClear(tx, ctx.storeId, routePrefix, def.kind, settings);

  const [row] = await tx
    .insert(contentTypes)
    .values({
      id: newId(),
      ...scopeOf(ctx),
      key,
      builtinKey: def.key,
      builtinVersion: def.version,
      kind: def.kind,
      labels: (input.labels ?? def.labels) as ContentTypeRow["labels"],
      routePrefix,
      settings,
      customFields,
    })
    .returning();
  await recordAudit(tx, {
    organizationId: ctx.organizationId,
    storeId: ctx.storeId,
    action: "content_type.installed",
    resourceType: "content_type",
    resourceId: row!.id,
    after: { key, builtinKey: def.key, version: def.version, routePrefix, customFields: customFields.map((f) => f.key) },
  });
  await announce(tx, ctx, row!, "installed", Object.keys(routePrefix).length > 0);
  await hooks?.onInstalled?.(tx, hookTarget(row!, Object.keys(routePrefix).length > 0));
  return row!;
}

/**
 * Installs a built-in type on the site (and the built-in types it requires). The site row
 * holds only the site-specific part; the schema stays in code.
 */
export async function installType(db: Database, ctx: StoreContext, builtinKey: string, input: z.infer<typeof installTypeSchema> = {}, hooks?: ContentTypeHooks): Promise<ContentTypeRow> {
  assertContent(ctx, "content:manage");
  const def = getContentTypeDefinition(builtinKey);
  if (!def) throw notFound("content_type_definition", builtinKey);
  return withTenantTx(db, scopeOf(ctx), (tx) => installTx(tx, ctx, def, input, hooks, []));
}

/** Creates a custom type from the safe field set (no raw HTML, JSON, iframe, script or code fields exist). */
export async function createCustomType(db: Database, ctx: StoreContext, input: z.infer<typeof createCustomTypeSchema>, hooks?: ContentTypeHooks): Promise<ContentTypeRow> {
  assertContent(ctx, "content:manage");
  if (getContentTypeDefinition(input.key)) throw invalid("errors.content_type.key_reserved", { key: input.key });
  const routePrefix = cleanPrefixes(input.routePrefix);
  if (input.kind === "taxonomy" && Object.keys(routePrefix).length) throw invalid("errors.content_type.taxonomy_not_routable");
  const routable = Object.keys(routePrefix).length > 0;
  const fields = parseCustomFields(input.fields, { builtinFields: [], routable, custom: true });
  assertSettings(input.kind, fields, "title", input.settings);
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    await assertCustomTypeQuota(tx, ctx.storeId);
    const [taken] = await tx.select({ id: contentTypes.id }).from(contentTypes).where(and(eq(contentTypes.storeId, ctx.storeId), eq(contentTypes.key, input.key)));
    if (taken) throw conflict("errors.content_type.key_taken", { key: input.key });
    await assertPrefixesAvailable(tx, ctx.storeId, null, routePrefix);
    await assertRootPagesClear(tx, ctx.storeId, routePrefix, input.kind, input.settings);
    const [row] = await tx
      .insert(contentTypes)
      .values({
        id: newId(),
        ...scopeOf(ctx),
        key: input.key,
        kind: input.kind,
        labels: input.labels as ContentTypeRow["labels"],
        routePrefix,
        settings: input.settings,
        customFields: fields,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_type.created",
      resourceType: "content_type",
      resourceId: row!.id,
      after: { key: input.key, kind: input.kind, routePrefix, fields: fields.map((f) => ({ key: f.key, type: f.type })) },
    });
    await announce(tx, ctx, row!, "created", routable);
    await hooks?.onInstalled?.(tx, hookTarget(row!, routable));
    return row!;
  });
}

/**
 * Updates the site part of a type. Moving URL prefixes writes prefix redirects so every old
 * entry URL keeps working; fields keep their type and localization once defined.
 */
export async function updateType(
  db: Database,
  ctx: StoreContext,
  typeRef: string,
  input: z.infer<typeof updateTypeSchema>,
  hooks?: ContentTypeHooks,
): Promise<ContentTypeRow> {
  assertContent(ctx, "content:manage");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { row, type } = await findTypeTx(tx, ctx.storeId, typeRef, { lock: "update" });
    if (type.status !== "active") throw new AppError("precondition_failed", "errors.content_type.archived", { typeId: row.id });
    const builtinFields = type.builtin?.fields ?? [];
    let routePrefix = row.routePrefix;
    if (input.routePrefix) {
      routePrefix = cleanPrefixes(input.routePrefix);
      if (Object.keys(routePrefix).length && (row.kind === "taxonomy" || (type.builtin && !type.builtin.routing))) throw invalid("errors.content_type.not_routable");
      await assertPrefixesAvailable(tx, ctx.storeId, row.id, routePrefix);
    }
    const routable = Object.keys(routePrefix).length > 0;
    let customFields = row.customFields as FieldDef[];
    if (input.customFields) {
      const previous = customFieldDefsSchema.parse(row.customFields);
      customFields = parseCustomFields(input.customFields, { builtinFields, routable, custom: !type.builtin });
      assertFieldsCompatible(previous, customFields);
    }
    const settings: ContentTypeSettings = input.settings ? { ...row.settings, ...input.settings } : row.settings;
    const allFields = type.builtin ? [...builtinFields, ...customFields] : [...customFields, ...(routable ? geoFieldset() : [])];
    if (countFields(allFields) > CONTENT_LIMITS.fieldsPerType) throw invalid("errors.content_type.too_many_fields", { max: CONTENT_LIMITS.fieldsPerType, actual: countFields(allFields) });
    assertSettings(row.kind, allFields, type.titleField, settings);
    if (input.routePrefix || input.settings) await assertRootPagesClear(tx, ctx.storeId, routePrefix, row.kind, settings);
    if (settings.hierarchical === false && row.settings.hierarchical) {
      const [nested] = await tx
        .select({ id: contentEntries.id })
        .from(contentEntries)
        .where(and(eq(contentEntries.typeId, row.id), sql`${contentEntries.parentId} is not null`, ne(contentEntries.status, "archived")))
        .limit(1);
      if (nested) throw new AppError("precondition_failed", "errors.content_type.has_nested_entries");
    }

    const prefixesChanged = await redirectPrefixChanges(tx, storeInfoOf(ctx), row.id, row.routePrefix, routePrefix);
    const [updated] = await tx
      .update(contentTypes)
      .set({ labels: (input.labels ?? row.labels) as ContentTypeRow["labels"], routePrefix, settings, customFields })
      .where(eq(contentTypes.id, row.id))
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_type.updated",
      resourceType: "content_type",
      resourceId: row.id,
      before: { labels: row.labels, routePrefix: row.routePrefix, settings: row.settings, customFields: (row.customFields as FieldDef[]).map((f) => f.key) },
      after: { labels: updated!.labels, routePrefix, settings, customFields: customFields.map((f) => f.key) },
    });
    await announce(tx, ctx, updated!, "updated", prefixesChanged);
    if (routable && !type.routable) await hooks?.onRoutable?.(tx, hookTarget(updated!, true));
    return updated!;
  });
}

/**
 * Archives a type: its routes disappear and no entries can be created. Refused while entries
 * are live or scheduled (they would vanish without a trace) and while an active type requires
 * it (post needs its taxonomies).
 */
export async function archiveType(db: Database, ctx: StoreContext, typeRef: string): Promise<ContentTypeRow> {
  assertContent(ctx, "content:manage");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { row } = await findTypeTx(tx, ctx.storeId, typeRef, { lock: "update" });
    if (row.status === "archived") return row;
    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contentEntries)
      .where(and(eq(contentEntries.typeId, row.id), inArray(contentEntries.status, ["published", "scheduled"])))) as [{ count: number }];
    if (count > 0) throw new AppError("precondition_failed", "errors.content_type.has_live_entries", { count });
    if (row.builtinKey) {
      const dependents = (await activeTypesTx(tx, ctx.storeId)).filter((t) => t.id !== row.id && t.builtin?.requires.includes(row.builtinKey!));
      if (dependents.length) throw new AppError("precondition_failed", "errors.content_type.required_by", { typeKeys: dependents.map((t) => t.key) });
    }
    const [updated] = await tx.update(contentTypes).set({ status: "archived" }).where(eq(contentTypes.id, row.id)).returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "content_type.archived",
      resourceType: "content_type",
      resourceId: row.id,
      before: { status: row.status },
      after: { status: "archived" },
    });
    await announce(tx, ctx, updated!, "archived", Object.keys(row.routePrefix).length > 0);
    return updated!;
  });
}
