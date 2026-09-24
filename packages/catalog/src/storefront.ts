import {
  and,
  asc,
  channelListings,
  collections,
  collectionTranslations,
  contentAssets,
  eq,
  inArray,
  pgArray,
  isNull,
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
  vendors,
  withTenantTx,
  type LocalizedText,
  type Transaction,
} from "@altyapi/database";
import { getStockForVariants } from "@altyapi/inventory";
import { resolvePrices, type PriceContext } from "@altyapi/pricing";
import { toPrefixTsQuery } from "./text";

export interface StorefrontRef {
  organizationId: string;
  storeId: string;
}

export interface StorefrontQueryContext extends StorefrontRef {
  locale: string;
  defaultLocale: string;
  currency: string;
  channelId: string | null;
  customerGroupIds?: string[];
}

export interface MediaDto {
  assetId: string;
  objectKey: string;
  kind: string;
  width: number | null;
  height: number | null;
  alt: string;
  variantIds: string[];
}

export interface VariantDto {
  id: string;
  sku: string | null;
  title: string;
  optionValueIds: string[];
  price: { amount: string; compareAtAmount: string | null; currency: string } | null;
  available: boolean;
  /** Exact quantity only when low (≤ 5) so storefronts can show "last 3 items". */
  lowStockQuantity: number | null;
  requiresShipping: boolean;
}

export interface ProductCardDto {
  id: string;
  handle: string;
  title: string;
  vendor: string | null;
  image: MediaDto | null;
  secondaryImage: MediaDto | null;
  priceMin: string | null;
  priceMax: string | null;
  compareAtMin: string | null;
  currency: string;
  available: boolean;
  onSale: boolean;
  defaultVariantId: string | null;
  hasMultipleVariants: boolean;
}

export interface ProductDetailDto extends Omit<ProductCardDto, "image" | "secondaryImage"> {
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  productType: string | null;
  tags: string[];
  attributes: { key: string; label: string; value: string }[];
  options: { id: string; name: string; values: { id: string; value: string; swatchColor: string | null }[] }[];
  variants: VariantDto[];
  media: MediaDto[];
  alternateHandles: Record<string, string>;
  categoryId: string | null;
  updatedAt: string;
  barcodes: string[];
}

const pick = (map: LocalizedText, locale: string, fallback: string) => map[locale] ?? map[fallback] ?? Object.values(map)[0] ?? "";

/** SQL predicate: product is visible on the storefront channel right now. */
function visibleSql(channelId: string | null) {
  const channel = channelId
    ? sql`and exists (select 1 from ${channelListings} cl where cl.product_id = ${products.id} and cl.channel_id = ${channelId} and cl.is_visible)`
    : sql``;
  return sql`${products.status} = 'active' and (${products.publishedAt} is null or ${products.publishedAt} <= now()) ${channel}`;
}

