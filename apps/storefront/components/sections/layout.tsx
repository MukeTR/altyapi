import type { RenderSection, ResolvedLink } from "@altyapi/theme-engine";
import { mediaUrl } from "@/lib/media";
import { t } from "@/lib/i18n";
import { L, P, type RenderCtx } from "../context";
import { AnnouncementBar } from "../client/announcement-bar";
import { MobileMenu } from "../client/mobile-menu";
import { Popup } from "../client/popup";
import { NewsletterForm } from "../client/newsletter-form";
import { VisibilityGate } from "../client/visibility-gate";
import { CartButton } from "../client/cart";
import { assetKey } from "./content";

function withGate(s: RenderSection, ctx: RenderCtx, node: React.ReactNode) {
  return s.visibility ? (
    <VisibilityGate key={s.id} rules={s.visibility} locale={ctx.locale}>
      {node}
    </VisibilityGate>
  ) : (
    node
  );
}

export function AnnouncementBarSection({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const messages = s.blocks
    .filter((b) => b.type === "message")
    .map((b) => ({ text: L(ctx, b.props.text), href: b.props.link ? P(ctx, String(b.props.link)) : null }))
    .filter((m) => m.text);
  return withGate(
    s,
    ctx,
    <AnnouncementBar
      messages={messages}
      rotateSeconds={Number(p.rotateSeconds ?? 5)}
      dismissible={Boolean(p.dismissible)}
      scheme={String(p.colorScheme ?? "inverse")}
      closeLabel={t(ctx.locale, "close")}
      sectionId={s.id}
    />,
  );
}

function DesktopNav({ links }: { links: ResolvedLink[] }) {
  return (
    <ul className="hidden items-center gap-6 lg:flex">
      {links.map((l) => (
        <li key={l.href + l.label} className="group relative">
          <a href={l.href} className="py-2 hover:underline hover:underline-offset-4">
            {l.label}
          </a>
          {l.children?.length ? (
            <ul className="invisible absolute left-0 top-full z-40 min-w-48 rounded-theme border border-line bg-surface p-3 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              {l.children.map((c) => (
                <li key={c.href + c.label}>
                  <a href={c.href} className="block rounded px-2 py-1.5 hover:bg-muted">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function Header({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const links = ctx.site.menus[String(p.menuHandle ?? "main")] ?? [];
  const logoId = (p.logoAssetId as string | null) ?? ctx.site.theme.settings.brand.logoAssetId;
  const logo = logoId ? assetKey(ctx, logoId) : null;
  const brand = (
    <a href={P(ctx, "/")} className="flex items-center text-xl font-bold" aria-label={ctx.site.name}>
      {logo ? <img src={mediaUrl(ctx.mediaBase, logo) ?? undefined} alt={ctx.site.name} style={{ width: Number(p.logoWidth ?? 140) }} className="h-auto" /> : ctx.site.name}
    </a>
  );
  return (
    <header data-section-type="header" className={`${p.sticky ? "sticky top-0" : ""} z-40 border-b border-line bg-surface/95 backdrop-blur`}>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 bg-surface px-3 py-2">
        {ctx.locale === "en" ? "Skip to content" : "İçeriğe atla"}
      </a>
      <div className="container-theme flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <MobileMenu links={links} label={t(ctx.locale, "menu")} closeLabel={t(ctx.locale, "close")} />
          {p.layout !== "logo-center" && brand}
        </div>
        {p.layout === "logo-center" ? brand : <nav aria-label={t(ctx.locale, "menu")}><DesktopNav links={links} /></nav>}
        <div className="flex items-center gap-3">
          {Boolean(p.showSearch) && (
            <form method="get" action={P(ctx, "/search")} role="search" className="hidden md:block">
              <input type="search" name="q" aria-label={t(ctx.locale, "search")} placeholder={t(ctx.locale, "searchPlaceholder")} className="w-44 rounded-theme border border-line bg-surface px-3 py-1.5 text-sm" />
            </form>
          )}
          {Boolean(p.showLocaleSwitcher) && ctx.site.supportedLocales.length > 1 && (
            <nav aria-label="Language" className="flex gap-2 text-sm">
              {ctx.site.supportedLocales.map((l) => (
                <a key={l} href={ctx.route?.alternates[l] ?? (l === ctx.defaultLocale ? "/" : `/${l}`)} hrefLang={l} aria-current={l === ctx.locale} className={l === ctx.locale ? "font-bold" : ""}>
                  {l.toUpperCase()}
                </a>
              ))}
            </nav>
          )}
          <CartButton label={t(ctx.locale, "cart")} locale={ctx.locale} />
        </div>
      </div>
      {p.layout === "logo-center" && (
        <nav aria-label={t(ctx.locale, "menu")} className="container-theme hidden justify-center pb-3 lg:flex">
          <DesktopNav links={links} />
        </nav>
      )}
    </header>
  );
}

const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", pinterest: "Pinterest" };

export function Footer({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const menus = ((p.menuHandles as string[]) ?? []).map((h) => ({ handle: h, links: ctx.site.menus[h] ?? [] })).filter((m) => m.links.length);
  const social = (p.socialLinks as { network: string; url: string }[]) ?? [];
  return (
    <footer data-section-type="footer" data-scheme={String(p.colorScheme ?? "default")} className="mt-16 border-t border-line">
      <div className="container-theme grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <p className="text-lg font-bold">{ctx.site.name}</p>
          <div className="prose-theme text-sm text-muted-fg" dangerouslySetInnerHTML={{ __html: L(ctx, p.text) }} />
          {social.length > 0 && (
            <ul className="flex flex-wrap gap-3 text-sm">
              {social.map((x) => (
                <li key={x.url}>
                  <a href={x.url} rel="noopener noreferrer me" target="_blank" className="underline-offset-4 hover:underline">
                    {SOCIAL_LABEL[x.network] ?? x.network}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {menus.map((m) => (
          <nav key={m.handle} aria-label={m.handle}>
            <ul className="flex flex-col gap-2 text-sm">
              {m.links.map((l) => (
                <li key={l.href + l.label}>
                  <a href={l.href} className="hover:underline">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        {Boolean(p.showNewsletter) && (
          <div className="flex flex-col gap-3">
            <p className="font-medium">{ctx.locale === "en" ? "Newsletter" : "E-bülten"}</p>
            <NewsletterForm
              placeholder={t(ctx.locale, "email")}
              buttonLabel={t(ctx.locale, "subscribe")}
              successMessage={ctx.locale === "en" ? "Thank you!" : "Teşekkürler!"}
              consentHtml=""
              source={`footer:${s.id}`}
              locale={ctx.locale}
            />
          </div>
        )}
      </div>
      <div className="container-theme flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 text-xs text-muted-fg">
        <p>
          © {new Date().getUTCFullYear()} {ctx.site.name}
        </p>
        {Boolean(p.showPaymentIcons) && <p aria-label="Payment methods">VISA · Mastercard · Troy · American Express</p>}
      </div>
    </footer>
  );
}

export function PopupSection({ s, ctx }: { s: RenderSection; ctx: RenderCtx }) {
  const p = s.props as Record<string, unknown>;
  const image = p.imageAssetId ? assetKey(ctx, String(p.imageAssetId)) : null;
  const cta = p.cta as { label: Record<string, string>; href: string } | null;
  return withGate(
    s,
    ctx,
    <Popup
      id={s.id}
      trigger={p.trigger as never}
      frequency={p.frequency as never}
      placement={(p.placement as "modal" | "slide-in" | "bar") ?? "modal"}
      couponCode={(p.couponCode as string | null) ?? null}
      campaignId={(p.campaignId as string | null) ?? null}
      labels={{ close: t(ctx.locale, "close"), copy: t(ctx.locale, "copyCode"), copied: t(ctx.locale, "copied") }}
    >
      <div className="flex flex-col gap-3">
        {image && <img src={mediaUrl(ctx.mediaBase, image, "card") ?? undefined} alt="" className="w-full rounded-theme object-cover" />}
        {L(ctx, p.heading) && <h2 id={`sf_popup_${s.id}-title`} className="text-2xl">{L(ctx, p.heading)}</h2>}
        <div className="prose-theme" dangerouslySetInnerHTML={{ __html: L(ctx, p.body) }} />
        {Boolean(p.collectEmail) && (
          <NewsletterForm
            placeholder={t(ctx.locale, "email")}
            buttonLabel={t(ctx.locale, "subscribe")}
            successMessage={ctx.locale === "en" ? "Thank you!" : "Teşekkürler!"}
            consentHtml=""
            source={`popup:${s.id}`}
            locale={ctx.locale}
          />
        )}
        {cta && L(ctx, cta.label) && (
          <a href={P(ctx, cta.href)} className="btn btn-primary">
            {L(ctx, cta.label)}
          </a>
        )}
      </div>
    </Popup>,
  );
}
