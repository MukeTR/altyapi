import {
  and,
  asc,
  categories,
  channelListings,
  channels,
  contentAssets,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  productMedia,
  productOptions,
  productOptionValues,
  products,
  productTranslations,
  productVariants,
  sql,
  taxClasses,
  variantCosts,
  vendors,
  withTenantTx,
  type LocalizedText,
  type Transaction,
} from "@altyapi/database";
import { stripHtml } from "@altyapi/catalog";
import { getStockForVariants } from "@altyapi/inventory";
import { resolvePrices } from "@altyapi/pricing";
import { imageUrl } from "@altyapi/storage";
import { EkosistemError } from "../../errors";
import { wireMoney, wireMoneyOrNull, type WireMoney } from "../../money";
import type { CostObject, Tombstone } from "../../schemas";
import { loadStoreIdentity, storeUrl, type EkosistemServerDeps, type LinkRow, type StoreIdentity } from "../common";
import { isUuidRef, pageKeys, parseIncrementalQuery, tombstone, transactionNow, uuidRefs, type IncrementalPage, type PageKey } from "./incremental";
import { loadStorefrontFacts, pickLocalized } from "./storefront";

/**
 * GET /ekosistem/v1/catalog/products (§7.2). The full set is what the storefront shows
 * (active, publish time passed, visible on the online store channel). With `since`, every
 * product that was ever published and changed since then is returned with its status, and
 * deleted products as tombstones. Cost fields are filled only with costs:read.
 *
 * A product's updatedAt covers everything the item contains: the product row, variants,
 * prices (including price-list activation, deletion and schedule boundaries), stock, costs,
 * tax classes and categories.
 */

export interface CatalogVariant {
  ref: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  price: WireMoney | null;
  compareAtPrice: WireMoney | null;
  taxRateBps: number | null;
  taxIncluded: boolean;
  available: number | null;
  inStock: boolean;
  weightGrams: number | null;
  desi: number | null;
  cost: CostObject | null;
}

export interface CatalogProduct {
  ref: string;
  status: "active" | "draft" | "archived";
  published: boolean;
  handle: string;
  url: string;
  title: string;
  description: string;
  brand: string | null;
  productType: string | null;
  categories: string[];
  googleCategoryId: number | null;
  imageUrl: string | null;
  seo: { title: string; description: string | null };
  structuredData: { product: boolean; brand: boolean; gtin: boolean; price: boolean; availability: boolean; image: boolean; description: boolean; score: number };
  variants: CatalogVariant[];
  updatedAt: string;
}

interface ExportContext {
  identity: StoreIdentity;
  channelId: string | null;
  withCosts: boolean;
  mediaBaseUrl: string | null;
  productJsonLd: boolean;
  now: Date;
}

/**
 * Effective updatedAt of each product of the store (see module comment). Tax classes
 * (taxRateBps, taxIncluded, the default class) and categories (path, Google category) are
 * taken store-wide: they change rarely and any change may alter every product that uses
 * them. A deleted price list moves its variants' updated_at (packages/pricing deletePriceList).
 */