async function loadCards(tx: Transaction, ctx: StorefrontQueryContext, productIds: string[]): Promise<ProductCardDto[]> {
  if (!productIds.length) return [];
  const [trs, variants, media, vendorRows] = await Promise.all([
    tx.select().from(productTranslations).where(and(inArray(productTranslations.productId, productIds), inArray(productTranslations.locale, [ctx.locale, ctx.defaultLocale]))),
    tx
      .select({ id: productVariants.id, productId: productVariants.productId, position: productVariants.position })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, productIds), isNull(productVariants.archivedAt)))
      .orderBy(asc(productVariants.position)),
    tx
      .select({ m: productMedia, a: contentAssets })
      .from(productMedia)
      .innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId))
      .where(and(inArray(productMedia.productId, productIds), sql`${productMedia.position} < 2`)),
    tx
      .select({ productId: products.id, name: vendors.name })
      .from(products)
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(inArray(products.id, productIds)),
  ]);
  const variantIds = variants.map((v) => v.id);
  const priceCtx: PriceContext = { storeId: ctx.storeId, currency: ctx.currency, channelId: ctx.channelId, customerGroupIds: ctx.customerGroupIds ?? [] };
  const [prices, stock] = await Promise.all([
    resolvePrices(tx, priceCtx, variantIds.map((variantId) => ({ variantId }))),
    getStockForVariants(tx, ctx, variantIds),
  ]);
  const toMedia = (x: { m: typeof productMedia.$inferSelect; a: typeof contentAssets.$inferSelect }): MediaDto => ({
    assetId: x.a.id,
    objectKey: x.a.objectKey,
    kind: x.a.kind,
    width: x.a.width,
    height: x.a.height,
    alt: pick(x.m.alt, ctx.locale, ctx.defaultLocale),
    variantIds: x.m.variantIds,
  });

  return productIds.flatMap((id) => {
    const tr = trs.find((t) => t.productId === id && t.locale === ctx.locale) ?? trs.find((t) => t.productId === id);
    if (!tr) return [];
    const vs = variants.filter((v) => v.productId === id);
    const priced = vs.map((v) => prices.get(v.id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!priced.length) return []; // not sellable in this currency/channel
    const amounts = priced.map((p) => p.amount);
    const compare = priced.map((p) => p.compareAtAmount).filter((c): c is bigint => c !== null);
    const available = vs.some((v) => {
      const s = stock.get(v.id);
      return !s || !s.tracked || s.allowBackorder || s.available > 0;
    });
    const imgs = media.filter((m) => m.m.productId === id).sort((a, b) => a.m.position - b.m.position);
    const min = amounts.reduce((a, b) => (a < b ? a : b));
    const max = amounts.reduce((a, b) => (a > b ? a : b));
    return [
      {
        id,
        handle: tr.handle,
        title: tr.title,
        vendor: vendorRows.find((v) => v.productId === id)?.name ?? null,
        image: imgs[0] ? toMedia(imgs[0]) : null,
        secondaryImage: imgs[1] ? toMedia(imgs[1]) : null,
        priceMin: min.toString(),
        priceMax: max.toString(),
        compareAtMin: compare.length ? compare.reduce((a, b) => (a < b ? a : b)).toString() : null,
        currency: ctx.currency,
        available,
        onSale: compare.length > 0,
        defaultVariantId: vs[0]?.id ?? null,
        hasMultipleVariants: vs.length > 1,
      },
    ];
  });
}

