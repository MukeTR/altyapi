import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fontHref, getSite, renderCtx } from "@/lib/site";
import { t } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { Sections } from "@/components/sections/render";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { site } = await getSite();
  const favicon = site.theme.settings.brand.faviconAssetId ? site.assets[site.theme.settings.brand.faviconAssetId] : null;
  return {
    title: { default: site.name, template: `%s · ${site.name}` },
    ...(site.canonicalHost ? { metadataBase: new URL(`https://${site.canonicalHost}`) } : {}),
    ...(favicon && site.mediaBaseUrl ? { icons: { icon: mediaUrl(site.mediaBaseUrl, favicon, "thumbnail") ?? undefined } } : {}),
    // Stores that are not live yet (or previews) must not be indexed.
    ...(site.status !== "active" || site.preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { site } = await getSite();
  const ctx = renderCtx(site, null, new URLSearchParams());
  const before = site.globalSections.filter((s) => s.type === "announcement-bar" || s.type === "header" || s.type === "countdown");
  const after = site.globalSections.filter((s) => s.type === "footer" || s.type === "newsletter");
  const overlays = site.globalSections.filter((s) => s.type === "popup");
  const fonts = fontHref(site);
  return (
    <html lang={site.locale}>
      <head>
        {fonts && <link rel="stylesheet" href={fonts} />}
        {/* Theme tokens are validated (hex colors, enum fonts) so this CSS cannot be injected into. */}
        <style dangerouslySetInnerHTML={{ __html: site.theme.css }} />
      </head>
      <body className="min-h-screen antialiased">
        {site.preview && (
          <div role="status" className="bg-amber-400 px-4 py-2 text-center text-sm text-black">
            {t(site.locale, "previewBanner")}{" "}
            <a href="?exit_preview=1" className="font-semibold underline">
              {t(site.locale, "exitPreview")}
            </a>
          </div>
        )}
        {site.status === "paused" ? (
          <main id="main" className="container-theme py-24 text-center">
            <h1 className="text-3xl">{site.name}</h1>
            <p className="mt-4 text-muted-fg">{t(site.locale, "storeClosed")}</p>
          </main>
        ) : (
          <>
            <Sections sections={before} ctx={ctx} />
            <main id="main">{children}</main>
            <Sections sections={after} ctx={ctx} />
            <Sections sections={overlays} ctx={ctx} />
          </>
        )}
      </body>
    </html>
  );
}
