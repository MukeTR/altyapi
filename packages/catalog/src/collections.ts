import { z } from "zod";
import { conflict, invalid, newId, notFound, slugify } from "@altyapi/commerce-core";
import {
  and,
  asc,
  categories,
  collectionRules,
  collections,
  collectionTranslations,
  contentAssets,
  eq,
  inArray,
  isNull,
  notInArray,
  pgArray,
  pgTimestamp,
  productCollections,
  products,
  recordTombstone,
  sql,
  taxClasses,
  upsertRedirect,
  withPlatformTx,
  withTenantTx,
  type Database,
  type SQL,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { setAssetReferences } from "@altyapi/storage";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { localizedPath, sanitizeDescription } from "./text";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

const ruleSchema = z.object({
  field: z.enum(["tag", "vendor", "category", "product_type", "title", "price", "compare_at_price", "inventory", "attribute", "created_at"]),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "starts_with", "greater_than", "less_than", "in"]),
  attributeKey: z.string().regex(/^[a-z0-9_]{1,40}$/).nullable().optional(),
  value: z.string().trim().min(1).max(500),
});

export const collectionInputSchema = z.object({
  type: z.enum(["manual", "automated"]),
  translations: z.record(
    z.string().regex(/^[a-z]{2}$/),
    z.object({
      title: z.string().trim().min(1).max(200),
      handle: z.string().trim().toLowerCase().max(200).optional(),
      descriptionHtml: z.string().max(50_000).default(""),
      seoTitle: z.string().max(70).nullable().optional(),
      seoDescription: z.string().max(320).nullable().optional(),
    }),
  ),
  sortOrder: z.enum(["manual", "best_selling", "newest", "price_asc", "price_desc", "title_asc", "title_desc"]).default("manual"),
  matchAll: z.boolean().default(true),
  rules: z.array(ruleSchema).max(30).default([]),
  imageAssetId: z.uuid().nullable().optional(),
  isPublished: z.boolean().default(true),
});

type RuleInput = z.infer<typeof ruleSchema>;

const NUMERIC_FIELDS = new Set(["price", "compare_at_price", "inventory"]);

function validateRules(input: z.infer<typeof collectionInputSchema>) {
  if (input.type === "automated" && input.rules.length === 0) throw invalid("errors.collection.rules_required");
  if (input.type === "manual" && input.rules.length) throw invalid("errors.collection.rules_not_allowed");
  for (const [i, r] of input.rules.entries()) {
    if (NUMERIC_FIELDS.has(r.field)) {
      if (!["equals", "greater_than", "less_than", "not_equals"].includes(r.operator) || !/^\d+$/.test(r.value)) {
        throw invalid("errors.collection.invalid_numeric_rule", { index: i });
      }
    }
    if (r.field === "created_at" && (!["greater_than", "less_than"].includes(r.operator) || Number.isNaN(Date.parse(r.value)))) {
      throw invalid("errors.collection.invalid_date_rule", { index: i });
    }
    if (r.field === "attribute" && !r.attributeKey) throw invalid("errors.collection.attribute_key_required", { index: i });
  }
}

/**
 * Translates one rule into a SQL predicate over products (alias "p"). Price rules use the
 * store's base price list in the store currency; inventory rules use summed availability.
 */
