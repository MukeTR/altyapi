import type { RenderSection } from "@altyapi/theme-engine";
import { mediaUrl, srcSet } from "@/lib/media";
import { t } from "@/lib/i18n";
import { L, P, type RenderCtx } from "../context";
import { Slider } from "../client/slider";
import { Countdown } from "../client/countdown";
import { NewsletterForm } from "../client/newsletter-form";
import { JsonLd } from "../ui/json-ld";
import type { HeadingTag } from "./render";
import { SectionShell } from "./shell";

type Link = { label: Record<string, string>; href: string; openInNewTab?: boolean } | null;

function Cta({ ctx, link, variant = "primary" }: { ctx: RenderCtx; link: Link; variant?: "primary" | "outline" }) {
  if (!link) return null;
  const label = L(ctx, link.label);
  if (!label) return null;
  return (
    <a href={P(ctx, link.href)} className={`btn ${variant === "primary" ? "btn-primary" : "btn-outline"}`} {...(link.openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {label}
    </a>
  );
}

function ResponsiveImage({ ctx, desktop, mobile, alt, priority, className }: { ctx: RenderCtx; desktop: string | null; mobile: string | null; alt: string; priority: boolean; className: string }) {
  const d = desktop ? assetKey(ctx, desktop) : null;
  const m = mobile ? assetKey(ctx, mobile) : null;
  if (!d && !m) return null;
  return (
    <picture>
      {m && <source media="(max-width: 767px)" srcSet={srcSet(ctx.mediaBase, m, "hero-mobile")} />}
      <img
        src={mediaUrl(ctx.mediaBase, (d ?? m)!, d ? "hero-desktop" : "hero-mobile") ?? undefined}
        srcSet={srcSet(ctx.mediaBase, (d ?? m)!, d ? "hero-desktop" : "hero-mobile")}
        sizes="100vw"
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        className={className}
      />
    </picture>
  );
}

/** Section props reference assets by id; the API returns the id → object key map. */
export function assetKey(ctx: RenderCtx, assetId: string): string | null {
  return ctx.route?.assets[assetId] ?? ctx.site.assets[assetId] ?? null;
}

const HEIGHT: Record<string, string> = { small: "min-h-[40vh]", medium: "min-h-[55vh]", large: "min-h-[70vh]", full: "min-h-[100svh]" };
// "left"/"right" are stored as chosen in a left-to-right editor; they map to the inline start
// and end so right-to-left pages mirror the layout.
const ALIGN: Record<string, string> = { left: "items-start text-start", center: "items-center text-center", right: "items-end text-end" };

export const heroHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function Hero({ s, ctx, index, heading: H }: { s: RenderSection; ctx: RenderCtx; index: number; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const heading = heroHeading(s, ctx);
  return (
    <SectionShell s={{ ...s, settings: { paddingTop: { mobile: 0, desktop: 0 }, paddingBottom: { mobile: 0, desktop: 0 }, ...s.settings } }} ctx={ctx} fullWidthDefault>
      <div className={`relative flex ${HEIGHT[String(p.height)] ?? HEIGHT.large} overflow-hidden`}>
        <ResponsiveImage
          ctx={ctx}
          desktop={(p.desktopImageAssetId as string | null) ?? null}
          mobile={(p.mobileImageAssetId as string | null) ?? null}
          alt=""
          priority={index === 0}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black" style={{ opacity: Number(p.overlayOpacity ?? 20) / 100 }} aria-hidden />
        <div className={`container-theme relative z-10 flex w-full flex-col justify-center gap-4 py-16 ${ALIGN[String(p.contentAlignment)] ?? ALIGN.center} ${p.desktopImageAssetId || p.mobileImageAssetId ? "text-white" : ""}`}>
          {heading && <H className="max-w-3xl text-4xl lg:text-6xl">{heading}</H>}
          {L(ctx, p.subheading) && <p className="max-w-2xl text-lg opacity-90">{L(ctx, p.subheading)}</p>}
          <div className="flex flex-wrap gap-3">
            <Cta ctx={ctx} link={p.primaryCta as Link} />
            <Cta ctx={ctx} link={p.secondaryCta as Link} variant="outline" />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

const ASPECT: Record<string, string> = { "21:9": "aspect-[21/9]", "16:9": "aspect-video", "3:1": "aspect-[3/1]", "4:1": "aspect-[4/1]", auto: "" };

export function ImageBanner({ s, ctx, index }: { s: RenderSection; ctx: RenderCtx; index: number }) {
  const p = s.props as Record<string, unknown>;
  const img = (
    <div className={`relative overflow-hidden rounded-theme bg-muted ${ASPECT[String(p.aspectRatio)] ?? ""}`}>
      <ResponsiveImage
        ctx={ctx}
        desktop={(p.desktopImageAssetId as string | null) ?? null}
        mobile={(p.mobileImageAssetId as string | null) ?? null}
        alt={L(ctx, p.alt)}
        priority={index === 0}
        className="h-full w-full object-cover"
      />
    </div>
  );
  const href = p.link ? P(ctx, String(p.link)) : null;
  return (
    <SectionShell s={s} ctx={ctx}>
      {href ? (
        <a href={href} data-track="banner_clicked" data-campaign-id={(p.campaignId as string | null) ?? undefined} data-section-id={s.id}>
          {img}
        </a>
      ) : (
        img
      )}
    </SectionShell>
  );
}

const slideBlocks = (s: RenderSection) => s.blocks.filter((b) => b.type === "slide");

/** The first slide's heading is the one visible on load; later slides are secondary. */
export const sliderHeading = (s: RenderSection, ctx: RenderCtx) => {
  const first = slideBlocks(s)[0];
  return first ? L(ctx, first.props.heading) : "";
};

export function SliderSection({ s, ctx, index, heading }: { s: RenderSection; ctx: RenderCtx; index: number; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const slides = slideBlocks(s)
    .map((b, i) => {
      const bp = b.props;
      const H = i === 0 ? heading : "h2";
      return (
        <div key={b.id} className={`relative flex ${HEIGHT[String(p.height)] ?? HEIGHT.large}`}>
          <ResponsiveImage
            ctx={ctx}
            desktop={(bp.desktopImageAssetId as string | null) ?? null}
            mobile={(bp.mobileImageAssetId as string | null) ?? null}
            alt={L(ctx, bp.alt)}
            priority={index === 0 && i === 0}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="container-theme relative z-10 flex w-full flex-col items-center justify-center gap-4 text-center text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.4)]">
            {L(ctx, bp.heading) && <H className="text-3xl lg:text-5xl">{L(ctx, bp.heading)}</H>}
            {L(ctx, bp.subheading) && <p className="text-lg">{L(ctx, bp.subheading)}</p>}
            <Cta ctx={ctx} link={bp.cta as Link} />
          </div>
        </div>
      );
    });
  return (
    <SectionShell s={{ ...s, settings: { paddingTop: { mobile: 0, desktop: 0 }, paddingBottom: { mobile: 0, desktop: 0 }, ...s.settings } }} ctx={ctx} fullWidthDefault>
      <Slider
        slides={slides}
        autoplay={Boolean(p.autoplay)}
        intervalSeconds={Number(p.intervalSeconds ?? 6)}
        showArrows={Boolean(p.showArrows)}
        showDots={Boolean(p.showDots)}
        labels={{ previous: t(ctx.locale, "previous"), next: t(ctx.locale, "next"), slide: t(ctx.locale, "slide") }}
      />
    </SectionShell>
  );
}

const WIDTH: Record<string, string> = { narrow: "max-w-2xl", medium: "max-w-3xl", wide: "max-w-5xl" };

export const richTextHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function RichText({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const heading = richTextHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className={`mx-auto ${WIDTH[String(p.maxWidth)] ?? WIDTH.medium} ${p.alignment === "center" ? "text-center" : p.alignment === "right" ? "text-end" : ""}`}>
        {heading && <H className="mb-4 text-3xl">{heading}</H>}
        {/* Stored rich text is sanitized on save (allow-list). */}
        <div className="prose-theme" dangerouslySetInnerHTML={{ __html: L(ctx, p.body) }} />
      </div>
    </SectionShell>
  );
}

export const imageWithTextHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function ImageWithText({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const key = p.imageAssetId ? assetKey(ctx, String(p.imageAssetId)) : null;
  const heading = imageWithTextHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className={`grid items-center gap-8 lg:grid-cols-2 ${p.imagePosition === "right" ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="overflow-hidden rounded-theme bg-muted">
          {key && <img src={mediaUrl(ctx.mediaBase, key, "product") ?? undefined} srcSet={srcSet(ctx.mediaBase, key, "product")} sizes="(min-width:1024px) 50vw, 100vw" alt="" loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="flex flex-col gap-4">
          {heading && <H className="text-3xl">{heading}</H>}
          <div className="prose-theme" dangerouslySetInnerHTML={{ __html: L(ctx, p.body) }} />
          <div>
            <Cta ctx={ctx} link={p.cta as Link} />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function embedUrl(url: string, autoplay: boolean, loop: boolean): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname === "youtu.be") {
      const id = u.hostname === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.split("/").pop();
      if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0${autoplay ? "&autoplay=1&mute=1" : ""}${loop ? `&loop=1&playlist=${id}` : ""}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (!id || !/^\d+$/.test(id)) return null;
      return `https://player.vimeo.com/video/${id}?dnt=1${autoplay ? "&autoplay=1&muted=1" : ""}${loop ? "&loop=1" : ""}`;
    }
  } catch {
    return null;
  }
  return null;
}

type VideoSource = { kind: "asset"; key: string; posterKey: string | null } | { kind: "embed"; src: string };

/** What the video section can play; null when the asset is missing or the URL is not allowed. */
function videoSource(s: RenderSection, ctx: RenderCtx): VideoSource | null {
  const p = s.props as Record<string, unknown>;
  if (p.source === "asset" && p.assetId) {
    const key = assetKey(ctx, String(p.assetId));
    return key ? { kind: "asset", key, posterKey: p.posterAssetId ? assetKey(ctx, String(p.posterAssetId)) : null } : null;
  }
  if (p.url) {
    const src = embedUrl(String(p.url), Boolean(p.autoplay), Boolean(p.loop));
    return src ? { kind: "embed", src } : null;
  }
  return null;
}

export const videoHeading = (s: RenderSection, ctx: RenderCtx) => (videoSource(s, ctx) ? L(ctx, s.props.heading) : "");

export function Video({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const autoplay = Boolean(p.autoplay);
  const source = videoSource(s, ctx);
  if (!source) return null;
  const heading = L(ctx, p.heading);
  const player =
    source.kind === "asset" ? (
      <video
        className="w-full rounded-theme"
        src={mediaUrl(ctx.mediaBase, source.key) ?? undefined}
        poster={source.posterKey ? mediaUrl(ctx.mediaBase, source.posterKey, "hero-desktop") ?? undefined : undefined}
        controls={!autoplay}
        autoPlay={autoplay}
        muted={autoplay}
        loop={Boolean(p.loop)}
        playsInline
        preload="metadata"
      />
    ) : (
      <div className="aspect-video overflow-hidden rounded-theme">
        <iframe src={source.src} title={heading || t(ctx.locale, "video")} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
      </div>
    );
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-6 text-center text-3xl">{heading}</H>}
      {player}
    </SectionShell>
  );
}

export const testimonialsHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function Testimonials({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const items = s.blocks.filter((b) => b.type === "testimonial");
  const heading = testimonialsHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-8 text-center text-3xl">{heading}</H>}
      <ul className={p.layout === "grid" ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3" : "flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4"}>
        {items.map((b) => {
          const avatar = b.props.avatarAssetId ? assetKey(ctx, String(b.props.avatarAssetId)) : null;
          const rating = b.props.rating as number | null;
          return (
            <li key={b.id} className={`flex flex-col gap-4 rounded-theme border border-line p-6 ${p.layout === "grid" ? "" : "w-80 shrink-0 snap-start"}`}>
              {rating ? (
                <p aria-label={t(ctx.locale, "rating", { n: rating })} className="text-sale">
                  {"★".repeat(rating)}
                  <span className="text-muted-fg">{"★".repeat(5 - rating)}</span>
                </p>
              ) : null}
              <blockquote className="flex-1 text-base">“{L(ctx, b.props.quote)}”</blockquote>
              <footer className="flex items-center gap-3">
                {avatar && <img src={mediaUrl(ctx.mediaBase, avatar, "thumbnail") ?? undefined} alt="" className="h-10 w-10 rounded-full object-cover" loading="lazy" />}
                <span>
                  <strong className="block text-sm">{String(b.props.author ?? "")}</strong>
                  {L(ctx, b.props.role) && <span className="text-xs text-muted-fg">{L(ctx, b.props.role)}</span>}
                </span>
              </footer>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

export const logoCloudHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function LogoCloud({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const heading = logoCloudHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-8 text-center text-2xl">{heading}</H>}
      <ul className="flex flex-wrap items-center justify-center gap-10">
        {s.blocks
          .filter((b) => b.type === "logo")
          .map((b) => {
            const key = assetKey(ctx, String(b.props.assetId));
            if (!key) return null;
            const img = <img src={mediaUrl(ctx.mediaBase, key, "card") ?? undefined} alt={String(b.props.name ?? "")} loading="lazy" className={`h-10 w-auto object-contain ${p.grayscale ? "opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" : ""}`} />;
            return <li key={b.id}>{b.props.link ? <a href={P(ctx, String(b.props.link))}>{img}</a> : img}</li>;
          })}
      </ul>
    </SectionShell>
  );
}

export const newsletterHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function Newsletter({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const heading = newsletterHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        {heading && <H className="text-3xl">{heading}</H>}
        {L(ctx, p.body) && <p className="text-muted-fg">{L(ctx, p.body)}</p>}
        <NewsletterForm
          placeholder={L(ctx, p.placeholder) || t(ctx.locale, "email")}
          buttonLabel={L(ctx, p.buttonLabel) || t(ctx.locale, "subscribe")}
          successMessage={L(ctx, p.successMessage) || t(ctx.locale, "thankYou")}
          consentHtml={L(ctx, p.consentText)}
          source={`section:${s.id}`}
          locale={ctx.locale}
        />
      </div>
    </SectionShell>
  );
}

export const faqHeading = (s: RenderSection, ctx: RenderCtx) => L(ctx, s.props.heading);

export function Faq({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  const items = s.blocks.filter((b) => b.type === "item").map((b) => ({ id: b.id, q: L(ctx, b.props.question), a: L(ctx, b.props.answer) }));
  const heading = faqHeading(s, ctx);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto max-w-3xl">
        {heading && <H className="mb-6 text-3xl">{heading}</H>}
        <div className="divide-y divide-line border-y border-line">
          {items.map((i) => (
            <details key={i.id} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {i.q}
                <span aria-hidden className="transition group-open:rotate-45">+</span>
              </summary>
              <div className="prose-theme mt-3 text-muted-fg" dangerouslySetInnerHTML={{ __html: i.a }} />
            </details>
          ))}
        </div>
        {p.emitStructuredData !== false && items.length > 0 && (
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a.replace(/<[^>]+>/g, " ").trim() } })),
            }}
          />
        )}
      </div>
    </SectionShell>
  );
}

const countdownHidden = (s: RenderSection) => s.props.expiredBehavior === "hide" && Date.parse(String(s.props.endsAt)) <= Date.now();

export const countdownHeading = (s: RenderSection, ctx: RenderCtx) => (countdownHidden(s) ? "" : L(ctx, s.props.heading));

export function CountdownSection({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Record<string, unknown>;
  if (countdownHidden(s)) return null;
  const heading = L(ctx, p.heading);
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="flex flex-col items-center gap-4 text-center">
        {heading && <H className="text-2xl">{heading}</H>}
        <Countdown
          endsAt={String(p.endsAt)}
          expiredBehavior={p.expiredBehavior === "show_message" ? "show_message" : "hide"}
          expiredMessage={L(ctx, p.expiredMessage)}
          labels={{ days: t(ctx.locale, "days"), hours: t(ctx.locale, "hours"), minutes: t(ctx.locale, "minutes"), seconds: t(ctx.locale, "seconds") }}
        />
        <Cta ctx={ctx} link={p.cta as Link} />
      </div>
    </SectionShell>
  );
}