function productEffSql(storeId: string) {
  return sql`
    select p.id, p.status, p.published_at, greatest(
      p.updated_at,
      coalesce((select max(v.updated_at) from product_variants v where v.product_id = p.id), p.updated_at),
      coalesce((select max(greatest(ma.updated_at, pl.updated_at)) from money_amounts ma
                  join price_lists pl on pl.id = ma.price_list_id
                  join product_variants v on v.id = ma.variant_id
                 where v.product_id = p.id), p.updated_at),
      coalesce((select max(b.at) from (
                  select sp.starts_at as at from scheduled_prices sp
                    join money_amounts ma on ma.price_list_id = sp.price_list_id
                    join product_variants v on v.id = ma.variant_id
                   where v.product_id = p.id and sp.starts_at <= now()
                  union all
                  select sp.ends_at from scheduled_prices sp
                    join money_amounts ma on ma.price_list_id = sp.price_list_id
                    join product_variants v on v.id = ma.variant_id
                   where v.product_id = p.id and sp.ends_at <= now()) b), p.updated_at),
      coalesce((select max(il.updated_at) from inventory_levels il
                  join inventory_items ii on ii.id = il.inventory_item_id
                  join product_variants v on v.id = ii.variant_id
                 where v.product_id = p.id), p.updated_at),
      coalesce((select max(vc.effective_from) from variant_costs vc
                  join product_variants v on v.id = vc.variant_id
                 where v.product_id = p.id and vc.effective_from <= now()), p.updated_at),
      coalesce((select max(tc.updated_at) from tax_classes tc where tc.store_id = ${storeId}), p.updated_at),
      case when p.category_id is null then p.updated_at
           else coalesce((select max(c.updated_at) from categories c where c.store_id = ${storeId}), p.updated_at) end
    ) as eff
    from products p
    where p.store_id = ${storeId}`;
}

/** The storefront's visibility predicate (active, publish time passed, visible on the channel). */
function visibleSql(channelId: string | null) {
  const channel = channelId ? sql`and exists (select 1 from channel_listings cl where cl.product_id = e.id and cl.channel_id = ${channelId} and cl.is_visible)` : sql``;
  return sql`e.status = 'active' and (e.published_at is null or e.published_at <= now()) ${channel}`;
}

function fullSetSource(storeId: string, channelId: string | null) {
  return sql`select e.id::text as ref, false as deleted, e.eff from (${productEffSql(storeId)}) e where ${visibleSql(channelId)}`;
}

/** Ever-published products (drafts never shown to anyone stay private) plus tombstones. */
function sinceSource(storeId: string) {
  return sql`
    select e.id::text as ref, false as deleted, e.eff from (${productEffSql(storeId)}) e where e.published_at is not null
    union all
    select t.ref, true as deleted, t.deleted_at as eff from ekosistem_tombstones t where t.store_id = ${storeId} and t.resource = 'product'`;
}

function costSource(source: string): CostObject["source"] {
  if (source === "manual" || source === "import" || source === "karmatik") return source;
  if (source.startsWith("integration")) return "integration";
  return "store";
}

/** Desi (Turkish volumetric weight) = length × width × height in cm / 3000; null without all dimensions. */
function desiOf(p: { lengthMm: number | null; widthMm: number | null; heightMm: number | null }): number | null {
  if (!p.lengthMm || !p.widthMm || !p.heightMm) return null;
  return Math.round(((p.lengthMm * p.widthMm * p.heightMm) / 3_000_000) * 100) / 100;
}

async function exportContext(tx: Transaction, deps: EkosistemServerDeps, link: LinkRow, withCosts: boolean, productJsonLd: boolean): Promise<ExportContext> {
  const identity = await loadStoreIdentity(tx, link.storeId, deps.storeRootDomain);
  if (!identity) throw new EkosistemError("link_invalid");
  const [channel] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.storeId, link.storeId), eq(channels.isDefault, true)));
  return { identity, channelId: channel?.id ?? null, withCosts, mediaBaseUrl: deps.mediaBaseUrl, productJsonLd, now: await transactionNow(tx) };
}