/** Product detail by handle in the requested locale. Old handles resolve via slug history. */
export async function getStorefrontProduct(
  db: Parameters<typeof withTenantTx>[0],
  ctx: StorefrontQueryContext,
  handle: string,
): Promise<{ product: ProductDetailDto } | { redirectHandle: string } | null> {
  return withTenantTx(db, ctx, async (tx) => {
    const tr = await tx.query.productTranslations.findFirst({
      where: and(eq(productTranslations.storeId, ctx.storeId), eq(productTranslations.locale, ctx.locale), eq(productTranslations.handle, handle)),
    });
    if (!tr) {
      const old = await tx.query.slugHistory.findFirst({
        where: and(eq(slugHistory.storeId, ctx.storeId), eq(slugHistory.resourceType, "product"), eq(slugHistory.locale, ctx.locale), eq(slugHistory.slug, handle)),
      });
      if (!old) return null;
      const current = await tx.query.productTranslations.findFirst({
        where: and(eq(productTranslations.productId, old.resourceId), eq(productTranslations.locale, ctx.locale)),
      });
      return current ? { redirectHandle: current.handle } : null;
    }
    const [p] = await tx.select().from(products).where(and(eq(products.id, tr.productId), visibleSql(ctx.channelId)));
    if (!p) return null;
    const [card] = await loadCards(tx, ctx, [p.id]);
    if (!card) return null;

    const [allTr, options, variants, media, tagRows] = await Promise.all([
      tx.select({ locale: productTranslations.locale, handle: productTranslations.handle }).from(productTranslations).where(eq(productTranslations.productId, p.id)),
      tx.select().from(productOptions).where(eq(productOptions.productId, p.id)).orderBy(asc(productOptions.position)),
      tx.select().from(productVariants).where(and(eq(productVariants.productId, p.id), isNull(productVariants.archivedAt))).orderBy(asc(productVariants.position)),
      tx
        .select({ m: productMedia, a: contentAssets })
        .from(productMedia)
        .innerJoin(contentAssets, eq(contentAssets.id, productMedia.assetId))
        .where(eq(productMedia.productId, p.id))
        .orderBy(asc(productMedia.position)),
      tx.select({ name: tags.name }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(productTags.productId, p.id)),
    ]);
    const values = options.length
      ? await tx.select().from(productOptionValues).where(inArray(productOptionValues.optionId, options.map((o) => o.id))).orderBy(asc(productOptionValues.position))
      : [];
    const priceCtx: PriceContext = { storeId: ctx.storeId, currency: ctx.currency, channelId: ctx.channelId, customerGroupIds: ctx.customerGroupIds ?? [] };
    const prices = await resolvePrices(tx, priceCtx, variants.map((v) => ({ variantId: v.id })));
    const stock = await getStockForVariants(tx, ctx, variants.map((v) => v.id));
    const valueLabel = new Map(values.map((v) => [v.id, pick(v.value, ctx.locale, ctx.defaultLocale)]));

    return {
      product: {
        ...card,
        descriptionHtml: tr.descriptionHtml,
        seoTitle: tr.seoTitle,
        seoDescription: tr.seoDescription,
        productType: p.productType,
        tags: tagRows.map((t) => t.name),
        attributes: p.attributes.map((a) => ({ key: a.key, label: pick(a.label, ctx.locale, ctx.defaultLocale), value: pick(a.value, ctx.locale, ctx.defaultLocale) })),
        options: options.map((o) => ({
          id: o.id,
          name: pick(o.name, ctx.locale, ctx.defaultLocale),
          values: values.filter((v) => v.optionId === o.id).map((v) => ({ id: v.id, value: pick(v.value, ctx.locale, ctx.defaultLocale), swatchColor: v.swatchColor })),
        })),
        variants: variants.map((v) => {
          const price = prices.get(v.id);
          const s = stock.get(v.id);
          const unlimited = !s || !s.tracked || s.allowBackorder;
          // Titles follow option order, e.g. "Kırmızı / M".
          const ordered = options.flatMap((o) => {
            const match = values.find((val) => val.optionId === o.id && v.optionValueIds.includes(val.id));
            return match ? [valueLabel.get(match.id) ?? ""] : [];
          });
          return {
            id: v.id,
            sku: v.sku,
            title: ordered.join(" / ") || card.title,
            optionValueIds: v.optionValueIds,
            price: price ? { amount: price.amount.toString(), compareAtAmount: price.compareAtAmount?.toString() ?? null, currency: ctx.currency } : null,
            available: unlimited || (s?.available ?? 0) > 0,
            lowStockQuantity: !unlimited && s && s.available > 0 && s.available <= 5 ? s.available : null,
            requiresShipping: v.requiresShipping,
          };
        }),
        media: media.map((x) => ({
          assetId: x.a.id,
          objectKey: x.a.objectKey,
          kind: x.a.kind,
          width: x.a.width,
          height: x.a.height,
          alt: pick(x.m.alt, ctx.locale, ctx.defaultLocale) || card.title,
          variantIds: x.m.variantIds,
        })),
        alternateHandles: Object.fromEntries(allTr.map((t) => [t.locale, t.handle])),
        categoryId: p.categoryId,
        updatedAt: p.updatedAt.toISOString(),
        barcodes: variants.map((v) => v.barcode).filter((b): b is string => !!b),
      },
    };
  });
}

export type ListingSort = "manual" | "best_selling" | "newest" | "price_asc" | "price_desc" | "title_asc" | "title_desc" | "relevance";

export interface ListingQuery {
  collectionId?: string;
  tag?: string;
  productIds?: string[];
  search?: string;
  onSaleOnly?: boolean;
  vendorIds?: string[];
  optionValueLabels?: string[];
  inStockOnly?: boolean;
  priceMin?: bigint;
  priceMax?: bigint;
  sort?: ListingSort;
  limit: number;
  offset?: number;
}

/**
 * Storefront listing used by collection pages, search and product-grid sections. Sorting
 * and filtering happen in SQL against the base price list of the requested currency;
 * displayed prices are then resolved per customer context.
 */
