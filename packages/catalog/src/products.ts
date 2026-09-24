import { z } from "zod";
import { conflict, currencySchema, decodeCursor, encodeCursor, invalid, newId, notFound, slugify } from "@altyapi/commerce-core";
import {
  and,
  asc,
  categories,
  channelListings,
  channels,
  collections,
  contentAssets,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  priceLists,
  productCollections,
  productMedia,
  productOptions,
  productOptionValues,
  products,
  productTags,
  productTranslations,
  productVariants,
  slugHistory,
  sql,
  tags,
  taxClasses,
  upsertRedirect,
  vendors,
  withPlatformTx,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { applyLedgerEntry, ensureDefaultLocation, ensureInventoryItem, getStockForVariants } from "@altyapi/inventory";
import { ensureBasePriceList, latestCosts, resolvePrices, setVariantCost, upsertPriceEntries } from "@altyapi/pricing";
import { setAssetReferences } from "@altyapi/storage";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { localizedPath, sanitizeDescription, searchNormalize, stripHtml, toPrefixTsQuery } from "./text";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 250;

const minor = z.union([z.bigint().nonnegative(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const localizedLabel = z.record(z.string().regex(/^[a-z]{2}$/), z.string().trim().min(1).max(120));

const translationSchema = z.object({
  title: z.string().trim().min(1).max(250),
  handle: z.string().trim().toLowerCase().max(200).optional(),
  descriptionHtml: z.string().max(100_000).default(""),
  seoTitle: z.string().max(70).nullable().optional(),
  seoDescription: z.string().max(320).nullable().optional(),
});

const optionSchema = z.object({
  id: z.uuid().optional(),
  name: localizedLabel,
  values: z
    .array(
      z.object({
        id: z.uuid().optional(),
        value: localizedLabel,
        swatchColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
        swatchAssetId: z.uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});

const variantSchema = z.object({
  id: z.uuid().optional(),
  /** One value per option, in option order, using the default-locale value label. */
  optionValues: z.array(z.string().trim().min(1)).max(MAX_OPTIONS).default([]),
  sku: z.string().trim().max(100).nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  price: minor,
  compareAtPrice: minor.nullable().optional(),
  cost: minor.nullable().optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  requiresShipping: z.boolean().optional(),
  trackInventory: z.boolean().default(true),
  allowBackorder: z.boolean().default(false),
  taxClassId: z.uuid().nullable().optional(),
  digitalAssetId: z.uuid().nullable().optional(),
  externalRef: z.string().max(200).nullable().optional(),
  /** Initial stock, only applied when the variant is created. */
  initialStock: z.array(z.object({ locationId: z.uuid().optional(), quantity: z.number().int().min(0).max(10_000_000) })).optional(),
});

const attributeSchema = z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), label: localizedLabel, value: localizedLabel });

export const productInputSchema = z.object({
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  kind: z.enum(["physical", "digital"]).default("physical"),
  translations: z.record(z.string().regex(/^[a-z]{2}$/), translationSchema),
  vendorName: z.string().trim().max(120).nullable().optional(),
  productType: z.string().trim().max(120).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  taxClassId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
  collectionIds: z.array(z.uuid()).max(100).default([]),
  options: z.array(optionSchema).max(MAX_OPTIONS).default([]),
  variants: z.array(variantSchema).min(1).max(MAX_VARIANTS),
  media: z
    .array(z.object({ assetId: z.uuid(), alt: z.record(z.string(), z.string().max(250)).default({}), variantIndexes: z.array(z.number().int().min(0)).default([]) }))
    .max(100)
    .default([]),
  attributes: z.array(attributeSchema).max(100).default([]),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  dimensionsMm: z.object({ length: z.number().int().min(0), width: z.number().int().min(0), height: z.number().int().min(0) }).nullable().optional(),
  publishAt: z.coerce.date().nullable().optional(),
  currency: currencySchema.optional(),
  externalRef: z.string().max(200).nullable().optional(),
  channelVisibility: z.array(z.object({ channelId: z.uuid(), isVisible: z.boolean(), availableForPurchase: z.boolean().default(true) })).optional(),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productUpdateSchema = productInputSchema.extend({ expectedUpdatedAt: z.coerce.date().optional() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertVendor(tx: Transaction, scope: Scope, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const handle = slugify(name) || "vendor";
  const existing = await tx.query.vendors.findFirst({ where: and(eq(vendors.storeId, scope.storeId), eq(vendors.handle, handle)) });
  if (existing) return existing.id;
  const id = newId();
  await tx.insert(vendors).values({ id, ...scope, name, handle });
  return id;
}

async function syncTags(tx: Transaction, scope: Scope, productId: string, names: string[]): Promise<string[]> {
  await tx.delete(productTags).where(eq(productTags.productId, productId));
  const unique = [...new Map(names.map((n) => [n.toLocaleLowerCase("tr"), n])).values()];
  for (const name of unique) {
    let tag = await tx.query.tags.findFirst({ where: and(eq(tags.storeId, scope.storeId), sql`lower(${tags.name}) = lower(${name})`) });
    if (!tag) {
      [tag] = await tx.insert(tags).values({ id: newId(), ...scope, name }).returning();
    }
    await tx.insert(productTags).values({ productId, tagId: tag!.id, ...scope }).onConflictDoNothing();
  }
  return unique;
}

/** Picks a free handle for the locale, suffixing -2, -3… on collision. */
async function uniqueHandle(tx: Transaction, storeId: string, locale: string, base: string, productId: string): Promise<string> {
  const root = (slugify(base) || "urun").slice(0, 180);
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const clash = await tx.query.productTranslations.findFirst({
      where: and(eq(productTranslations.storeId, storeId), eq(productTranslations.locale, locale), eq(productTranslations.handle, candidate)),
    });
    if (!clash || clash.productId === productId) return candidate;
  }
  throw conflict("errors.product.handle_exhausted");
}

function assertLocales(ctx: StoreContext, input: ProductInput) {
  if (!input.translations[ctx.store.defaultLocale]) {
    throw invalid("errors.product.default_locale_required", { locale: ctx.store.defaultLocale });
  }
  for (const loc of Object.keys(input.translations)) {
    if (!ctx.store.supportedLocales.includes(loc)) throw invalid("errors.product.locale_not_enabled", { locale: loc });
  }
}

function label(map: Record<string, string>, locale: string): string {
  return map[locale] ?? Object.values(map)[0] ?? "";
}

/** Validates option/variant structure: combination count, uniqueness and value references. */
function planVariants(ctx: StoreContext, input: ProductInput) {
  const loc = ctx.store.defaultLocale;
  const optionLabels = input.options.map((o) => label(o.name, loc).toLocaleLowerCase("tr"));
  if (new Set(optionLabels).size !== optionLabels.length) throw invalid("errors.product.duplicate_option");
  for (const o of input.options) {
    const vals = o.values.map((v) => label(v.value, loc).toLocaleLowerCase("tr"));
    if (new Set(vals).size !== vals.length) throw invalid("errors.product.duplicate_option_value", { option: label(o.name, loc) });
  }
  const seen = new Set<string>();
  input.variants.forEach((v, i) => {
    if (v.optionValues.length !== input.options.length) throw invalid("errors.product.variant_option_mismatch", { index: i });
    v.optionValues.forEach((val, oi) => {
      const opt = input.options[oi]!;
      if (!opt.values.some((x) => label(x.value, loc).toLocaleLowerCase("tr") === val.toLocaleLowerCase("tr"))) {
        throw invalid("errors.product.unknown_option_value", { index: i, value: val });
      }
    });
    const key = v.optionValues.map((x) => x.toLocaleLowerCase("tr")).join("\u0000");
    if (seen.has(key)) throw invalid("errors.product.duplicate_variant", { index: i });
    seen.add(key);
    if (v.compareAtPrice != null && v.compareAtPrice <= v.price) throw invalid("errors.pricing.compare_at_not_higher", { index: i });
  });
  if (input.options.length === 0 && input.variants.length !== 1) throw invalid("errors.product.single_variant_without_options");
  const skus = input.variants.map((v) => v.sku).filter((s): s is string => !!s);
  if (new Set(skus).size !== skus.length) throw invalid("errors.product.duplicate_sku");
}

async function validateReferences(tx: Transaction, ctx: StoreContext, input: ProductInput) {
  if (input.categoryId) {
    const c = await tx.query.categories.findFirst({ where: and(eq(categories.id, input.categoryId), eq(categories.storeId, ctx.storeId)) });
    if (!c) throw notFound("category", input.categoryId);
  }
  const taxIds = [input.taxClassId, ...input.variants.map((v) => v.taxClassId)].filter((x): x is string => !!x);
  if (taxIds.length) {
    const rows = await tx.select({ id: taxClasses.id }).from(taxClasses).where(and(eq(taxClasses.storeId, ctx.storeId), inArray(taxClasses.id, [...new Set(taxIds)])));
    if (rows.length !== new Set(taxIds).size) throw notFound("tax_class");
  }
  if (input.collectionIds.length) {
    const rows = await tx
      .select({ id: collections.id, type: collections.type })
      .from(collections)
      .where(and(eq(collections.storeId, ctx.storeId), inArray(collections.id, input.collectionIds)));
    if (rows.length !== new Set(input.collectionIds).size) throw notFound("collection");
    if (rows.some((r) => r.type !== "manual")) throw invalid("errors.collection.automated_membership");
  }
  const assetIds = [
    ...input.media.map((m) => m.assetId),
    ...input.variants.map((v) => v.digitalAssetId).filter((x): x is string => !!x),
  ];
  if (assetIds.length) {
    const rows = await tx
      .select({ id: contentAssets.id, status: contentAssets.status, bucket: contentAssets.bucket })
      .from(contentAssets)
      .where(and(eq(contentAssets.storeId, ctx.storeId), inArray(contentAssets.id, [...new Set(assetIds)]), isNull(contentAssets.deletedAt)));
    if (rows.length !== new Set(assetIds).size) throw notFound("asset");
    for (const m of input.media) {
      const r = rows.find((x) => x.id === m.assetId)!;
      if (r.bucket !== "storefront-public" || r.status !== "ready") throw invalid("errors.product.media_not_ready", { assetId: m.assetId });
    }
  }
  if (input.kind === "digital" && input.variants.some((v) => !v.digitalAssetId)) {
    throw invalid("errors.product.digital_asset_required");
  }
}

async function refreshSearchDocument(tx: Transaction, productId: string) {
  const translations = await tx.select().from(productTranslations).where(eq(productTranslations.productId, productId));
  const variantRows = await tx.select({ sku: productVariants.sku, barcode: productVariants.barcode }).from(productVariants).where(and(eq(productVariants.productId, productId), isNull(productVariants.archivedAt)));
  const tagRows = await tx.select({ name: tags.name }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(productTags.productId, productId));
  const product = await tx.query.products.findFirst({ where: eq(products.id, productId) });
  const vendor = product?.vendorId ? await tx.query.vendors.findFirst({ where: eq(vendors.id, product.vendorId) }) : null;
  const a = searchNormalize(translations.map((t) => t.title).join(" "));
  // SKUs are indexed both tokenized ("kg mv m") and compact ("kgmvm") so partial and exact codes match.
  const compactCodes = variantRows.flatMap((v) => [v.sku, v.barcode]).filter((c): c is string => !!c).map((c) => searchNormalize(c).replace(/ /g, ""));
  const b = searchNormalize([...compactCodes, ...variantRows.flatMap((v) => [v.sku ?? "", v.barcode ?? ""]), ...tagRows.map((t) => t.name), vendor?.name ?? "", product?.productType ?? ""].join(" "));
  const c = searchNormalize(translations.map((t) => stripHtml(t.descriptionHtml)).join(" ")).slice(0, 20_000);
  await tx
    .update(products)
    .set({
      searchDocument: sql`setweight(to_tsvector('simple', ${a}), 'A') || setweight(to_tsvector('simple', ${b}), 'B') || setweight(to_tsvector('simple', ${c}), 'C')`,
    })
    .where(eq(products.id, productId));
}

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

interface SaveResult {
  productId: string;
}

/**
 * Persists the full product aggregate (translations, options, variants, prices, costs,
 * media, tags, collections, channel listings). Used by create, update and imports.
 */
export async function saveProductAggregate(tx: Transaction, ctx: StoreContext, input: ProductInput, existingId?: string): Promise<SaveResult> {
  assertLocales(ctx, input);
  planVariants(ctx, input);
  await validateReferences(tx, ctx, input);
  const scope = scopeOf(ctx);
  const loc = ctx.store.defaultLocale;
  const currency = input.currency ?? ctx.store.defaultCurrency;
  if (!ctx.store.supportedCurrencies.includes(currency)) throw invalid("errors.pricing.currency_not_enabled", { currency });

  const productId = existingId ?? newId();
  const previous = existingId ? await tx.query.products.findFirst({ where: eq(products.id, existingId) }) : undefined;
  const vendorId = await upsertVendor(tx, scope, input.vendorName);
  const becameActive = input.status === "active" && previous?.status !== "active" && !input.publishAt;

  const productValues = {
    status: input.publishAt && input.status === "active" ? ("draft" as const) : input.status,
    kind: input.kind,
    vendorId,
    categoryId: input.categoryId ?? null,
    taxClassId: input.taxClassId ?? null,
    productType: input.productType ?? null,
    weightGrams: input.weightGrams ?? null,
    lengthMm: input.dimensionsMm?.length ?? null,
    widthMm: input.dimensionsMm?.width ?? null,
    heightMm: input.dimensionsMm?.height ?? null,
    attributes: input.attributes,
    publishAt: input.status === "active" ? input.publishAt ?? null : null,
    publishedAt: becameActive ? new Date() : previous?.publishedAt ?? null,
    externalRef: input.externalRef ?? previous?.externalRef ?? null,
  };
  if (previous) await tx.update(products).set(productValues).where(eq(products.id, productId));
  else await tx.insert(products).values({ id: productId, ...scope, ...productValues });

  // Translations (+ slug history and redirects for changed handles of live products)
  const oldTranslations = previous ? await tx.select().from(productTranslations).where(eq(productTranslations.productId, productId)) : [];
  await tx.delete(productTranslations).where(eq(productTranslations.productId, productId));
  for (const [locale, t] of Object.entries(input.translations)) {
    const handle = await uniqueHandle(tx, ctx.storeId, locale, t.handle || t.title, productId);
    await tx.insert(productTranslations).values({
      productId,
      ...scope,
      locale,
      title: t.title,
      handle,
      descriptionHtml: sanitizeDescription(t.descriptionHtml),
      seoTitle: t.seoTitle ?? null,
      seoDescription: t.seoDescription ?? null,
    });
    const old = oldTranslations.find((o) => o.locale === locale);
    if (old && old.handle !== handle && previous?.publishedAt) {
      await tx
        .insert(slugHistory)
        .values({ id: newId(), ...scope, resourceType: "product", resourceId: productId, locale, slug: old.handle })
        .onConflictDoNothing();
      await upsertRedirect(
        tx,
        scope,
        localizedPath(locale, loc, `/products/${old.handle}`),
        localizedPath(locale, loc, `/products/${handle}`),
        301,
        "slug_change",
      );
    }
  }

  // Options and values (matched by id, otherwise recreated)
  const keepOptionIds = input.options.map((o) => o.id).filter((x): x is string => !!x);
  await tx
    .delete(productOptions)
    .where(and(eq(productOptions.productId, productId), keepOptionIds.length ? notInArray(productOptions.id, keepOptionIds) : undefined));
  const valueIdByLabel: Map<string, string>[] = [];
  for (const [oi, o] of input.options.entries()) {
    const optionId = o.id ?? newId();
    if (o.id) {
      const exists = await tx.query.productOptions.findFirst({ where: and(eq(productOptions.id, o.id), eq(productOptions.productId, productId)) });
      if (!exists) throw notFound("product_option", o.id);
      await tx.update(productOptions).set({ position: oi, name: o.name }).where(eq(productOptions.id, o.id));
    } else {
      await tx.insert(productOptions).values({ id: optionId, ...scope, productId, position: oi, name: o.name });
    }
    const keepValueIds = o.values.map((v) => v.id).filter((x): x is string => !!x);
    await tx
      .delete(productOptionValues)
      .where(and(eq(productOptionValues.optionId, optionId), keepValueIds.length ? notInArray(productOptionValues.id, keepValueIds) : undefined));
    const map = new Map<string, string>();
    for (const [vi, v] of o.values.entries()) {
      const valueId = v.id ?? newId();
      const values = { position: vi, value: v.value, swatchColor: v.swatchColor ?? null, swatchAssetId: v.swatchAssetId ?? null };
      if (v.id) await tx.update(productOptionValues).set(values).where(and(eq(productOptionValues.id, v.id), eq(productOptionValues.optionId, optionId)));
      else await tx.insert(productOptionValues).values({ id: valueId, ...scope, optionId, ...values });
      map.set(label(v.value, loc).toLocaleLowerCase("tr"), valueId);
    }
    valueIdByLabel.push(map);
  }

  // Variants
  const existingVariants = previous ? await tx.select().from(productVariants).where(and(eq(productVariants.productId, productId), isNull(productVariants.archivedAt))) : [];
  const basePriceListId = await ensureBasePriceList(tx, scope, currency);
  const defaultLocationId = await ensureDefaultLocation(tx, scope);
  const variantIds: string[] = [];
  const priceEntries: { variantId: string; amount: bigint; compareAtAmount: bigint | null; minQuantity: number }[] = [];

  // Archive first so re-created combinations do not collide with the unique index.
  const incomingIds = new Set(input.variants.map((v) => v.id).filter(Boolean));
  for (const ev of existingVariants) {
    if (!incomingIds.has(ev.id)) await tx.update(productVariants).set({ archivedAt: new Date() }).where(eq(productVariants.id, ev.id));
  }

  for (const [i, v] of input.variants.entries()) {
    const optionValueIds = v.optionValues.map((val, oi) => valueIdByLabel[oi]!.get(val.toLocaleLowerCase("tr"))!).sort();
    const values = {
      position: i,
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      optionValueIds,
      weightGrams: v.weightGrams ?? null,
      requiresShipping: v.requiresShipping ?? input.kind === "physical",
      trackInventory: input.kind === "digital" ? false : v.trackInventory,
      allowBackorder: v.allowBackorder,
      taxClassId: v.taxClassId ?? null,
      digitalAssetId: v.digitalAssetId ?? null,
      externalRef: v.externalRef ?? null,
    };
    let variantId = v.id;
    try {
      if (variantId) {
        if (!existingVariants.some((e) => e.id === variantId)) throw notFound("variant", variantId);
        await tx.update(productVariants).set(values).where(eq(productVariants.id, variantId));
      } else {
        variantId = newId();
        await tx.insert(productVariants).values({ id: variantId, ...scope, productId, ...values });
      }
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict("errors.product.sku_taken", { sku: v.sku });
      throw err;
    }
    variantIds.push(variantId);
    priceEntries.push({ variantId, amount: v.price, compareAtAmount: v.compareAtPrice ?? null, minQuantity: 1 });
    if (v.cost != null) await setVariantCost(tx, scope, variantId, { currency, amount: v.cost });

    if (values.trackInventory) {
      const itemId = await ensureInventoryItem(tx, scope, variantId, values.sku);
      if (!v.id && v.initialStock?.length) {
        for (const s of v.initialStock) {
          if (s.quantity === 0) continue;
          await applyLedgerEntry(tx, scope, {
            inventoryItemId: itemId,
            locationId: s.locationId ?? defaultLocationId,
            type: "initial_stock",
            quantity: s.quantity,
            referenceType: "product",
            referenceId: productId,
          });
        }
      }
    }
  }
  const baseList = await tx.query.priceLists.findFirst({ where: eq(priceLists.id, basePriceListId) });
  await upsertPriceEntries(tx, scope, baseList!, priceEntries);

  // Media
  await tx.delete(productMedia).where(eq(productMedia.productId, productId));
  for (const [i, m] of input.media.entries()) {
    await tx.insert(productMedia).values({
      id: newId(),
      ...scope,
      productId,
      assetId: m.assetId,
      position: i,
      alt: m.alt,
      variantIds: m.variantIndexes.map((vi) => variantIds[vi]).filter((x): x is string => !!x),
    });
  }
  await setAssetReferences(tx, scope, { type: "product", id: productId }, [
    ...input.media.map((m) => m.assetId),
    ...input.variants.map((v) => v.digitalAssetId).filter((x): x is string => !!x),
  ]);

  await syncTags(tx, scope, productId, input.tags);

  // Manual collections
  const manualIds = (
    await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, ctx.storeId), eq(collections.type, "manual")))
  ).map((c) => c.id);
  if (manualIds.length) {
    await tx.delete(productCollections).where(and(eq(productCollections.productId, productId), inArray(productCollections.collectionId, manualIds)));
  }
  for (const collectionId of input.collectionIds) {
    await tx.insert(productCollections).values({ collectionId, productId, ...scope }).onConflictDoNothing();
  }

  // Channel listings: default online store visible unless specified.
  if (input.channelVisibility) {
    await tx.delete(channelListings).where(eq(channelListings.productId, productId));
    for (const c of input.channelVisibility) {
      const ch = await tx.query.channels.findFirst({ where: and(eq(channels.id, c.channelId), eq(channels.storeId, ctx.storeId)) });
      if (!ch) throw notFound("channel", c.channelId);
      await tx.insert(channelListings).values({ productId, channelId: c.channelId, ...scope, isVisible: c.isVisible, availableForPurchase: c.availableForPurchase, publishedAt: new Date() });
    }
  } else if (!previous) {
    const defaultChannel = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ctx.storeId), eq(channels.isDefault, true)) });
    if (defaultChannel) await tx.insert(channelListings).values({ productId, channelId: defaultChannel.id, ...scope, isVisible: true, availableForPurchase: true, publishedAt: new Date() });
  }

  await refreshSearchDocument(tx, productId);

  await appendEvent(tx, {
    type: previous ? "product.updated" : "product.created",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    aggregateType: "product",
    aggregateId: productId,
    payload: previous ? { productId, fields: ["*"] } : { productId },
  } as Parameters<typeof appendEvent>[1]);
  if (becameActive) {
    await appendEvent(tx, {
      type: "product.published",
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      aggregateType: "product",
      aggregateId: productId,
      payload: { productId },
    });
  }
  return { productId };
}