function ruleSql(rule: RuleInput, storeId: string, currency: string, locale: string): SQL {
  const v = rule.value;
  const like = (pattern: string) => pattern.replace(/[\\%_]/g, (c) => `\\${c}`);
  const textOp = (col: SQL): SQL => {
    switch (rule.operator) {
      case "equals":
        return sql`lower(${col}) = lower(${v})`;
      case "not_equals":
        return sql`lower(${col}) <> lower(${v})`;
      case "contains":
        return sql`${col} ilike ${`%${like(v)}%`}`;
      case "not_contains":
        return sql`${col} not ilike ${`%${like(v)}%`}`;
      case "starts_with":
        return sql`${col} ilike ${`${like(v)}%`}`;
      case "in":
        return sql`lower(${col}) = any(${pgArray(v.split(",").map((x) => x.trim().toLocaleLowerCase("tr")), "text")})`;
      default:
        throw invalid("errors.collection.operator_not_supported");
    }
  };
  const numOp = (col: SQL): SQL => {
    const n = BigInt(v);
    switch (rule.operator) {
      case "equals":
        return sql`${col} = ${n}`;
      case "not_equals":
        return sql`${col} <> ${n}`;
      case "greater_than":
        return sql`${col} > ${n}`;
      case "less_than":
        return sql`${col} < ${n}`;
      default:
        throw invalid("errors.collection.operator_not_supported");
    }
  };
  const negate = rule.operator === "not_equals" || rule.operator === "not_contains";
  switch (rule.field) {
    case "tag": {
      // "not equals/contains" on a multi-valued field means: no tag matches the positive condition.
      const cond = negate
        ? rule.operator === "not_equals"
          ? sql`lower(t.name) = lower(${v})`
          : sql`t.name ilike ${`%${like(v)}%`}`
        : textOp(sql`t.name`);
      const exists = sql`exists (select 1 from product_tags pt join tags t on t.id = pt.tag_id where pt.product_id = p.id and ${cond})`;
      return negate ? sql`not ${exists}` : exists;
    }
    case "vendor":
      return sql`exists (select 1 from vendors vd where vd.id = p.vendor_id and ${textOp(sql`vd.name`)})`;
    case "category":
      // Matches the category and all of its descendants.
      return sql`p.category_id in (
        with recursive tree as (
          select id from categories where store_id = ${storeId} and (id::text = ${v} or handle = ${v})
          union all select c.id from categories c join tree on c.parent_id = tree.id
        ) select id from tree)`;
    case "product_type":
      return textOp(sql`coalesce(p.product_type, '')`);
    case "title":
      return sql`exists (select 1 from product_translations tr where tr.product_id = p.id and tr.locale = ${locale} and ${textOp(sql`tr.title`)})`;
    case "price":
    case "compare_at_price": {
      const col = rule.field === "price" ? sql`ma.amount` : sql`ma.compare_at_amount`;
      return sql`exists (select 1 from product_variants pv join money_amounts ma on ma.variant_id = pv.id
        join price_lists pl on pl.id = ma.price_list_id and pl.kind = 'base' and pl.currency = ${currency}
        where pv.product_id = p.id and pv.archived_at is null and ma.min_quantity = 1 and ${numOp(col)})`;
    }
    case "inventory":
      return numOp(sql`(select coalesce(sum(il.on_hand - il.reserved), 0) from product_variants pv
        join inventory_items ii on ii.variant_id = pv.id join inventory_levels il on il.inventory_item_id = ii.id
        where pv.product_id = p.id and pv.archived_at is null)`);
    case "attribute":
      return sql`exists (select 1 from jsonb_array_elements(p.attributes) a where a->>'key' = ${rule.attributeKey ?? ""} and ${textOp(sql`(a->'value'->>${locale})`)})`;
    case "created_at":
      return rule.operator === "greater_than" ? sql`p.created_at > ${pgTimestamp(new Date(v))}` : sql`p.created_at < ${pgTimestamp(new Date(v))}`;
  }
}

/** Returns product ids matching an automated collection (optionally limited to some products). */
export async function evaluateCollection(tx: Transaction, collectionId: string, onlyProductIds?: string[]): Promise<string[]> {
  const c = await tx.query.collections.findFirst({ where: eq(collections.id, collectionId) });
  if (!c || c.type !== "automated") return [];
  const rules = await tx.select().from(collectionRules).where(eq(collectionRules.collectionId, collectionId));
  if (!rules.length) return [];
  const storeRow = await tx.execute<{ default_currency: string; default_locale: string }>(sql`select default_currency, default_locale from stores where id = ${c.storeId}`);
  const store = storeRow[0]!;
  const conds = rules.map((r) => ruleSql(r as RuleInput, c.storeId, store.default_currency, store.default_locale));
  const combined = sql.join(conds, c.matchAll ? sql` and ` : sql` or `);
  const limit = onlyProductIds?.length ? sql` and p.id = any(${pgArray(onlyProductIds, "uuid")})` : sql``;
  const rows = await tx.execute<{ id: string }>(
    sql`select p.id from products p where p.store_id = ${c.storeId} and p.status <> 'archived' and (${combined})${limit}`,
  );
  return rows.map((r) => r.id);
}

/** Rebuilds membership of one automated collection. */
export async function materializeCollection(db: Database, scope: Scope, collectionId: string): Promise<number> {
  return withTenantTx(db, scope, async (tx) => {
    const ids = await evaluateCollection(tx, collectionId);
    if (ids.length) {
      await tx.delete(productCollections).where(and(eq(productCollections.collectionId, collectionId), notInArray(productCollections.productId, ids)));
    } else {
      await tx.delete(productCollections).where(eq(productCollections.collectionId, collectionId));
    }
    for (const productId of ids) {
      await tx.insert(productCollections).values({ collectionId, productId, ...scope }).onConflictDoNothing();
    }
    return ids.length;
  });
}

