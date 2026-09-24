import type { CollectionDto, ProductCardDto, ProductDetailDto } from "@altyapi/catalog";
import type { ListingDto, RenderSection } from "@altyapi/theme-engine";
import { mediaUrl, srcSet } from "@/lib/media";
import { t } from "@/lib/i18n";
import { minorToDecimal } from "@/lib/format";
import { L, P, moduleOn, type RenderCtx } from "../context";
import { ProductCard, ProductGridList } from "../ui/product-card";
import { JsonLd } from "../ui/json-ld";
import { ProductPurchase } from "../client/product-purchase";
import { CartPage } from "../client/cart";
import type { HeadingTag } from "./render";
import { SectionShell } from "./shell";

const gridProducts = (s: RenderSection) => ((s.data?.products as ProductCardDto[] | undefined) ?? []).slice(0, Number(s.props.limit ?? 12));

export const productGridHeading = (s: RenderSection, ctx: RenderCtx) => (gridProducts(s).length ? L(ctx, s.props.heading) : "");

export function ProductGrid({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const products = gridProducts(s);
  if (!products.length) return null;
  const heading = L(ctx, p.heading);
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-6 text-2xl">{heading}</H>}
      <ProductGridList ctx={ctx} products={products} columnsDesktop={Number(p.columnsDesktop ?? 4)} columnsMobile={Number(p.columnsMobile ?? 2)} />
    </SectionShell>
  );
}

/** The heading falls back to the collection title, so a rendered section always has one. */
export const featuredCollectionHeading = (s: RenderSection, ctx: RenderCtx) => {
  const col = s.data?.collection as { title: string } | null;
  const products = (s.data?.products as ProductCardDto[] | undefined) ?? [];
  return col && products.length ? L(ctx, s.props.heading) || col.title : "";
};

export function FeaturedCollection({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const col = s.data?.collection as { title: string; path: string } | null;
  const products = (s.data?.products as ProductCardDto[] | undefined) ?? [];
  if (!col || !products.length) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <H className="text-2xl">{featuredCollectionHeading(s, ctx)}</H>
        {Boolean(p.showViewAll) && (
          <a href={col.path} className="text-sm underline underline-offset-4">
            {t(ctx.locale, "viewAll")}
          </a>
        )}
      </div>
      {p.layout === "carousel" ? (
        <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
          {products.map((prod) => (
            <li key={prod.id} className="w-[45%] shrink-0 snap-start md:w-[30%] lg:w-[22%]">
              <ProductCard ctx={ctx} product={prod} />
            </li>
          ))}
        </ul>
      ) : (
        <ProductGridList ctx={ctx} products={products} columnsDesktop={Number(p.columnsDesktop ?? 4)} columnsMobile={Number(p.columnsMobile ?? 2)} />
      )}
    </SectionShell>
  );
}

function categoryCards(s: RenderSection, ctx: RenderCtx) {
  const cols = (s.data?.collections as Record<string, { title: string; path: string; imageObjectKey: string | null }> | undefined) ?? {};
  return s.blocks.flatMap((b) => {
    const c = cols[String(b.props.collectionId)];
    if (!c) return [];
    const override = b.props.imageAssetId ? ctx.route?.assets[String(b.props.imageAssetId)] ?? null : null;
    return [{ id: b.id, title: L(ctx, b.props.label) || c.title, path: c.path, image: override ?? c.imageObjectKey }];
  });
}

export const categoryCardsHeading = (s: RenderSection, ctx: RenderCtx) => (categoryCards(s, ctx).length ? L(ctx, s.props.heading) : "");