async function bumpContentVersion(tx: Transaction, storeId: string) {
  await tx.execute(sql`update stores set content_version = content_version + 1 where id = ${storeId}`);
}

export async function createProduct(db: Database, ctx: StoreContext, raw: ProductInput) {
  assertCan(ctx, "catalog:write");
  const input = productInputSchema.parse(raw);
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const { productId } = await saveProductAggregate(tx, ctx, input);
    await bumpContentVersion(tx, ctx.storeId);
    await recordAudit(tx, { action: "product.created", resourceType: "product", resourceId: productId, after: { status: input.status, variants: input.variants.length } });
    return getProductTx(tx, ctx, productId);
  });
}

export async function updateProduct(db: Database, ctx: StoreContext, productId: string, raw: z.infer<typeof productUpdateSchema>) {
  assertCan(ctx, "catalog:write");
  const input = productUpdateSchema.parse(raw);
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const [current] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.storeId, ctx.storeId))).for("update");
    if (!current) throw notFound("product", productId);
    if (input.expectedUpdatedAt && current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw conflict("errors.content.revision_conflict", { updatedAt: current.updatedAt });
    }
    const before = await getProductTx(tx, ctx, productId);
    await saveProductAggregate(tx, ctx, input, productId);
    await bumpContentVersion(tx, ctx.storeId);
    const after = await getProductTx(tx, ctx, productId);
    await recordAudit(tx, {
      action: "product.updated",
      resourceType: "product",
      resourceId: productId,
      before: { status: before.status, variants: before.variants.map((v) => ({ id: v.id, sku: v.sku, price: v.price?.amount })) },
      after: { status: after.status, variants: after.variants.map((v) => ({ id: v.id, sku: v.sku, price: v.price?.amount })) },
    });
    return after;
  });
}