/** Re-evaluates every automated collection for one product (after product/price/stock changes). */
export async function refreshProductMemberships(db: Database, scope: Scope, productId: string): Promise<void> {
  await withTenantTx(db, scope, async (tx) => {
    const automated = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, scope.storeId), eq(collections.type, "automated")));
    for (const c of automated) {
      const match = (await evaluateCollection(tx, c.id, [productId])).includes(productId);
      if (match) await tx.insert(productCollections).values({ collectionId: c.id, productId, ...scope }).onConflictDoNothing();
      else await tx.delete(productCollections).where(and(eq(productCollections.collectionId, c.id), eq(productCollections.productId, productId)));
    }
  });
}

async function uniqueCollectionHandle(tx: Transaction, storeId: string, locale: string, base: string, collectionId: string) {
  const root = slugify(base) || "koleksiyon";
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const clash = await tx.query.collectionTranslations.findFirst({
      where: and(eq(collectionTranslations.storeId, storeId), eq(collectionTranslations.locale, locale), eq(collectionTranslations.handle, candidate)),
    });
    if (!clash || clash.collectionId === collectionId) return candidate;
  }
  throw conflict("errors.collection.handle_exhausted");
}

export async function saveCollection(db: Database, ctx: StoreContext, input: z.infer<typeof collectionInputSchema>, collectionId?: string) {
  assertCan(ctx, "catalog:write");
  validateRules(input);
  if (!input.translations[ctx.store.defaultLocale]) throw invalid("errors.collection.default_locale_required");
  const scope = scopeOf(ctx);
  const id = collectionId ?? newId();
  await withTenantTx(db, scope, async (tx) => {
    const previous = collectionId ? await tx.query.collections.findFirst({ where: and(eq(collections.id, collectionId), eq(collections.storeId, ctx.storeId)) }) : undefined;
    if (collectionId && !previous) throw notFound("collection", collectionId);
    if (previous && previous.type !== input.type) throw invalid("errors.collection.type_immutable");
    if (input.imageAssetId) {
      const a = await tx.query.contentAssets.findFirst({ where: and(eq(contentAssets.id, input.imageAssetId), eq(contentAssets.storeId, ctx.storeId), isNull(contentAssets.deletedAt)) });
      if (!a || a.status !== "ready") throw invalid("errors.collection.image_not_ready");
    }
    const values = {
      type: input.type,
      sortOrder: input.sortOrder,
      matchAll: input.matchAll,
      imageAssetId: input.imageAssetId ?? null,
      isPublished: input.isPublished,
      publishedAt: input.isPublished ? previous?.publishedAt ?? new Date() : null,
    };
    if (previous) await tx.update(collections).set(values).where(eq(collections.id, id));
    else await tx.insert(collections).values({ id, ...scope, ...values });

    const oldTr = previous ? await tx.select().from(collectionTranslations).where(eq(collectionTranslations.collectionId, id)) : [];
    await tx.delete(collectionTranslations).where(eq(collectionTranslations.collectionId, id));
    for (const [locale, t] of Object.entries(input.translations)) {
      const handle = await uniqueCollectionHandle(tx, ctx.storeId, locale, t.handle || t.title, id);
      await tx.insert(collectionTranslations).values({
        collectionId: id,
        ...scope,
        locale,
        title: t.title,
        handle,
        descriptionHtml: sanitizeDescription(t.descriptionHtml),
        seoTitle: t.seoTitle ?? null,
        seoDescription: t.seoDescription ?? null,
      });
      const old = oldTr.find((o) => o.locale === locale);
      if (old && old.handle !== handle && previous?.publishedAt) {
        await upsertRedirect(
          tx,
          scope,
          localizedPath(locale, ctx.store.defaultLocale, `/collections/${old.handle}`),
          localizedPath(locale, ctx.store.defaultLocale, `/collections/${handle}`),
          301,
          "slug_change",
        );
      }
    }
    await tx.delete(collectionRules).where(eq(collectionRules.collectionId, id));
    for (const r of input.rules) {
      await tx.insert(collectionRules).values({ id: newId(), ...scope, collectionId: id, field: r.field, operator: r.operator, attributeKey: r.attributeKey ?? null, value: r.value });
    }
    await setAssetReferences(tx, scope, { type: "collection", id }, input.imageAssetId ? [input.imageAssetId] : []);
    await tx.execute(sql`update stores set content_version = content_version + 1 where id = ${ctx.storeId}`);
    await recordAudit(tx, { action: previous ? "collection.updated" : "collection.created", resourceType: "collection", resourceId: id, after: { type: input.type, rules: input.rules.length } });
  });
  if (input.type === "automated") await materializeCollection(db, scope, id);
  return getCollection(db, ctx, id);
}

