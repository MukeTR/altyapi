import type { ProductCardDto } from "@altyapi/catalog";
import { mediaUrl, srcSet } from "@/lib/media";
import { t } from "@/lib/i18n";
import { Price } from "./money";
import { P, type RenderCtx } from "../context";

const RATIO: Record<string, string> = { "1:1": "aspect-square", "3:4": "aspect-[3/4]", "4:5": "aspect-[4/5]", adapt: "aspect-[3/4]" };

export function ProductCard({ ctx, product, priority = false }: { ctx: RenderCtx; product: ProductCardDto; priority?: boolean }) {
  const settings = ctx.site.theme.settings.productCard;
  const img = product.image;
  const img2 = settings.showSecondaryImageOnHover ? product.secondaryImage : null;
  const href = P(ctx, `/products/${product.handle}`);
  return (
    <article className="group relative flex flex-col gap-2">
      <a href={href} className={`relative block overflow-hidden bg-muted rounded-theme ${RATIO[settings.imageRatio] ?? "aspect-[3/4]"}`}>
        {img && (
          <img
            src={mediaUrl(ctx.mediaBase, img.objectKey, "card") ?? undefined}
            srcSet={srcSet(ctx.mediaBase, img.objectKey, "card")}
            sizes="(min-width: 1024px) 25vw, 50vw"
            alt={img.alt || product.title}
            width={img.width ?? undefined}
            height={img.height ?? undefined}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          />
        )}
        {img2 && (
          <img
            src={mediaUrl(ctx.mediaBase, img2.objectKey, "card") ?? undefined}
            alt=""
            aria-hidden
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
        )}
        <span className="absolute left-2 top-2 flex gap-1 text-xs font-semibold">
          {product.onSale && <span className="rounded bg-sale px-2 py-0.5 text-white">{t(ctx.locale, "sale")}</span>}
          {!product.available && <span className="rounded bg-fg px-2 py-0.5 text-surface">{t(ctx.locale, "soldOut")}</span>}
        </span>
      </a>
      {settings.showVendor && product.vendor && <p className="text-xs uppercase tracking-wide text-muted-fg">{product.vendor}</p>}
      <h3 className="text-base font-medium leading-snug">
        <a href={href} className="after:absolute after:inset-0">
          {product.title}
        </a>
      </h3>
      <Price
        amount={product.priceMin}
        compareAt={product.compareAtMin}
        currency={product.currency}
        locale={ctx.locale}
        className="text-sm"
      />
    </article>
  );
}

export function ProductGridList({ ctx, products, columnsDesktop = 4, columnsMobile = 2 }: { ctx: RenderCtx; products: ProductCardDto[]; columnsDesktop?: number; columnsMobile?: number }) {
  const mobile = columnsMobile === 1 ? "grid-cols-1" : "grid-cols-2";
  const desktop = ({ 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as Record<number, string>)[columnsDesktop] ?? "lg:grid-cols-4";
  return (
    <ul className={`grid ${mobile} md:grid-cols-3 ${desktop} gap-x-4 gap-y-8`}>
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard ctx={ctx} product={p} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
}