export const bulkStatusSchema = z.object({ productIds: z.array(z.uuid()).min(1).max(500), status: z.enum(["draft", "active", "archived"]) });

export async function bulkSetStatus(db: Database, ctx: StoreContext, input: z.infer<typeof bulkStatusSchema>) {
  assertCan(ctx, "catalog:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const rows = await tx.select().from(products).where(and(eq(products.storeId, ctx.storeId), inArray(products.id, input.productIds)));
    for (const p of rows) {
      if (p.status === input.status) continue;
      await tx
        .update(products)
        .set({ status: input.status, publishedAt: input.status === "active" && !p.publishedAt ? new Date() : p.publishedAt, publishAt: null })
        .where(eq(products.id, p.id));
      if (input.status === "active") {
        await appendEvent(tx, { type: "product.published", organizationId: ctx.organizationId, storeId: ctx.storeId, aggregateType: "product", aggregateId: p.id, payload: { productId: p.id } });
      } else {
        await appendEvent(tx, { type: "product.updated", organizationId: ctx.organizationId, storeId: ctx.storeId, aggregateType: "product", aggregateId: p.id, payload: { productId: p.id, fields: ["status"] } });
      }
    }
    await bumpContentVersion(tx, ctx.storeId);
    await recordAudit(tx, { action: "product.bulk_status", resourceType: "product", resourceId: null, after: { count: rows.length, status: input.status } });
    return { updated: rows.length };
  });
}