export async function getCollection(db: Database, ctx: StoreContext, collectionId: string) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const c = await tx.query.collections.findFirst({ where: and(eq(collections.id, collectionId), eq(collections.storeId, ctx.storeId)) });
    if (!c) throw notFound("collection", collectionId);
    const [tr, rules, count] = await Promise.all([
      tx.select().from(collectionTranslations).where(eq(collectionTranslations.collectionId, c.id)),
      tx.select().from(collectionRules).where(eq(collectionRules.collectionId, c.id)),
      tx.select({ n: sql<number>`count(*)::int` }).from(productCollections).where(eq(productCollections.collectionId, c.id)),
    ]);
    return {
      ...c,
      translations: Object.fromEntries(tr.map((t) => [t.locale, { title: t.title, handle: t.handle, descriptionHtml: t.descriptionHtml, seoTitle: t.seoTitle, seoDescription: t.seoDescription }])),
      rules: rules.map((r) => ({ field: r.field, operator: r.operator, attributeKey: r.attributeKey, value: r.value })),
      productCount: count[0]?.n ?? 0,
    };
  });
}

export async function listCollections(db: Database, ctx: StoreContext) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const rows = await tx.select().from(collections).where(eq(collections.storeId, ctx.storeId)).orderBy(asc(collections.createdAt));
    const ids = rows.map((r) => r.id);
    const tr = ids.length ? await tx.select().from(collectionTranslations).where(and(inArray(collectionTranslations.collectionId, ids), eq(collectionTranslations.locale, ctx.store.defaultLocale))) : [];
    const counts = ids.length
      ? await tx.select({ id: productCollections.collectionId, n: sql<number>`count(*)::int` }).from(productCollections).where(inArray(productCollections.collectionId, ids)).groupBy(productCollections.collectionId)
      : [];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: tr.find((t) => t.collectionId === r.id)?.title ?? "",
      handle: tr.find((t) => t.collectionId === r.id)?.handle ?? "",
      isPublished: r.isPublished,
      productCount: counts.find((c) => c.id === r.id)?.n ?? 0,
      updatedAt: r.updatedAt,
    }));
  });
}

export async function deleteCollection(db: Database, ctx: StoreContext, collectionId: string) {
  assertCan(ctx, "catalog:write");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const deleted = await tx.delete(collections).where(and(eq(collections.id, collectionId), eq(collections.storeId, ctx.storeId))).returning();
    if (!deleted.length) throw notFound("collection", collectionId);
    await setAssetReferences(tx, scopeOf(ctx), { type: "collection", id: collectionId }, []);
    // Incremental ekosistem content consumers learn about the deletion from the tombstone.
    await recordTombstone(tx, { ...scopeOf(ctx), resource: "content", ref: collectionId });
    await recordAudit(tx, { action: "collection.deleted", resourceType: "collection", resourceId: collectionId });
  });
}

export const setCollectionProductsSchema = z.object({ productIds: z.array(z.uuid()).max(5000) });

/** Sets manual membership and order (position = array index). */
export async function setCollectionProducts(db: Database, ctx: StoreContext, collectionId: string, input: z.infer<typeof setCollectionProductsSchema>) {
  assertCan(ctx, "catalog:write");
  await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const c = await tx.query.collections.findFirst({ where: and(eq(collections.id, collectionId), eq(collections.storeId, ctx.storeId)) });
    if (!c) throw notFound("collection", collectionId);
    if (c.type !== "manual") throw invalid("errors.collection.automated_membership");
    if (input.productIds.length) {
      const found = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, ctx.storeId), inArray(products.id, input.productIds)));
      if (found.length !== new Set(input.productIds).size) throw notFound("product");
    }
    await tx.delete(productCollections).where(eq(productCollections.collectionId, collectionId));
    for (const [position, productId] of input.productIds.entries()) {
      await tx.insert(productCollections).values({ collectionId, productId, ...scopeOf(ctx), position }).onConflictDoNothing();
    }
    await tx.execute(sql`update stores set content_version = content_version + 1 where id = ${ctx.storeId}`);
  });
}

