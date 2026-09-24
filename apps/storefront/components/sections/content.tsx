import type { RenderSection } from "@altyapi/theme-engine";
import { mediaUrl, srcSet } from "@/lib/media";
import { t } from "@/lib/i18n";
import { L, P, type RenderCtx } from "../context";
import { Slider } from "../client/slider";
import { Countdown } from "../client/countdown";
import { NewsletterForm } from "../client/newsletter-form";
import { JsonLd } from "../ui/json-ld";
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
const ALIGN: Record<string, string> = { left: "items-start text-left", center: "items-center text-center", right: "items-end text-right" };

export function Hero({ s, ctx, index }: { s: RenderSection; ctx: RenderCtx; index: number }) {
  const p = s.props as Record<string, unknown>;
  const heading = L(ctx, p.heading);
  const H = index === 0 && ctx.route?.kind === "home" ? "h1" : "h2";
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

export function SliderSection({ s, ctx, index }: { s: RenderSection; ctx: RenderCtx; index: number }) {
  const p = s.props as Record<string, unknown>;
  const slides = s.blocks
    .filter((b) => b.type === "slide")
    .map((b, i) => {
      const bp = b.props;
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
            {L(ctx, bp.heading) && <h2 className="text-3xl lg:text-5xl">{L(ctx, bp.heading)}</h2>}
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
        labels={{ previous: t(ctx.locale, "previous"), next: t(ctx.locale, "next"), slide: "Slide" }}
      />
    </SectionShell>
  );
}

const WIDTH: Record<string, string> = { narrow: "max-w-2xl", medium: "max-w-3xl", wide: "max-w-5xl" };

export function RichText({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className={`mx-auto ${WIDTH[String(p.maxWidth)] ?? WIDTH.medium} ${p.alignment === "center" ? "text-center" : p.alignment === "right" ? "text-right" : ""}`}>
        {L(ctx, p.heading) && <h2 className="mb-4 text-3xl">{L(ctx, p.heading)}</h2>}
        {/* Stored rich text is sanitized on save (allow-list). */}
        <div className="prose-theme" dangerouslySetInnerHTML={{ __html: L(ctx, p.body) }} />
      </div>
    </SectionShell>
  );
}

export function ImageWithText({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const key = p.imageAssetId ? assetKey(ctx, String(p.imageAssetId)) : null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className={`grid items-center gap-8 lg:grid-cols-2 ${p.imagePosition === "right" ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="overflow-hidden rounded-theme bg-muted">
          {key && <img src={mediaUrl(ctx.mediaBase, key, "product") ?? undefined} srcSet={srcSet(ctx.mediaBase, key, "product")} sizes="(min-width:1024px) 50vw, 100vw" alt="" loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="flex flex-col gap-4">
          {L(ctx, p.heading) && <h2 className="text-3xl">{L(ctx, p.heading)}</h2>}
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

export function Video({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const autoplay = Boolean(p.autoplay);
  const loop = Boolean(p.loop);
  let player = null;
  if (p.source === "asset" && p.assetId) {
    const key = assetKey(ctx, String(p.assetId));
    const poster = p.posterAssetId ? assetKey(ctx, String(p.posterAssetId)) : null;
    if (key) {
      player = (
        <video
          className="w-full rounded-theme"
          src={mediaUrl(ctx.mediaBase, key) ?? undefined}
          poster={poster ? mediaUrl(ctx.mediaBase, poster, "hero-desktop") ?? undefined : undefined}
          controls={!autoplay}
          autoPlay={autoplay}
          muted={autoplay}
          loop={loop}
          playsInline
          preload="metadata"
        />
      );
    }
  } else if (p.url) {
    const src = embedUrl(String(p.url), autoplay, loop);
    if (src) {
      player = (
        <div className="aspect-video overflow-hidden rounded-theme">
          <iframe src={src} title={L(ctx, p.heading) || "Video"} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      );
    }
  }
  if (!player) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      {L(ctx, p.heading) && <h2 className="mb-6 text-center text-3xl">{L(ctx, p.heading)}</h2>}
      {player}
    </SectionShell>
  );
}

export function Testimonials({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const items = s.blocks.filter((b) => b.type === "testimonial");
  return (
    <SectionShell s={s} ctx={ctx}>
      {L(ctx, p.heading) && <h2 className="mb-8 text-center text-3xl">{L(ctx, p.heading)}</h2>}
      <ul className={p.layout === "grid" ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3" : "flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4"}>
        {items.map((b) => {
          const avatar = b.props.avatarAssetId ? assetKey(ctx, String(b.props.avatarAssetId)) : null;
          const rating = b.props.rating as number | null;
          return (
            <li key={b.id} className={`flex flex-col gap-4 rounded-theme border border-line p-6 ${p.layout === "grid" ? "" : "w-80 shrink-0 snap-start"}`}>
              {rating ? (
                <p aria-label={`${rating}/5`} className="text-sale">
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

export function LogoCloud({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  return (
    <SectionShell s={s} ctx={ctx}>
      {L(ctx, p.heading) && <h2 className="mb-8 text-center text-2xl">{L(ctx, p.heading)}</h2>}
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

export function Newsletter({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        {L(ctx, p.heading) && <h2 className="text-3xl">{L(ctx, p.heading)}</h2>}
        {L(ctx, p.body) && <p className="text-muted-fg">{L(ctx, p.body)}</p>}
        <NewsletterForm
          placeholder={L(ctx, p.placeholder) || t(ctx.locale, "email")}
          buttonLabel={L(ctx, p.buttonLabel) || t(ctx.locale, "subscribe")}
          successMessage={L(ctx, p.successMessage) || "✓"}
          consentHtml={L(ctx, p.consentText)}
          source={`section:${s.id}`}
          locale={ctx.locale}
        />
      </div>
    </SectionShell>
  );
}

export function Faq({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const items = s.blocks.filter((b) => b.type === "item").map((b) => ({ id: b.id, q: L(ctx, b.props.question), a: L(ctx, b.props.answer) }));
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="mx-auto max-w-3xl">
        {L(ctx, p.heading) && <h2 className="mb-6 text-3xl">{L(ctx, p.heading)}</h2>}
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

export function CountdownSection({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const ended = Date.parse(String(p.endsAt)) <= Date.now();
  if (ended && p.expiredBehavior === "hide") return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="flex flex-col items-center gap-4 text-center">
        {L(ctx, p.heading) && <h2 className="text-2xl">{L(ctx, p.heading)}</h2>}
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