/** Draft products are deleted; anything that was ever published is archived to keep order history intact. */
export async function deleteProduct(db: Database, ctx: StoreContext, productId: string): Promise<{ outcome: "deleted" | "archived" }> {
  assertCan(ctx, "catalog:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const p = await tx.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.storeId, ctx.storeId)) });
    if (!p) throw notFound("product", productId);
    let outcome: "deleted" | "archived";
    if (!p.publishedAt) {
      await setAssetReferences(tx, scopeOf(ctx), { type: "product", id: productId }, []);
      await tx.delete(products).where(eq(products.id, productId));
      outcome = "deleted";
    } else {
      await tx.update(products).set({ status: "archived" }).where(eq(products.id, productId));
      outcome = "archived";
    }
    await bumpContentVersion(tx, ctx.storeId);
    await recordAudit(tx, { action: `product.${outcome}`, resourceType: "product", resourceId: productId });
    return { outcome };
  });
}

// ---------------------------------------------------------------------------
// Read model (admin)
// ---------------------------------------------------------------------------

export async function getProductTx(tx: Transaction, ctx: StoreContext, productId: string) {
  const p = await tx.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.storeId, ctx.storeId)) });
  if (!p) throw notFound("product", productId);
  const [translations, options, variants, media, tagRows, collectionRows, vendor, listings] = await Promise.all([
    tx.select().from(productTranslations).where(eq(productTranslations.productId, productId)),
    tx.select().from(productOptions).where(eq(productOptions.productId, productId)).orderBy(asc(productOptions.position)),
    tx.select().from(productVariants).where(and(eq(productVariants.productId, productId), isNull(productVariants.archivedAt))).orderBy(asc(productVariants.position)),
    tx.select({ media: productMedia, asset: contentAssets }).from(productMedia).innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId)).where(eq(productMedia.productId, productId)).orderBy(asc(productMedia.position)),
    tx.select({ name: tags.name }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(productTags.productId, productId)),
    tx.select({ collectionId: productCollections.collectionId }).from(productCollections).where(eq(productCollections.productId, productId)),
    p.vendorId ? tx.query.vendors.findFirst({ where: eq(vendors.id, p.vendorId) }) : Promise.resolve(undefined),
    tx.select().from(channelListings).where(eq(channelListings.productId, productId)),
  ]);
  const optionValues = options.length
    ? await tx.select().from(productOptionValues).where(inArray(productOptionValues.optionId, options.map((o) => o.id))).orderBy(asc(productOptionValues.position))
    : [];
  const variantIds = variants.map((v) => v.id);
  const currency = ctx.store.defaultCurrency;
  // The editable price is the base list price; sale/segment lists are managed separately.
  const prices = await resolvePrices(tx, { storeId: ctx.storeId, currency, baseOnly: true }, variantIds.map((variantId) => ({ variantId })));
  const costs = await latestCosts(tx, ctx.storeId, variantIds, currency);
  const stock = await getStockForVariants(tx, scopeOf(ctx), variantIds);

  return {
    id: p.id,
    status: p.status,
    kind: p.kind,
    productType: p.productType,
    vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
    categoryId: p.categoryId,
    taxClassId: p.taxClassId,
    weightGrams: p.weightGrams,
    dimensionsMm: p.lengthMm !== null ? { length: p.lengthMm, width: p.widthMm ?? 0, height: p.heightMm ?? 0 } : null,
    attributes: p.attributes,
    publishAt: p.publishAt,
    publishedAt: p.publishedAt,
    externalRef: p.externalRef,
    translations: Object.fromEntries(
      translations.map((t) => [t.locale, { title: t.title, handle: t.handle, descriptionHtml: t.descriptionHtml, seoTitle: t.seoTitle, seoDescription: t.seoDescription }]),
    ),
    options: options.map((o) => ({
      id: o.id,
      name: o.name,
      values: optionValues.filter((v) => v.optionId === o.id).map((v) => ({ id: v.id, value: v.value, swatchColor: v.swatchColor, swatchAssetId: v.swatchAssetId })),
    })),
    variants: variants.map((v) => {
      const price = prices.get(v.id);
      const s = stock.get(v.id);
      return {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        optionValueIds: v.optionValueIds,
        weightGrams: v.weightGrams,
        requiresShipping: v.requiresShipping,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        taxClassId: v.taxClassId,
        digitalAssetId: v.digitalAssetId,
        externalRef: v.externalRef,
        price: price ? { amount: price.amount, compareAtAmount: price.compareAtAmount, currency } : null,
        cost: costs.get(v.id) ?? null,
        inventory: s ? { onHand: s.onHand, reserved: s.reserved, available: s.available, byLocation: s.byLocation } : null,
      };
    }),
    media: media.map((m) => ({
      id: m.media.id,
      assetId: m.asset.id,
      objectKey: m.asset.objectKey,
      kind: m.asset.kind,
      width: m.asset.width,
      height: m.asset.height,
      alt: m.media.alt,
      variantIds: m.media.variantIds,
    })),
    tags: tagRows.map((t) => t.name),
    collectionIds: collectionRows.map((c) => c.collectionId),
    channelListings: listings.map((l) => ({ channelId: l.channelId, isVisible: l.isVisible, availableForPurchase: l.availableForPurchase })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function getProduct(db: Database, ctx: StoreContext, productId: string) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => getProductTx(tx, ctx, productId));
}