async function buildProducts(tx: Transaction, ec: ExportContext, ids: string[], eff: Map<string, Date>): Promise<Map<string, CatalogProduct>> {
  const out = new Map<string, CatalogProduct>();
  if (!ids.length) return out;
  const storeId = ec.identity.storeId;
  const locale = ec.identity.defaultLocale;
  const [rows, translations, variants, options, media, taxRows, listings] = await Promise.all([
    tx.select().from(products).where(and(eq(products.storeId, storeId), inArray(products.id, ids))),
    tx.select().from(productTranslations).where(inArray(productTranslations.productId, ids)),
    tx
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), isNull(productVariants.archivedAt)))
      .orderBy(asc(productVariants.position)),
    tx.select().from(productOptions).where(inArray(productOptions.productId, ids)).orderBy(asc(productOptions.position)),
    tx
      .select({ productId: productMedia.productId, position: productMedia.position, objectKey: contentAssets.objectKey })
      .from(productMedia)
      .innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId))
      .where(and(inArray(productMedia.productId, ids), eq(contentAssets.status, "ready"), isNull(contentAssets.deletedAt)))
      .orderBy(asc(productMedia.position)),
    tx.select().from(taxClasses).where(eq(taxClasses.storeId, storeId)),
    ec.channelId
      ? tx
          .select({ productId: channelListings.productId })
          .from(channelListings)
          .where(and(eq(channelListings.channelId, ec.channelId), eq(channelListings.isVisible, true), inArray(channelListings.productId, ids)))
      : Promise.resolve([] as { productId: string }[]),
  ]);
  const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter((v): v is string => !!v))];
  const vendorRows = vendorIds.length ? await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, vendorIds)) : [];
  const categoryRows = rows.some((r) => r.categoryId) ? await tx.select().from(categories).where(eq(categories.storeId, storeId)) : [];
  const optionValues = options.length
    ? await tx.select().from(productOptionValues).where(inArray(productOptionValues.optionId, options.map((o) => o.id))).orderBy(asc(productOptionValues.position))
    : [];
  const variantIds = variants.map((v) => v.id);
  const [prices, stock, costRows] = await Promise.all([
    resolvePrices(tx, { storeId, currency: ec.identity.defaultCurrency, channelId: ec.channelId, customerGroupIds: [], at: ec.now }, variantIds.map((variantId) => ({ variantId }))),
    getStockForVariants(tx, { organizationId: ec.identity.organizationId, storeId }, variantIds),
    ec.withCosts && variantIds.length
      ? tx
          .select()
          .from(variantCosts)
          .where(and(eq(variantCosts.storeId, storeId), eq(variantCosts.currency, ec.identity.defaultCurrency), inArray(variantCosts.variantId, variantIds), lte(variantCosts.effectiveFrom, ec.now)))
          .orderBy(desc(variantCosts.effectiveFrom))
      : Promise.resolve([] as (typeof variantCosts.$inferSelect)[]),
  ]);
  const latestCost = new Map<string, typeof variantCosts.$inferSelect>();
  for (const c of costRows) if (!latestCost.has(c.variantId)) latestCost.set(c.variantId, c);
  const visible = new Set(listings.map((l) => l.productId));
  const defaultTax = taxRows.find((t) => t.isDefault) ?? null;
  const categoryById = new Map(categoryRows.map((c) => [c.id, c]));
  const valueLabel = new Map(optionValues.map((v) => [v.id, pickLocalized(v.value as LocalizedText, locale, locale)]));

  for (const p of rows) {
    const tr = translations.find((t) => t.productId === p.id && t.locale === locale) ?? translations.find((t) => t.productId === p.id);
    if (!tr) continue;
    const title = tr.title;
    const description = stripHtml(tr.descriptionHtml).slice(0, 5000);
    const published = p.status === "active" && (!p.publishedAt || p.publishedAt <= ec.now) && (!ec.channelId || visible.has(p.id));

    // Category path "Giyim > Tişört" and the nearest Google category id on the way up.
    const trail: string[] = [];
    let googleCategoryId: number | null = null;
    let cursor = p.categoryId ? categoryById.get(p.categoryId) : undefined;
    for (let depth = 0; cursor && depth < 8; depth++) {
      trail.unshift(pickLocalized(cursor.name, locale, locale));
      if (googleCategoryId === null && cursor.googleCategoryId !== null) googleCategoryId = cursor.googleCategoryId;
      cursor = cursor.parentId ? categoryById.get(cursor.parentId) : undefined;
    }

    const productOptionsList = options.filter((o) => o.productId === p.id);
    const vs = variants.filter((v) => v.productId === p.id);
    const variantItems: CatalogVariant[] = vs.map((v) => {
      const price = prices.get(v.id);
      const s = stock.get(v.id);
      const tax = taxRows.find((t) => t.id === (v.taxClassId ?? p.taxClassId)) ?? defaultTax;
      const labels = productOptionsList.flatMap((o) => {
        const match = optionValues.find((val) => val.optionId === o.id && v.optionValueIds.includes(val.id));
        return match ? [valueLabel.get(match.id) ?? ""] : [];
      });
      const tracked = s ? s.tracked : v.trackInventory;
      const allowBackorder = s ? s.allowBackorder : v.allowBackorder;
      const available = tracked ? Math.max(0, s?.available ?? 0) : null;
      const cost = ec.withCosts ? latestCost.get(v.id) : undefined;
      return {
        ref: v.id,
        sku: v.sku,
        barcode: v.barcode,
        title: labels.filter(Boolean).join(" / ") || title,
        price: price ? wireMoney(price.amount, ec.identity.defaultCurrency) : null,
        compareAtPrice: price ? wireMoneyOrNull(price.compareAtAmount, ec.identity.defaultCurrency) : null,
        // Unresolved tax class: the rate is unknown (null), prices are charged as tax-inclusive like checkout does.
        taxRateBps: tax ? tax.rateBps : null,
        taxIncluded: tax ? tax.pricesIncludeTax : true,
        available,
        inStock: !tracked || allowBackorder || (available ?? 0) > 0,
        weightGrams: v.weightGrams ?? p.weightGrams ?? null,
        desi: desiOf(p),
        cost: cost
          ? {
              amount: cost.amount.toString(),
              currency: cost.currency,
              taxIncluded: cost.taxIncluded,
              taxRateBps: cost.taxRateBps,
              source: costSource(cost.source),
              effectiveFrom: cost.effectiveFrom.toISOString(),
            }
          : null,
      };
    });

    const firstImage = media.find((m) => m.productId === p.id) ?? null;
    const brand = vendorRows.find((v) => v.id === p.vendorId)?.name ?? null;
    // Product JSON-LD as the storefront renders it (apps/storefront components/sections/commerce.tsx).
    const emitted = published && ec.productJsonLd;
    const offers = variantItems.some((v) => v.price !== null);
    const checks = {
      name: emitted && title.trim() !== "",
      brand: emitted && brand !== null,
      gtin: emitted && vs.some((v) => !!v.barcode),
      price: emitted && offers,
      availability: emitted && offers,
      image: emitted && firstImage !== null && ec.mediaBaseUrl !== null,
      description: emitted && description !== "",
    };
    const score = Math.round((Object.values(checks).filter(Boolean).length / 7) * 100);
    out.set(p.id, {
      ref: p.id,
      status: p.status,
      published,
      handle: tr.handle,
      url: storeUrl(ec.identity.canonicalHost, `/products/${encodeURIComponent(tr.handle)}`),
      title,
      description,
      brand,
      productType: p.productType,
      categories: trail.length ? [trail.join(" > ")] : [],
      googleCategoryId,
      imageUrl: firstImage && ec.mediaBaseUrl ? imageUrl(ec.mediaBaseUrl, firstImage.objectKey, { preset: "product" }) : null,
      seo: { title: tr.seoTitle || title, description: tr.seoDescription || description.slice(0, 160) || null },
      structuredData: {
        product: emitted,
        brand: checks.brand,
        gtin: checks.gtin,
        price: checks.price,
        availability: checks.availability,
        image: checks.image,
        description: checks.description,
        score,
      },
      variants: variantItems,
      updatedAt: (eff.get(p.id) ?? p.updatedAt).toISOString(),
    });
  }
  return out;
}