export function CategoryCards({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const cards = categoryCards(s, ctx);
  if (!cards.length) return null;
  const heading = L(ctx, p.heading);
  const desktop = ({ 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as Record<number, string>)[Number(p.columnsDesktop ?? 4)];
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-6 text-2xl">{heading}</H>}
      <ul className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${desktop}`}>
        {cards.map((c) => (
          <li key={c.id}>
            <a href={c.path} className="group block">
              <div className="aspect-square overflow-hidden rounded-theme bg-muted">
                {c.image && <img src={mediaUrl(ctx.mediaBase, c.image, "card") ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}
              </div>
              <p className="mt-2 font-medium">{c.title}</p>
            </a>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function productJsonLd(ctx: RenderCtx, product: ProductDetailDto) {
  const origin = ctx.site.canonicalHost ? `https://${ctx.site.canonicalHost}` : "";
  const url = `${origin}${P(ctx, `/products/${product.handle}`)}`;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000),
    image: product.media.map((m) => mediaUrl(ctx.mediaBase, m.objectKey, "zoom")).filter(Boolean),
    ...(product.vendor ? { brand: { "@type": "Brand", name: product.vendor } } : {}),
    ...(product.variants[0]?.sku ? { sku: product.variants[0].sku } : {}),
    ...(product.barcodes[0] ? { gtin: product.barcodes[0] } : {}),
    url,
    offers: product.variants
      .filter((v) => v.price)
      .map((v) => ({
        "@type": "Offer",
        url: `${url}?variant=${v.id}`,
        ...(v.sku ? { sku: v.sku } : {}),
        priceCurrency: v.price!.currency,
        price: minorToDecimal(v.price!.amount, v.price!.currency),
        availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
      })),
  };
}

export const productMainOwnsH1 = (s: RenderSection) => Boolean(s.data?.product);