export const listProductsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  collectionId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  tag: z.string().max(64).optional(),
  sku: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Admin product list with search and keyset pagination on (updated_at desc, id desc). */
export async function listProducts(db: Database, ctx: StoreContext, q: z.infer<typeof listProductsQuerySchema>) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const filters = [eq(products.storeId, ctx.storeId)];
    if (q.status) filters.push(eq(products.status, q.status));
    if (q.vendorId) filters.push(eq(products.vendorId, q.vendorId));
    if (q.collectionId) {
      filters.push(sql`exists (select 1 from ${productCollections} pc where pc.product_id = ${products.id} and pc.collection_id = ${q.collectionId})`);
    }
    if (q.tag) {
      filters.push(sql`exists (select 1 from ${productTags} pt join ${tags} t on t.id = pt.tag_id where pt.product_id = ${products.id} and lower(t.name) = lower(${q.tag}))`);
    }
    if (q.sku) {
      filters.push(sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku = ${q.sku})`);
    }
    const tsq = q.q ? toPrefixTsQuery(q.q) : null;
    if (tsq) filters.push(sql`${products.searchDocument} @@ to_tsquery('simple', ${tsq})`);
    if (q.cursor) {
      const [ts, id] = decodeCursor(q.cursor) as [string, string];
      const at = new Date(ts);
      filters.push(or(lt(products.updatedAt, at), and(eq(products.updatedAt, at), lt(products.id, id)))!);
    }
    const rows = await tx
      .select({ id: products.id, status: products.status, updatedAt: products.updatedAt, createdAt: products.createdAt, vendorId: products.vendorId })
      .from(products)
      .where(and(...filters))
      .orderBy(desc(products.updatedAt), desc(products.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const ids = page.map((r) => r.id);
    const titles = ids.length
      ? await tx.select().from(productTranslations).where(and(inArray(productTranslations.productId, ids), eq(productTranslations.locale, ctx.store.defaultLocale)))
      : [];
    const variantRows = ids.length
      ? await tx.select({ id: productVariants.id, productId: productVariants.productId, sku: productVariants.sku }).from(productVariants).where(and(inArray(productVariants.productId, ids), isNull(productVariants.archivedAt)))
      : [];
    const firstMedia = ids.length
      ? await tx
          .select({ productId: productMedia.productId, objectKey: contentAssets.objectKey, position: productMedia.position })
          .from(productMedia)
          .innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId))
          .where(and(inArray(productMedia.productId, ids), eq(productMedia.position, 0)))
      : [];
    const stock = await getStockForVariants(tx, scopeOf(ctx), variantRows.map((v) => v.id));
    const prices = await resolvePrices(tx, { storeId: ctx.storeId, currency: ctx.store.defaultCurrency, baseOnly: true }, variantRows.map((v) => ({ variantId: v.id })));
    const last = page.at(-1);
    return {
      items: page.map((r) => {
        const vs = variantRows.filter((v) => v.productId === r.id);
        const amounts = vs.map((v) => prices.get(v.id)?.amount).filter((a): a is bigint => a !== undefined);
        const t = titles.find((x) => x.productId === r.id);
        return {
          id: r.id,
          title: t?.title ?? "",
          handle: t?.handle ?? "",
          status: r.status,
          variantCount: vs.length,
          skus: vs.map((v) => v.sku).filter(Boolean) as string[],
          totalAvailable: vs.reduce((s, v) => s + (stock.get(v.id)?.tracked ? stock.get(v.id)!.available : 0), 0),
          priceMin: amounts.length ? amounts.reduce((a, b) => (a < b ? a : b)) : null,
          priceMax: amounts.length ? amounts.reduce((a, b) => (a > b ? a : b)) : null,
          currency: ctx.store.defaultCurrency,
          imageObjectKey: firstMedia.find((m) => m.productId === r.id)?.objectKey ?? null,
          updatedAt: r.updatedAt,
        };
      }),
      nextCursor: rows.length > q.limit && last ? encodeCursor([last.updatedAt.toISOString(), last.id]) : null,
    };
  });
}

/** Worker: activates products whose scheduled publish time has passed. */
export async function runScheduledProductPublishing(db: Database): Promise<number> {
  const due = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: products.id, organizationId: products.organizationId, storeId: products.storeId })
      .from(products)
      .where(and(eq(products.status, "draft"), lte(products.publishAt, new Date())))
      .limit(200),
  );
  for (const p of due) {
    await withTenantTx(db, { organizationId: p.organizationId, storeId: p.storeId }, async (tx) => {
      await tx.update(products).set({ status: "active", publishedAt: new Date(), publishAt: null }).where(eq(products.id, p.id));
      await appendEvent(tx, { type: "product.published", organizationId: p.organizationId, storeId: p.storeId, aggregateType: "product", aggregateId: p.id, payload: { productId: p.id } });
      await bumpContentVersion(tx, p.storeId);
    });
  }
  return due.length;
}

