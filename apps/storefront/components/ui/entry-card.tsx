import type { LiveEntryCard, ResolvedAssetUsage } from "@altyapi/theme-engine";
import { mediaUrl, srcSet } from "@/lib/media";
import { formatDate } from "@/lib/format";
import { htmlAttributes, t } from "@/lib/i18n";
import type { RenderCtx } from "../context";
import { assetKey } from "../sections/content";

/** A content entry card (lists, related entries, index pages). */
export interface EntryCardOptions {
  showImage?: boolean;
  showSummary?: boolean;
  showDate?: boolean;
  showReadingTime?: boolean;
  /** Heading level of the card titles (below the section's own heading). */
  titleTag?: "h2" | "h3";
}

/**
 * lang and dir of content served in another language than the page: the default-language
 * version of an untranslated entry (untranslated_policy fallback_noindex). Empty otherwise.
 */
export function contentLangProps(ctx: RenderCtx, item: { fallback: boolean; locale: string }): { lang?: string; dir?: "ltr" | "rtl" } {
  if (!item.fallback || item.locale === ctx.locale) return {};
  const { lang, dir } = htmlAttributes(item.locale);
  return { lang, dir };
}

/**
 * lang and dir of interface text (labels, dates) inside content served in another language
 * (see contentLangProps): it stays in the page language. Empty when the content is not a fallback.
 */
export function uiLangProps(ctx: RenderCtx, item: { fallback: boolean; locale: string }): { lang?: string; dir?: "ltr" | "rtl" } {
  if (!item.fallback || item.locale === ctx.locale) return {};
  const { lang, dir } = htmlAttributes(ctx.locale);
  return { lang, dir };
}

/** Object key of an asset usage (bound data carries asset ids; the route maps them to keys). */
export function usageKey(ctx: RenderCtx, image: ResolvedAssetUsage | null): string | null {
  return image ? assetKey(ctx, image.assetId) : null;
}

export function EntryDate({ ctx, value, label }: { ctx: RenderCtx; value: string | Date | null; label?: string }) {
  if (!value) return null;
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} className="text-sm text-muted-fg">
      {label ? `${label}: ` : ""}
      {formatDate(iso, ctx.locale, ctx.site.timezone)}
    </time>
  );
}

export function EntryCard({ ctx, item, options = {}, priority = false }: { ctx: RenderCtx; item: LiveEntryCard; options?: EntryCardOptions; priority?: boolean }) {
  const { showImage = true, showSummary = true, showDate = false, showReadingTime = false, titleTag: Title = "h3" } = options;
  const key = showImage ? usageKey(ctx, item.image) : null;
  const title = item.path ? (
    <a href={item.path} className="after:absolute after:inset-0">
      {item.title}
    </a>
  ) : (
    item.title
  );
  return (
    <article className="group relative flex flex-col gap-2" {...contentLangProps(ctx, item)}>
      {key && (
        <div className="aspect-[16/10] overflow-hidden rounded-theme bg-muted">
          <img
            src={mediaUrl(ctx.mediaBase, key, "card") ?? undefined}
            srcSet={srcSet(ctx.mediaBase, key, "card")}
            sizes="(min-width: 1024px) 33vw, 100vw"
            alt={item.image?.alt ?? ""}
            loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        </div>
      )}
      <Title className="card-title font-semibold leading-snug">{title}</Title>
      {(showDate || showReadingTime) && (
        <p className="flex flex-wrap gap-3">
          {showDate && <EntryDate ctx={ctx} value={item.firstPublishedAt} />}
          {showReadingTime && item.readingMinutes > 0 && <span className="text-sm text-muted-fg">{t(ctx.locale, "readingTime", { n: item.readingMinutes })}</span>}
        </p>
      )}
      {showSummary && item.summary && <p className="text-muted-fg">{item.summary}</p>}
    </article>
  );
}

const COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" };

export function EntryGrid({ ctx, items, columns = 3, options }: { ctx: RenderCtx; items: LiveEntryCard[]; columns?: number; options?: EntryCardOptions }) {
  return (
    <ul className={`grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 ${COLS[columns] ?? COLS[3]}`}>
      {items.map((item, i) => (
        <li key={item.id}>
          <EntryCard ctx={ctx} item={item} options={options} priority={i < 3} />
        </li>
      ))}
    </ul>
  );
}

export function EntryRows({ ctx, items, options }: { ctx: RenderCtx; items: LiveEntryCard[]; options?: EntryCardOptions }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const key = options?.showImage !== false ? usageKey(ctx, item.image) : null;
        return (
          <li key={item.id} className="relative flex gap-4 py-5">
            {key && <img src={mediaUrl(ctx.mediaBase, key, "thumbnail") ?? undefined} alt={item.image?.alt ?? ""} loading="lazy" className="h-20 w-20 shrink-0 rounded-theme object-cover" />}
            <div className="flex min-w-0 flex-col gap-1">
              <EntryCard ctx={ctx} item={{ ...item, image: null }} options={{ ...options, showImage: false }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
