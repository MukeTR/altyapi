import type { Breadcrumb, EntryListingDto, LiveEntryCard, LiveEntryDto, LiveFieldMeta, RenderSection, ResolvedAssetUsage } from "@altyapi/theme-engine";
import { mediaUrl, srcSet } from "@/lib/media";
import { formatDate, formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { L, type RenderCtx } from "../context";
import { JsonLd } from "../ui/json-ld";
import { EntryCard, EntryDate, EntryGrid, EntryRows, contentLangProps, uiLangProps, usageKey, type EntryCardOptions } from "../ui/entry-card";
import { Slider } from "../client/slider";
import type { HeadingTag } from "./render";
import { SectionShell } from "./shell";
import { AddressBlock, Ltr, OpeningHoursTable } from "./business";

/**
 * Content sections: the entry and index templates' main sections, entry lists, and the
 * richDoc versions of rich text and FAQ. Their data (entries, resolved references, final HTML)
 * comes from the route resolver; rich HTML is generated from validated documents with every
 * value escaped, so it is rendered as is.
 */

type Props = Record<string, unknown>;

const WIDTH: Record<string, string> = { narrow: "max-w-2xl", medium: "max-w-3xl", wide: "max-w-5xl" };
/** Rendered width of the article column in pixels (image sizes). */
const WIDTH_PX: Record<string, number> = { narrow: 672, medium: 768, wide: 1024 };

/** GEO fieldset keys rendered in their own blocks (plan §3.5), never as plain fields. */
const GEO_KEYS = new Set(["summary", "keyFacts", "faq", "sources", "authors", "reviewedBy", "lastReviewedAt", "significantUpdate"]);
/** Fields that steer lists (featured entries) rather than say something to the reader. */
const LIST_FLAG_KEYS = new Set(["featured"]);

type Rich = { html: string; plain?: string };
const isRich = (v: unknown): v is Rich => !!v && typeof v === "object" && typeof (v as Rich).html === "string";
type Ref = { kind?: string; id: string; title?: string; name?: string; path?: string | null; fields?: Record<string, unknown> };

function RefLink({ r }: { r: Ref }) {
  const label = r.title ?? r.name ?? "";
  return r.path ? <a href={r.path} className="underline underline-offset-4">{label}</a> : <span>{label}</span>;
}

function AssetView({ ctx, entry, usage }: { ctx: RenderCtx; entry: LiveEntryDto; usage: ResolvedAssetUsage }) {
  const info = entry.assets[usage.assetId];
  if (!info) return null;
  if (info.contentType.startsWith("image/")) {
    return (
      <img
        src={mediaUrl(ctx.mediaBase, info.objectKey, "product") ?? undefined}
        srcSet={srcSet(ctx.mediaBase, info.objectKey, "product")}
        sizes="(min-width: 1024px) 50vw, 100vw"
        alt={usage.decorative ? "" : usage.alt}
        width={info.width ?? undefined}
        height={info.height ?? undefined}
        loading="lazy"
        className="h-auto max-w-full rounded-theme"
      />
    );
  }
  return (
    <a href={mediaUrl(ctx.mediaBase, info.objectKey) ?? undefined} className="btn btn-outline" download>
      {t(ctx.locale, "download")}
    </a>
  );
}

const VIDEO_URL: Record<string, (id: string) => string> = {
  youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
  vimeo: (id) => `https://vimeo.com/${id}`,
};

/** A field value as the generic entry renderer shows it (custom types and details of built-in ones). */
function FieldValue({ ctx, entry, meta, value }: { ctx: RenderCtx; entry: LiveEntryDto; meta: LiveFieldMeta; value: unknown }): React.ReactNode {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
  switch (meta.type) {
    case "richDoc":
      return isRich(value) ? <div className="prose-theme" dangerouslySetInnerHTML={{ __html: value.html }} /> : null;
    case "boolean":
      return t(ctx.locale, value ? "yes" : "no");
    case "date":
      return <time dateTime={String(value)}>{formatDate(String(value), ctx.locale, "UTC")}</time>;
    case "datetime":
      return <time dateTime={String(value)}>{new Intl.DateTimeFormat(ctx.locale === "tr" ? "tr-TR" : ctx.locale, { dateStyle: "long", timeStyle: "short", timeZone: ctx.site.timezone }).format(new Date(String(value)))}</time>;
    case "dateRange": {
      const r = value as { from: string; to: string };
      return (
        <>
          <time dateTime={r.from}>{formatDate(r.from, ctx.locale, "UTC")}</time> – <time dateTime={r.to}>{formatDate(r.to, ctx.locale, "UTC")}</time>
        </>
      );
    }
    case "money": {
      const m = value as { amount: string; currency: string };
      return formatMoney(m.amount, m.currency, ctx.locale);
    }
    case "email":
      return (
        <a href={`mailto:${String(value)}`}>
          <Ltr>{String(value)}</Ltr>
        </a>
      );
    case "phone": {
      const ph = value as { number: string; whatsapp?: boolean };
      return (
        <span className="flex flex-wrap gap-3">
          <a href={`tel:${ph.number}`}>
            <Ltr>{ph.number}</Ltr>
          </a>
          {ph.whatsapp && <a href={`https://wa.me/${ph.number.replace(/\D/g, "")}`} rel="noopener noreferrer" target="_blank">{t(ctx.locale, "whatsapp")}</a>}
        </span>
      );
    }
    case "select":
      return (value as { label: string }).label;
    case "multiSelect":
      return (value as { label: string }[]).map((o) => o.label).join(", ");
    case "asset":
      return <AssetView ctx={ctx} entry={entry} usage={value as ResolvedAssetUsage} />;
    case "gallery":
      return (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {(value as ResolvedAssetUsage[]).map((u) => (
            <li key={u.assetId}>
              <AssetView ctx={ctx} entry={entry} usage={u} />
            </li>
          ))}
        </ul>
      );
    case "video": {
      // No player is embedded (third-party content loads only after consent); visitors follow the link.
      const v = value as { provider: string; id: string; title: string };
      const href = VIDEO_URL[v.provider]?.(v.id);
      return href ? <a href={href} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">{v.title || t(ctx.locale, "video")}</a> : null;
    }
    case "link": {
      const l = value as { href: string; label: string; openInNewTab: boolean; external: boolean };
      return (
        <a href={l.href} className="underline underline-offset-4" {...(l.openInNewTab || l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {l.label || l.href}
        </a>
      );
    }
    case "reference":
      return <RefLink r={value as Ref} />;
    case "multiReference":
      return (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {(value as Ref[]).map((r) => (
            <li key={r.id}>
              <RefLink r={r} />
            </li>
          ))}
        </ul>
      );
    case "address":
      return <AddressBlock address={value as Parameters<typeof AddressBlock>[0]["address"]} />;
    case "openingHours":
      return <OpeningHoursTable ctx={ctx} hours={value as Parameters<typeof OpeningHoursTable>[0]["hours"]} />;
    case "geo":
      return null;
    case "keyFacts":
      return <KeyFactsList facts={value as { label: string; value: string }[]} />;
    case "sources":
      return <SourcesList sources={value as Source[]} />;
    case "credentials":
      return (
        <ul className="flex flex-col gap-1">
          {(value as { name: string; issuer: string; number?: string; validUntil?: string; url?: string; verified: boolean }[]).map((c, i) => (
            <li key={i}>
              {c.url ? <a href={c.url} rel="noopener noreferrer" target="_blank">{c.name}</a> : c.name} · {c.issuer}
              {c.number ? ` · ${c.number}` : ""}
              {c.validUntil ? ` · ${t(ctx.locale, "validUntil")}: ${formatDate(c.validUntil, ctx.locale, "UTC")}` : ""}
              {c.verified ? " ✓" : ""}
            </li>
          ))}
        </ul>
      );
    case "group": {
      const g = value as Record<string, unknown>;
      return <FieldList ctx={ctx} entry={entry} metas={meta.children ?? []} values={g} />;
    }
    case "repeater":
      return (
        <ul className="flex flex-col gap-4">
          {(value as Record<string, unknown>[]).map((item, i) => (
            <li key={i} className="rounded-theme border border-line p-4">
              <FieldList ctx={ctx} entry={entry} metas={meta.children ?? []} values={item} />
            </li>
          ))}
        </ul>
      );
    default:
      return typeof value === "string" || typeof value === "number" ? <span className="whitespace-pre-line">{String(value)}</span> : null;
  }
}

function FieldList({ ctx, entry, metas, values }: { ctx: RenderCtx; entry: LiveEntryDto; metas: LiveFieldMeta[]; values: Record<string, unknown> }) {
  const rows = metas.flatMap((m) => {
    const node = FieldValue({ ctx, entry, meta: m, value: values[m.key] });
    return node === null || node === undefined || node === "" ? [] : [{ meta: m, node }];
  });
  if (!rows.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(({ meta, node }) => (
        <div key={meta.key} className="contents">
          <dt className="font-medium text-muted-fg">{meta.label}</dt>
          <dd>{node}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeyFactsList({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {facts.map((f, i) => (
        <div key={i} className="contents">
          <dt className="font-medium">{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Source = { title: string; url?: string; publisher?: string; date?: string; reference?: string };

function SourcesList({ sources }: { sources: Source[] }) {
  return (
    <ol className="list-decimal ps-5 text-sm">
      {sources.map((s, i) => (
        <li key={i} className="py-1">
          <cite className="not-italic">{s.url ? <a href={s.url} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">{s.title}</a> : s.title}</cite>
          {[s.publisher, s.reference, s.date].filter(Boolean).length ? <span className="text-muted-fg"> · {[s.publisher, s.reference, s.date].filter(Boolean).join(", ")}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Visible trail of the route's breadcrumbs (home › index › parent › entry), the same list the
 * page's BreadcrumbList markup is built from; the last item is the current page.
 */
function Breadcrumbs({ ctx, items, currentLang = {} }: { ctx: RenderCtx; items: Breadcrumb[]; currentLang?: { lang?: string; dir?: "ltr" | "rtl" } }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label={t(ctx.locale, "breadcrumb")} className="text-sm text-muted-fg">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((b, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${b.path}-${i}`} className="flex items-center gap-2">
              {last ? (
                <span aria-current="page" className="text-fg" {...currentLang}>
                  {b.name}
                </span>
              ) : (
                <>
                  <a href={b.path} className="underline-offset-4 hover:underline">
                    {b.name}
                  </a>
                  <span aria-hidden className="inline-block rtl:-scale-x-100">
                    ›
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Table of contents from the body's headings (anchors are the heading ids of the rendered HTML). */
function Toc({ ctx, entry }: { ctx: RenderCtx; entry: LiveEntryDto }) {
  const items = entry.outline;
  return (
    <nav aria-labelledby="entry-toc" className="rounded-theme border border-line p-4">
      <h2 id="entry-toc" className="mb-2 text-base font-semibold" {...uiLangProps(ctx, entry)}>
        {t(ctx.locale, "toc")}
      </h2>
      <ol className="flex flex-col gap-1 text-sm">
        {items.map((o) => (
          <li key={o.anchor} style={{ paddingInlineStart: `${(o.level - 2) * 1}rem` }}>
            <a href={`#${o.anchor}`} className="underline-offset-4 hover:underline">{o.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const entryMainOwnsH1 = (s: RenderSection) => Boolean(s.data?.entry);

export function EntryMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Props;
  const entry = s.data?.entry as LiveEntryDto | null | undefined;
  if (!entry) return null;
  const related = (s.data?.related as LiveEntryCard[] | undefined) ?? [];
  const f = entry.fields;
  const summary = entry.summaryField ? (f[entry.summaryField] as string | null) : null;
  const authors = ((f.authors as { name: string; role?: string | null }[] | null) ?? []).filter((a) => a?.name);
  const reviewedBy = f.reviewedBy as string | null;
  const lastReviewedAt = f.lastReviewedAt as string | null;
  const keyFacts = (f.keyFacts as { label: string; value: string }[] | null) ?? [];
  const faq = ((f.faq as Ref[] | null) ?? []).filter((r) => r.title);
  const sources = (f.sources as Source[] | null) ?? [];
  const significantUpdate = f.significantUpdate as string | null;
  const cover = p.coverImage && entry.image ? entry.assets[entry.image.assetId] : null;
  const published = entry.firstPublishedAt ?? entry.liveFrom;
  const modified = entry.contentModifiedAt;
  const showModified = modified && published && new Date(modified).getTime() - new Date(published).getTime() > 86_400_000;
  const skip = new Set([entry.titleField, entry.summaryField, entry.imageField, ...GEO_KEYS, ...LIST_FLAG_KEYS].filter(Boolean) as string[]);
  const width = String(p.width) in WIDTH ? String(p.width) : "medium";
  const ui = uiLangProps(ctx, entry);
  const bodyMetas = entry.fieldMeta.filter((m) => !skip.has(m.key));
  const richMetas = bodyMetas.filter((m) => m.type === "richDoc");
  const detailMetas = bodyMetas.filter((m) => m.type !== "richDoc");
  return (
    <SectionShell s={s} ctx={ctx}>
      {ctx.route?.kind === "entry" && (
        <div className={`mx-auto mb-6 ${WIDTH[width]}`}>
          <Breadcrumbs ctx={ctx} items={ctx.route.breadcrumbs} currentLang={contentLangProps(ctx, entry)} />
        </div>
      )}
      {/* An untranslated entry shown in the default language: the article is in that language, its interface text is not. */}
      <article className={`mx-auto flex ${WIDTH[width]} flex-col gap-8`} {...contentLangProps(ctx, entry)}>
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl lg:text-4xl">{entry.title}</h1>
          {summary && (
            // The short answer (GEO): a self-contained summary right under the title.
            <div className="rounded-theme border-s-4 border-primary bg-muted px-5 py-4">
              <p className="mb-1 text-sm font-semibold text-muted-fg" {...ui}>
                {t(ctx.locale, "shortAnswer")}
              </p>
              <p className="text-lg">{summary}</p>
            </div>
          )}
          {Boolean(p.byline) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-fg" {...ui}>
              {authors.length > 0 && (
                <span>
                  <span className="sr-only">{t(ctx.locale, "authors")}: </span>
                  {authors.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(", ")}
                </span>
              )}
              <EntryDate ctx={ctx} value={published} label={t(ctx.locale, "published")} />
              {showModified && <EntryDate ctx={ctx} value={modified} label={t(ctx.locale, "updated")} />}
              {entry.readingMinutes > 0 && <span>{t(ctx.locale, "readingTime", { n: entry.readingMinutes })}</span>}
              {reviewedBy && <span>{t(ctx.locale, "reviewedBy", { name: reviewedBy })}</span>}
              {lastReviewedAt && (
                <time dateTime={lastReviewedAt} className="text-sm text-muted-fg">
                  {t(ctx.locale, "lastReviewed")}: {formatDate(lastReviewedAt, ctx.locale, "UTC")}
                </time>
              )}
            </div>
          )}
        </header>
        {cover && (
          <figure className="overflow-hidden rounded-theme bg-muted">
            {/* Uncropped (the width and height attributes keep the aspect ratio), sized to the article column. */}
            <img
              src={mediaUrl(ctx.mediaBase, cover.objectKey, "product") ?? undefined}
              srcSet={srcSet(ctx.mediaBase, cover.objectKey, "product")}
              sizes={`(min-width: ${WIDTH_PX[width]}px) ${WIDTH_PX[width]}px, 100vw`}
              alt={entry.image?.decorative ? "" : (entry.image?.alt ?? "")}
              width={cover.width ?? undefined}
              height={cover.height ?? undefined}
              fetchPriority="high"
              className="h-auto w-full object-cover"
            />
          </figure>
        )}
        {Boolean(p.keyFacts) && keyFacts.length > 0 && (
          <aside aria-labelledby="entry-key-facts" className="rounded-theme bg-muted p-5">
            <h2 id="entry-key-facts" className="mb-3 text-lg" {...ui}>
              {t(ctx.locale, "keyFacts")}
            </h2>
            <KeyFactsList facts={keyFacts} />
          </aside>
        )}
        {Boolean(p.toc) && entry.outline.length >= Number(p.tocMinHeadings ?? 3) && <Toc ctx={ctx} entry={entry} />}
        {richMetas.map((m) => {
          const v = f[m.key];
          return isRich(v) && v.html ? <div key={m.key} className="prose-theme" dangerouslySetInnerHTML={{ __html: v.html }} /> : null;
        })}
        <FieldList ctx={ctx} entry={entry} metas={detailMetas} values={f} />
        {Boolean(p.faq) && faq.length > 0 && (
          <section aria-labelledby="entry-faq" className="flex flex-col gap-3">
            <h2 id="entry-faq" className="text-2xl" {...ui}>
              {t(ctx.locale, "faq")}
            </h2>
            <div className="divide-y divide-line border-y border-line">
              {faq.map((q) => (
                <details key={q.id} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {q.title}
                    <span aria-hidden className="transition group-open:rotate-45">+</span>
                  </summary>
                  {isRich(q.fields?.answer) && <div className="prose-theme mt-3 text-muted-fg" dangerouslySetInnerHTML={{ __html: (q.fields!.answer as Rich).html }} />}
                </details>
              ))}
            </div>
          </section>
        )}
        {Boolean(p.sources) && sources.length > 0 && (
          <section aria-labelledby="entry-sources" className="flex flex-col gap-2">
            <h2 id="entry-sources" className="text-lg" {...ui}>
              {t(ctx.locale, "sources")}
            </h2>
            <SourcesList sources={sources} />
          </section>
        )}
        {significantUpdate && (
          <p className="rounded-theme border border-line p-4 text-sm">
            <strong {...ui}>{t(ctx.locale, "significantUpdate")}:</strong> {significantUpdate}
            {modified && (
              <>
                {" "}
                <span {...ui}>
                  (<EntryDate ctx={ctx} value={modified} />)
                </span>
              </>
            )}
          </p>
        )}
      </article>
      {Boolean(p.related) && related.length > 0 && (
        <section aria-labelledby="entry-related" className="mx-auto mt-16 max-w-5xl">
          <h2 id="entry-related" className="mb-6 text-2xl">{t(ctx.locale, "related")}</h2>
          <EntryGrid ctx={ctx} items={related} columns={Math.min(3, related.length)} />
        </section>
      )}
    </SectionShell>
  );
}

function listingHref(ctx: RenderCtx, base: string, cursor: string | null): string {
  const q = new URLSearchParams(ctx.searchParams);
  if (cursor) q.set("after", cursor);
  else q.delete("after");
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
}

export const entryIndexMainOwnsH1 = (s: RenderSection) => Boolean(s.data?.listing);

export function EntryIndexMain({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Props;
  const listing = s.data?.listing as EntryListingDto | undefined;
  if (!listing) return null;
  const term = listing.term;
  const title = term?.title ?? listing.type.namePlural;
  const description = term && p.showTermDescription ? term.summary : "";
  const base = term?.path ?? listing.type.indexPath ?? ctx.route?.path ?? "/";
  const options: EntryCardOptions = { showImage: Boolean(p.showImage), showSummary: Boolean(p.showSummary), showDate: Boolean(p.showDate), showReadingTime: Boolean(p.showReadingTime), titleTag: "h2" };
  const route = ctx.route;
  return (
    <SectionShell s={s} ctx={ctx}>
      <header className="mb-8 flex flex-col gap-3">
        {route && (route.kind === "entry_index" || route.kind === "taxonomy") && <Breadcrumbs ctx={ctx} items={route.breadcrumbs} currentLang={term ? contentLangProps(ctx, term) : {}} />}
        <h1 className="text-3xl" {...(term ? contentLangProps(ctx, term) : {})}>
          {title}
        </h1>
        {description && (
          <p className="max-w-3xl text-muted-fg" {...(term ? contentLangProps(ctx, term) : {})}>
            {description}
          </p>
        )}
      </header>
      {Boolean(p.termFilters) && listing.taxonomies.length > 0 && (
        <nav aria-label={listing.taxonomies.map((x) => x.label).join(", ")} className="mb-8 flex flex-col gap-3">
          {listing.taxonomies.map((tax) => (
            <ul key={tax.field} className="flex flex-wrap gap-2 text-sm">
              {listing.type.indexPath && tax === listing.taxonomies[0] && (
                <li>
                  <a href={listing.type.indexPath} aria-current={!term ? "page" : undefined} className={`inline-block rounded-full border border-line px-3 py-1 ${!term ? "bg-fg text-surface" : ""}`}>
                    {t(ctx.locale, "viewAll")}
                  </a>
                </li>
              )}
              {tax.terms.map((x) => (
                <li key={x.id}>
                  <a href={x.path} aria-current={term?.id === x.id ? "page" : undefined} className={`inline-block rounded-full border border-line px-3 py-1 ${term?.id === x.id ? "bg-fg text-surface" : ""}`}>
                    {x.title}
                  </a>
                </li>
              ))}
            </ul>
          ))}
        </nav>
      )}
      {listing.items.length ? (
        p.layout === "list" ? (
          <EntryRows ctx={ctx} items={listing.items} options={options} />
        ) : (
          <EntryGrid ctx={ctx} items={listing.items} columns={Number(p.columnsDesktop ?? 3)} options={options} />
        )
      ) : (
        <p className="py-16 text-center text-muted-fg">{t(ctx.locale, "noEntries")}</p>
      )}
      {(listing.cursor || listing.nextCursor) && (
        <nav aria-label={t(ctx.locale, "page")} className="mt-10 flex items-center justify-center gap-4">
          {listing.cursor && (
            <a href={listingHref(ctx, base, null)} className="btn btn-outline">
              {t(ctx.locale, "firstPage")}
            </a>
          )}
          {listing.nextCursor && (
            <a rel="next" href={listingHref(ctx, base, listing.nextCursor)} className="btn btn-outline">
              {t(ctx.locale, "next")}
            </a>
          )}
        </nav>
      )}
    </SectionShell>
  );
}

type ListType = { key: string; name: string; namePlural: string; indexPath: string | null } | null;

const listItems = (s: RenderSection) => (s.data?.items as LiveEntryCard[] | undefined) ?? [];

export const entryListHeading = (s: RenderSection, ctx: RenderCtx) => (listItems(s).length ? L(ctx, s.props.heading) : "");

export function EntryList({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const items = listItems(s);
  if (!items.length) return null;
  const type = s.data?.type as ListType;
  const heading = L(ctx, p.heading);
  const options: EntryCardOptions = { showImage: Boolean(p.showImage), showSummary: Boolean(p.showSummary), showDate: Boolean(p.showDate), titleTag: heading ? "h3" : "h2" };
  const layout = String(p.layout ?? "grid");
  let body: React.ReactNode;
  if (layout === "list") body = <EntryRows ctx={ctx} items={items} options={options} />;
  else if (layout === "carousel") {
    const desktop = Math.min(4, Math.max(1, Number(p.columnsDesktop ?? 3)));
    body = (
      <Slider
        slides={items.map((item) => (
          <EntryCard key={item.id} ctx={ctx} item={item} options={options} />
        ))}
        autoplay={false}
        intervalSeconds={6}
        showArrows
        showDots={false}
        label={heading || type?.namePlural || undefined}
        perView={{ mobile: 1, tablet: Math.min(2, desktop), desktop }}
        labels={{ previous: t(ctx.locale, "previous"), next: t(ctx.locale, "next"), slide: t(ctx.locale, "slide") }}
      />
    );
  } else if (layout === "accordion") {
    body = (
      <div className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <details key={item.id} className="group py-4" {...contentLangProps(ctx, item)}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {item.title}
              <span aria-hidden className="transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3 flex flex-col items-start gap-2 text-muted-fg">
              {item.summary && <p>{item.summary}</p>}
              {item.path && (
                <a href={item.path} className="text-sm underline underline-offset-4">
                  {t(ctx.locale, "readMore")}
                  <span className="sr-only">: {item.title}</span>
                </a>
              )}
            </div>
          </details>
        ))}
      </div>
    );
  } else if (layout === "table") {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm">
          <thead>
            <tr className="border-b border-line text-muted-fg">
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t(ctx.locale, "columnTitle")}</th>
              {options.showSummary && <th scope="col" className="py-2 pe-4 text-start font-medium">{t(ctx.locale, "columnSummary")}</th>}
              {options.showDate && <th scope="col" className="py-2 text-end font-medium">{t(ctx.locale, "columnDate")}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-line" {...contentLangProps(ctx, item)}>
                <th scope="row" className="py-3 pe-4 text-start font-medium">
                  {item.path ? <a href={item.path} className="underline-offset-4 hover:underline">{item.title}</a> : item.title}
                </th>
                {options.showSummary && <td className="py-3 pe-4 text-muted-fg">{item.summary}</td>}
                {options.showDate && (
                  <td className="py-3 text-end">
                    <EntryDate ctx={ctx} value={item.firstPublishedAt} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (layout === "logos") {
    body = (
      <ul className="flex flex-wrap items-center justify-center gap-10">
        {items.map((item) => {
          const key = usageKey(ctx, item.image);
          const img = key ? <img src={mediaUrl(ctx.mediaBase, key, "card") ?? undefined} alt={item.title} loading="lazy" className="h-12 w-auto object-contain" /> : <span className="font-medium">{item.title}</span>;
          return <li key={item.id}>{item.path ? <a href={item.path}>{img}</a> : img}</li>;
        })}
      </ul>
    );
  } else {
    body = <EntryGrid ctx={ctx} items={items} columns={Number(p.columnsDesktop ?? 3)} options={options} />;
  }
  return (
    <SectionShell s={s} ctx={ctx}>
      {(heading || (Boolean(p.showViewAll) && type?.indexPath)) && (
        <div className="mb-6 flex items-end justify-between gap-4">
          {heading ? <H className="text-2xl">{heading}</H> : <span />}
          {Boolean(p.showViewAll) && type?.indexPath && (
            <a href={type.indexPath} className="text-sm underline underline-offset-4">
              {t(ctx.locale, "viewAll")}
            </a>
          )}
        </div>
      )}
      {body}
    </SectionShell>
  );
}

type FaqItem = { id: string; question: string; answerHtml: string; path: string | null };
const faqItems = (s: RenderSection) => ((s.data?.items as FaqItem[] | undefined) ?? []).filter((i) => i.question);

export const faqV2Heading = (s: RenderSection, ctx: RenderCtx) => (faqItems(s).length ? L(ctx, s.props.heading) : "");

export function FaqV2({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const items = faqItems(s);
  if (!items.length) return null;
  const heading = L(ctx, p.heading);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto max-w-3xl">
        {heading && <H className="mb-6 text-3xl">{heading}</H>}
        <div className="divide-y divide-line border-y border-line">
          {items.map((i) => (
            <details key={i.id} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {i.question}
                <span aria-hidden className="transition group-open:rotate-45">+</span>
              </summary>
              <div className="prose-theme mt-3 text-muted-fg" dangerouslySetInnerHTML={{ __html: i.answerHtml }} />
            </details>
          ))}
        </div>
        {p.emitStructuredData !== false && (
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: items.map((i) => ({ "@type": "Question", name: i.question, acceptedAnswer: { "@type": "Answer", text: i.answerHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() } })),
            }}
          />
        )}
      </div>
    </SectionShell>
  );
}

export const richTextV2Heading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function RichTextV2({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const heading = L(ctx, p.heading);
  const html = String(s.data?.html ?? "");
  if (!heading && !html) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className={`mx-auto ${WIDTH[String(p.maxWidth)] ?? WIDTH.medium} ${p.alignment === "center" ? "text-center" : p.alignment === "right" ? "text-end" : ""}`}>
        {heading && <H className="mb-4 text-3xl">{heading}</H>}
        {html && <div className="prose-theme" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </SectionShell>
  );
}