export interface CatalogExportOptions {
  withCosts: boolean;
}

/** GET /ekosistem/v1/catalog/products with since/cursor/limit, or with refs=a,b (≤ 50). */
export async function exportCatalogProducts(
  deps: EkosistemServerDeps,
  link: LinkRow,
  query: ReadonlyArray<readonly [string, string]>,
  opts: CatalogExportOptions,
): Promise<IncrementalPage<CatalogProduct>> {
  const req = parseIncrementalQuery(query, { allowRefs: true });
  const scope = { organizationId: link.organizationId, storeId: link.storeId };
  const facts = await loadStorefrontFacts(deps.db, scope);
  return withTenantTx(deps.db, scope, async (tx) => {
    const ec = await exportContext(tx, deps, link, opts.withCosts, facts.productJsonLd);
    if (req.refs) {
      const refs = uuidRefs(req.refs);
      const keys = refs.length
        ? [
            ...(await tx.execute<{ ref: string; deleted: boolean; eff: Date | string }>(sql`
              select k.ref, k.deleted, k.eff from (${sinceSource(link.storeId)}) k where k.ref in (${sql.join(refs.map((r) => sql`${r}`), sql`, `)})`)),
          ]
        : [];
      const eff = new Map(keys.map((k) => [k.ref, k.eff instanceof Date ? k.eff : new Date(k.eff)]));
      const built = await buildProducts(tx, ec, keys.filter((k) => !k.deleted).map((k) => k.ref), eff);
      const items = refs.flatMap((r): Array<CatalogProduct | Tombstone> => {
        const k = keys.find((x) => x.ref === r);
        if (!k) return [];
        if (k.deleted) return [tombstone({ ref: r, updatedAt: eff.get(r)! })];
        const p = built.get(r);
        return p ? [p] : [];
      });
      return { items, nextCursor: null, asOf: ec.now.toISOString() };
    }
    const source = req.since ? sinceSource(link.storeId) : fullSetSource(link.storeId, ec.channelId);
    const page = await pageKeys(tx, source, req);
    const built = await buildProducts(tx, ec, page.keys.filter((k) => !k.deleted).map((k) => k.ref), new Map(page.keys.map((k) => [k.ref, k.updatedAt])));
    return { items: assemble(page.keys, built), nextCursor: page.nextCursor, asOf: ec.now.toISOString() };
  });
}