export async function listStorefrontProducts(
  db: Parameters<typeof withTenantTx>[0],
  ctx: StorefrontQueryContext,
  q: ListingQuery,
): Promise<{ items: ProductCardDto[]; total: number }> {
  return withTenantTx(db, ctx, async (tx) => {
    const conds = [sql`${products.storeId} = ${ctx.storeId}`, visibleSql(ctx.channelId)];
    if (q.collectionId) conds.push(sql`exists (select 1 from product_collections pc where pc.product_id = ${products.id} and pc.collection_id = ${q.collectionId})`);
    if (q.tag) conds.push(sql`exists (select 1 from product_tags pt join tags t on t.id = pt.tag_id where pt.product_id = ${products.id} and lower(t.name) = lower(${q.tag}))`);
    if (q.productIds) conds.push(q.productIds.length ? sql`${products.id} = any(${pgArray(q.productIds, "uuid")})` : sql`false`);
    if (q.vendorIds?.length) conds.push(sql`${products.vendorId} = any(${pgArray(q.vendorIds, "uuid")})`);
    const tsq = q.search ? toPrefixTsQuery(q.search) : null;
    if (q.search && !tsq) return { items: [], total: 0 };
    if (tsq) conds.push(sql`${products.searchDocument} @@ to_tsquery('simple', ${tsq})`);
    const basePrice = sql`(select min(ma.amount) from product_variants pv join money_amounts ma on ma.variant_id = pv.id
      join price_lists pl on pl.id = ma.price_list_id and pl.kind = 'base' and pl.currency = ${ctx.currency}
      where pv.product_id = ${products.id} and pv.archived_at is null and ma.min_quantity = 1)`;
    // Products must be sellable in the currency.
    conds.push(sql`${basePrice} is not null`);
    if (q.priceMin !== undefined) conds.push(sql`${basePrice} >= ${q.priceMin}`);
    if (q.priceMax !== undefined) conds.push(sql`${basePrice} <= ${q.priceMax}`);
    if (q.onSaleOnly) {
      conds.push(sql`exists (select 1 from product_variants pv join money_amounts ma on ma.variant_id = pv.id
        where pv.product_id = ${products.id} and ma.compare_at_amount > ma.amount)`);
    }
    if (q.optionValueLabels?.length) {
      conds.push(sql`exists (select 1 from product_options po join product_option_values pov on pov.option_id = po.id
        where po.product_id = ${products.id} and lower(pov.value->>${ctx.locale}) = any(${pgArray(q.optionValueLabels.map((l) => l.toLocaleLowerCase("tr")), "text")}))`);
    }
    if (q.inStockOnly) {
      conds.push(sql`exists (select 1 from product_variants pv left join inventory_items ii on ii.variant_id = pv.id
        left join inventory_levels il on il.inventory_item_id = ii.id
        where pv.product_id = ${products.id} and pv.archived_at is null
        group by pv.id, pv.track_inventory, pv.allow_backorder
        having not pv.track_inventory or pv.allow_backorder or coalesce(sum(il.on_hand - il.reserved), 0) > 0)`);
    }
    const where = sql.join(conds, sql` and `);
    const title = sql`(select title from product_translations t where t.product_id = ${products.id} and t.locale = ${ctx.locale})`;
    const sort = q.sort ?? (tsq ? "relevance" : q.collectionId ? "manual" : "newest");
    const order = {
      relevance: tsq ? sql`ts_rank(${products.searchDocument}, to_tsquery('simple', ${tsq})) desc, ${products.id}` : sql`${products.publishedAt} desc nulls last, ${products.id}`,
      manual: q.collectionId
        ? sql`(select position from product_collections pc where pc.product_id = ${products.id} and pc.collection_id = ${q.collectionId}), ${products.id}`
        : sql`${products.publishedAt} desc nulls last, ${products.id}`,
      best_selling: sql`(select count(*) from order_lines ol where ol.product_id = ${products.id}) desc, ${products.id}`,
      newest: sql`${products.publishedAt} desc nulls last, ${products.id}`,
      price_asc: sql`${basePrice} asc, ${products.id}`,
      price_desc: sql`${basePrice} desc, ${products.id}`,
      title_asc: sql`${title} asc, ${products.id}`,
      title_desc: sql`${title} desc, ${products.id}`,
    }[sort];

    const idRows = await tx.execute<{ id: string }>(sql`select ${products.id} as id from ${products} where ${where} order by ${order} limit ${q.limit} offset ${q.offset ?? 0}`);
    const [{ total }] = (await tx.execute<{ total: number }>(sql`select count(*)::int as total from ${products} where ${where}`)) as unknown as [{ total: number }];
    const items = await loadCards(tx, ctx, idRows.map((r) => r.id));
    return { items, total };
  });
}