/** Worker: re-materializes all automated collections (safety net for time/price/stock based rules). */
export async function refreshAllAutomatedCollections(db: Database): Promise<number> {
  const rows = await withPlatformTx(db, (tx) =>
    tx.select({ id: collections.id, organizationId: collections.organizationId, storeId: collections.storeId }).from(collections).where(eq(collections.type, "automated")),
  );
  for (const r of rows) await materializeCollection(db, { organizationId: r.organizationId, storeId: r.storeId }, r.id);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Categories & tax classes
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: z.record(z.string().regex(/^[a-z]{2}$/), z.string().trim().min(1).max(120)),
  handle: z.string().trim().toLowerCase().optional(),
  position: z.number().int().min(0).default(0),
  googleCategoryId: z.number().int().positive().nullable().optional(),
});

export async function listCategories(db: Database, ctx: StoreContext) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(categories).where(eq(categories.storeId, ctx.storeId)).orderBy(asc(categories.position)));
}

export async function saveCategory(db: Database, ctx: StoreContext, input: z.infer<typeof categoryInputSchema>, categoryId?: string) {
  assertCan(ctx, "catalog:write");
  const name = input.name[ctx.store.defaultLocale] ?? Object.values(input.name)[0]!;
  const handle = input.handle || slugify(name);
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.parentId) {
      const parent = await tx.query.categories.findFirst({ where: and(eq(categories.id, input.parentId), eq(categories.storeId, ctx.storeId)) });
      if (!parent) throw notFound("category", input.parentId);
      if (categoryId) {
        // Reject cycles: the new parent must not be the category itself or one of its descendants.
        const cycle = await tx.execute<{ id: string }>(sql`
          with recursive tree as (select id from categories where id = ${categoryId}
            union all select c.id from categories c join tree on c.parent_id = tree.id)
          select id from tree where id = ${input.parentId}`);
        if (cycle.length) throw invalid("errors.category.cycle");
      }
    }
    const values = { parentId: input.parentId, name: input.name, handle, position: input.position, googleCategoryId: input.googleCategoryId ?? null };
    try {
      if (categoryId) {
        const [row] = await tx.update(categories).set(values).where(and(eq(categories.id, categoryId), eq(categories.storeId, ctx.storeId))).returning();
        if (!row) throw notFound("category", categoryId);
        return row;
      }
      const [row] = await tx.insert(categories).values({ id: newId(), ...scopeOf(ctx), ...values }).returning();
      return row!;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict("errors.category.handle_taken", { handle });
      throw err;
    }
  });
}

export async function ensureDefaultTaxClass(tx: Transaction, scope: Scope, countryCode: string): Promise<string> {
  const existing = await tx.query.taxClasses.findFirst({ where: and(eq(taxClasses.storeId, scope.storeId), eq(taxClasses.isDefault, true)) });
  if (existing) return existing.id;
  const id = newId();
  // Turkey defaults: KDV %20 standard, prices shown tax-inclusive. Other rates are added by the merchant.
  const rate = countryCode === "TR" ? 2000 : 0;
  await tx.insert(taxClasses).values({ id, ...scope, code: "standard", name: countryCode === "TR" ? "KDV %20" : "Standard", rateBps: rate, pricesIncludeTax: true, isDefault: true });
  return id;
}

export const taxClassSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  rateBps: z.number().int().min(0).max(10000),
  pricesIncludeTax: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export async function listTaxClasses(db: Database, ctx: StoreContext) {
  assertCan(ctx, "settings:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(taxClasses).where(eq(taxClasses.storeId, ctx.storeId)).orderBy(asc(taxClasses.code)));
}

export async function saveTaxClass(db: Database, ctx: StoreContext, input: z.infer<typeof taxClassSchema>) {
  assertCan(ctx, "settings:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    if (input.isDefault) await tx.update(taxClasses).set({ isDefault: false }).where(eq(taxClasses.storeId, ctx.storeId));
    const [row] = await tx
      .insert(taxClasses)
      .values({ id: newId(), ...scopeOf(ctx), ...input })
      .onConflictDoUpdate({ target: [taxClasses.storeId, taxClasses.code], set: { ...input, updatedAt: new Date() } })
      .returning();
    await recordAudit(tx, { action: "tax_class.saved", resourceType: "tax_class", resourceId: row!.id, after: input });
    return row!;
  });
}