export function ProductMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const product = s.data?.product as ProductDetailDto | undefined;
  if (!product) return null;
  const initialVariant = ctx.searchParams.get("variant");
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className={p.galleryLayout === "grid" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-3"}>
          {product.media.length ? (
            product.media.map((m, i) => (
              <a key={m.assetId} href={p.enableZoom ? mediaUrl(ctx.mediaBase, m.objectKey, "zoom") ?? undefined : undefined} className={`block overflow-hidden rounded-theme bg-muted ${p.galleryLayout === "grid" && i === 0 ? "col-span-2" : ""}`} data-variant-ids={m.variantIds.join(",")}>
                <img
                  src={mediaUrl(ctx.mediaBase, m.objectKey, "product") ?? undefined}
                  srcSet={srcSet(ctx.mediaBase, m.objectKey, "product")}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  alt={m.alt}
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : undefined}
                  className="h-auto w-full object-cover"
                />
              </a>
            ))
          ) : (
            <div className="aspect-square rounded-theme bg-muted" />
          )}
        </div>
        <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          {Boolean(p.showVendor) && product.vendor && <p className="text-sm uppercase tracking-wide text-muted-fg">{product.vendor}</p>}
          <h1 className="text-3xl">{product.title}</h1>
          <ProductPurchase
            product={product}
            initialVariantId={initialVariant}
            picker={p.variantPicker === "dropdown" ? "dropdown" : "buttons"}
            locale={ctx.locale}
            currency={ctx.currency}
            labels={{ soldOut: t(ctx.locale, "soldOut"), lowStock: t(ctx.locale, "lowStock"), addToCart: t(ctx.locale, "addToCart") }}
            purchasable={moduleOn(ctx.site, "commerce")}
          />
          {Boolean(p.showSku) && product.variants[0]?.sku && (
            <p className="text-xs text-muted-fg">
              {t(ctx.locale, "sku")}: {product.variants[0].sku}
            </p>
          )}
          {product.descriptionHtml && <div className="prose-theme" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />}
          {product.attributes.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              {product.attributes.map((a) => (
                <div key={a.key} className="contents">
                  <dt className="text-muted-fg">{a.label}</dt>
                  <dd>{a.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      <JsonLd data={productJsonLd(ctx, product)} />
    </SectionShell>
  );
}

const SORTS = ["manual", "best_selling", "newest", "price_asc", "price_desc", "title_asc", "title_desc"] as const;

function pageHref(ctx: RenderCtx, base: string, page: number): string {
  const q = new URLSearchParams(ctx.searchParams);
  q.delete("variant");
  if (page <= 1) q.delete("page");
  else q.set("page", String(page));
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
}

function Pagination({ ctx, listing, base }: { ctx: RenderCtx; listing: ListingDto; base: string }) {
  const pages = Math.ceil(listing.total / listing.pageSize);
  if (pages <= 1) return null;
  return (
    <nav aria-label={t(ctx.locale, "page")} className="mt-10 flex items-center justify-center gap-4">
      {listing.page > 1 && (
        <a rel="prev" href={pageHref(ctx, base, listing.page - 1)} className="btn btn-outline">
          {t(ctx.locale, "previous")}
        </a>
      )}
      <span className="text-sm text-muted-fg">
        {listing.page} / {pages}
      </span>
      {listing.page < pages && (
        <a rel="next" href={pageHref(ctx, base, listing.page + 1)} className="btn btn-outline">
          {t(ctx.locale, "next")}
        </a>
      )}
    </nav>
  );
}

/** Filters and sorting submit as a plain GET form so they work without JavaScript. */
function ListingControls({ ctx, listing, showFilters, showSort, keepQuery }: { ctx: RenderCtx; listing: ListingDto; showFilters: boolean; showSort: boolean; keepQuery?: Record<string, string> }) {
  const sp = ctx.searchParams;
  // Price filters are entered and submitted as decimals ("149,90"); the API converts to minor units.
  const decimal = (v: string | null) => v ?? "";
  return (
    <form method="get" className="mb-8 flex flex-wrap items-end gap-4 border-b border-line pb-6 text-sm">
      {Object.entries(keepQuery ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {showSort && (
        <label className="flex flex-col gap-1">
          <span className="text-muted-fg">{t(ctx.locale, "sortBy")}</span>
          <select name="sort" defaultValue={listing.sort} className="rounded-theme border border-line bg-surface px-3 py-2">
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(ctx.locale, `sort_${s}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {showFilters && (
        <>
          <fieldset className="flex items-end gap-2">
            <legend className="mb-1 text-muted-fg">{t(ctx.locale, "priceRange")}</legend>
            <input name="price_min" inputMode="decimal" defaultValue={decimal(sp.get("price_min"))} placeholder={t(ctx.locale, "priceMin")} className="w-24 rounded-theme border border-line bg-surface px-3 py-2" aria-label={t(ctx.locale, "priceMin")} />
            <input name="price_max" inputMode="decimal" defaultValue={decimal(sp.get("price_max"))} placeholder={t(ctx.locale, "priceMax")} className="w-24 rounded-theme border border-line bg-surface px-3 py-2" aria-label={t(ctx.locale, "priceMax")} />
          </fieldset>
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="in_stock" value="1" defaultChecked={sp.get("in_stock") === "1"} />
            {t(ctx.locale, "inStock")}
          </label>
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="on_sale" value="1" defaultChecked={sp.get("on_sale") === "1"} />
            {t(ctx.locale, "onSale")}
          </label>
        </>
      )}
      <button type="submit" className="btn btn-primary">
        {t(ctx.locale, "apply")}
      </button>
      <span className="ms-auto text-muted-fg">{t(ctx.locale, "results", { n: listing.total })}</span>
    </form>
  );
}

export const collectionMainOwnsH1 = (s: RenderSection) => Boolean(s.data?.listing);

export function CollectionMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const listing = s.data?.listing as ListingDto | undefined;
  const collection = s.data?.collection as CollectionDto | null;
  if (!listing) return null;
  const title = collection?.title ?? t(ctx.locale, "allProducts");
  const base = P(ctx, `/collections/${collection?.handle ?? "all"}`);
  return (
    <SectionShell s={s} ctx={ctx}>
      <header className="mb-6 flex flex-col gap-3">
        <h1 className="text-3xl">{title}</h1>
        {collection?.descriptionHtml && <div className="prose-theme max-w-3xl text-muted-fg" dangerouslySetInnerHTML={{ __html: collection.descriptionHtml }} />}
      </header>
      <ListingControls ctx={ctx} listing={listing} showFilters={Boolean(p.enableFiltering)} showSort={Boolean(p.enableSorting)} />
      {listing.items.length ? (
        <ProductGridList ctx={ctx} products={listing.items} columnsDesktop={Number(p.columnsDesktop ?? 4)} columnsMobile={Number(p.columnsMobile ?? 2)} />
      ) : (
        <p className="py-16 text-center text-muted-fg">{t(ctx.locale, "noResults")}</p>
      )}
      <Pagination ctx={ctx} listing={listing} base={base} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: listing.items.map((it, i) => ({ "@type": "ListItem", position: (listing.page - 1) * listing.pageSize + i + 1, url: P(ctx, `/products/${it.handle}`), name: it.title })),
        }}
      />
    </SectionShell>
  );
}

export function SearchMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const listing = s.data?.listing as ListingDto | undefined;
  const query = String(s.data?.query ?? "");
  const hasResults = Boolean(query && listing);
  return (
    <SectionShell s={s} ctx={ctx}>
      {/* The page H1 names the query once there is one; before that the page is the search itself. */}
      {!hasResults && <h1 className="mb-6 text-2xl">{t(ctx.locale, "search")}</h1>}
      <form method="get" role="search" className="mb-8 flex max-w-xl gap-2">
        <label htmlFor="search-q" className="sr-only">{t(ctx.locale, "search")}</label>
        <input id="search-q" type="search" name="q" defaultValue={query} placeholder={t(ctx.locale, "searchPlaceholder")} className="flex-1 rounded-theme border border-line bg-surface px-3 py-2" />
        <button type="submit" className="btn btn-primary">{t(ctx.locale, "search")}</button>
      </form>
      {hasResults && listing && (
        <>
          <h1 className="mb-6 text-2xl">
            “{query}” · {t(ctx.locale, "results", { n: listing.total })}
          </h1>
          {listing.items.length ? <ProductGridList ctx={ctx} products={listing.items} /> : <p className="py-16 text-center text-muted-fg">{t(ctx.locale, "noResults")}</p>}
          <Pagination ctx={ctx} listing={listing} base={P(ctx, "/search")} />
        </>
      )}
    </SectionShell>
  );
}

export function NotFoundMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-3xl">{L(ctx, p.heading) || "404"}</h1>
        {L(ctx, p.body) && <p className="text-muted-fg">{L(ctx, p.body)}</p>}
        {/* Search looks through the catalog: a site without one has nothing to find there. */}
        {Boolean(p.showSearch) && moduleOn(ctx.site, "catalog") && (
          <form method="get" action={P(ctx, "/search")} role="search" className="flex w-full gap-2">
            <input type="search" name="q" aria-label={t(ctx.locale, "search")} placeholder={t(ctx.locale, "searchPlaceholder")} className="flex-1 rounded-theme border border-line bg-surface px-3 py-2" />
            <button type="submit" className="btn btn-primary">{t(ctx.locale, "search")}</button>
          </form>
        )}
        <a href={P(ctx, "/")} className="underline">{t(ctx.locale, "home")}</a>
      </div>
    </SectionShell>
  );
}


/**
 * The cart needs the cart context the layout provides only while commerce is on. The layout
 * and this page read the same site snapshot, so right after commerce is turned on (the route
 * already has the cart, the cached site does not yet) the section waits for the next render
 * instead of rendering outside the provider.
 */
export function CartMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  if (!moduleOn(ctx.site, "commerce")) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <CartPage locale={ctx.locale} mediaBase={ctx.mediaBase} />
    </SectionShell>
  );
}