export interface CollectionDto {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  imageObjectKey: string | null;
  sortOrder: string;
  alternateHandles: Record<string, string>;
}

export async function getStorefrontCollection(
  db: Parameters<typeof withTenantTx>[0],
  ctx: StorefrontQueryContext,
  handle: string,
): Promise<CollectionDto | null> {
  return withTenantTx(db, ctx, async (tx) => {
    const tr = await tx.query.collectionTranslations.findFirst({
      where: and(eq(collectionTranslations.storeId, ctx.storeId), eq(collectionTranslations.locale, ctx.locale), eq(collectionTranslations.handle, handle)),
    });
    if (!tr) return null;
    const c = await tx.query.collections.findFirst({ where: and(eq(collections.id, tr.collectionId), eq(collections.isPublished, true)) });
    if (!c) return null;
    const image = c.imageAssetId ? await tx.query.contentAssets.findFirst({ where: eq(contentAssets.id, c.imageAssetId) }) : null;
    const all = await tx.select({ locale: collectionTranslations.locale, handle: collectionTranslations.handle }).from(collectionTranslations).where(eq(collectionTranslations.collectionId, c.id));
    return {
      id: c.id,
      handle: tr.handle,
      title: tr.title,
      descriptionHtml: tr.descriptionHtml,
      seoTitle: tr.seoTitle,
      seoDescription: tr.seoDescription,
      imageObjectKey: image?.objectKey ?? null,
      sortOrder: c.sortOrder,
      alternateHandles: Object.fromEntries(all.map((a) => [a.locale, a.handle])),
    };
  });
}

export async function getStorefrontCollectionsByIds(db: Parameters<typeof withTenantTx>[0], ctx: StorefrontQueryContext, ids: string[]) {
  if (!ids.length) return [];
  return withTenantTx(db, ctx, async (tx) => {
    const rows = await tx
      .select({ c: collections, t: collectionTranslations, img: contentAssets.objectKey })
      .from(collections)
      .innerJoin(collectionTranslations, and(eq(collectionTranslations.collectionId, collections.id), eq(collectionTranslations.locale, ctx.locale)))
      .leftJoin(contentAssets, eq(contentAssets.id, collections.imageAssetId))
      .where(and(inArray(collections.id, ids), eq(collections.isPublished, true)));
    return rows.map((r) => ({ id: r.c.id, handle: r.t.handle, title: r.t.title, imageObjectKey: r.img }));
  });
}

/** Handles of every visible product and published collection for sitemaps. */
export async function listSitemapEntries(db: Parameters<typeof withTenantTx>[0], ctx: StorefrontQueryContext) {
  return withTenantTx(db, ctx, async (tx) => {
    const prods = await tx
      .select({ handle: productTranslations.handle, locale: productTranslations.locale, updatedAt: products.updatedAt })
      .from(products)
      .innerJoin(productTranslations, eq(productTranslations.productId, products.id))
      .where(and(eq(products.storeId, ctx.storeId), visibleSql(ctx.channelId)));
    const cols = await tx
      .select({ handle: collectionTranslations.handle, locale: collectionTranslations.locale, updatedAt: collections.updatedAt })
      .from(collections)
      .innerJoin(collectionTranslations, eq(collectionTranslations.collectionId, collections.id))
      .where(and(eq(collections.storeId, ctx.storeId), eq(collections.isPublished, true)));
    return { products: prods, collections: cols };
  });
}