function assemble<T>(keys: PageKey[], built: Map<string, T>): Array<T | Tombstone> {
  return keys.flatMap((k): Array<T | Tombstone> => {
    if (k.deleted) return [tombstone(k)];
    const item = built.get(k.ref);
    return item ? [item] : [];
  });
}

/** GET /ekosistem/v1/catalog/products/{ref}: 404 when unknown, never published or deleted. */
export async function exportCatalogProduct(deps: EkosistemServerDeps, link: LinkRow, ref: string, opts: CatalogExportOptions): Promise<CatalogProduct> {
  if (!isUuidRef(ref)) throw new EkosistemError("not_found");
  const id = ref.toLowerCase();
  const scope = { organizationId: link.organizationId, storeId: link.storeId };
  const facts = await loadStorefrontFacts(deps.db, scope);
  return withTenantTx(deps.db, scope, async (tx) => {
    const ec = await exportContext(tx, deps, link, opts.withCosts, facts.productJsonLd);
    const [row] = await tx.execute<{ ref: string; eff: Date | string }>(sql`
      select k.ref, k.eff from (${sinceSource(link.storeId)}) k where k.ref = ${id} and not k.deleted`);
    if (!row) throw new EkosistemError("not_found");
    const built = await buildProducts(tx, ec, [id], new Map([[id, row.eff instanceof Date ? row.eff : new Date(row.eff)]]));
    const item = built.get(id);
    if (!item) throw new EkosistemError("not_found");
    return item;
  });
}

export { assemble as assembleIncremental };
