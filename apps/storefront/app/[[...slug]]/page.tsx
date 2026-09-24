import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import type { ResolvedRoute } from "@altyapi/theme-engine";
import { fetchRoute } from "@/lib/api";
import { getSite, renderCtx } from "@/lib/site";
import { mediaUrl } from "@/lib/media";
import { ogLocale } from "@/lib/i18n";
import { Sections } from "@/components/sections/render";
import { JsonLd } from "@/components/ui/json-ld";

type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => out.append(k, x));
    else if (v !== undefined) out.set(k, v);
  }
  return out;
}

const loadRoute = cache(async (path: string, query: string): Promise<ResolvedRoute> => {
  const { site, tenant } = await getSite();
  return fetchRoute(tenant, site, path, new URLSearchParams(query));
});

async function resolve(props: Props) {
  const { slug } = await props.params;
  const sp = toSearchParams(await props.searchParams);
  const path = `/${(slug ?? []).map(encodeURIComponent).join("/")}`;
  const route = await loadRoute(path, sp.toString());
  return { route, sp };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { site } = await getSite();
  const { route } = await resolve(props);
  if (route.kind === "redirect") return {};
  // Social image: the page's SEO image for home and content pages, else the product/collection image.
  const image = route.seo.imageObjectKey ? mediaUrl(site.mediaBaseUrl, route.seo.imageObjectKey, "social") : null;
  // route.alternates only holds languages that have content of their own for this route, so
  // hreflang is emitted only for a real set of translations.
  const languages = Object.keys(route.alternates);
  const xDefault = route.alternates[site.defaultLocale];
  // An untranslated entry served in the default language (noindex) is content in that language.
  const contentLocale = route.entry?.fallback ? route.entry.locale : route.locale;
  return {
    title: route.kind === "home" ? { absolute: route.seo.title } : route.seo.title,
    description: route.seo.description || undefined,
    alternates: {
      canonical: route.canonicalPath,
      ...(languages.length > 1 ? { languages: { ...route.alternates, ...(xDefault ? { "x-default": xDefault } : {}) } } : {}),
    },
    openGraph: {
      title: route.seo.title,
      description: route.seo.description || undefined,
      url: route.canonicalPath,
      siteName: site.name,
      locale: ogLocale(contentLocale),
      alternateLocale: languages.filter((l) => l !== contentLocale).map(ogLocale),
      // Content entries are articles with their publish and last significant update dates.
      ...(route.seo.ogType === "article"
        ? {
            type: "article" as const,
            ...(route.seo.publishedAt ? { publishedTime: route.seo.publishedAt } : {}),
            ...(route.seo.modifiedAt ? { modifiedTime: route.seo.modifiedAt } : {}),
          }
        : { type: "website" as const }),
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: route.seo.title }] } : {}),
    },
    ...(image ? { twitter: { card: "summary_large_image", images: [image] } } : {}),
    ...(route.seo.noindex || route.status === 404 || route.status === 410 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Page(props: Props) {
  const { site } = await getSite();
  const { route, sp } = await resolve(props);
  if (route.kind === "redirect" && route.redirectTo) {
    if (route.status === 302) redirect(route.redirectTo);
    permanentRedirect(route.redirectTo);
  }
  // A removed path (410) is answered with status 410 by the proxy before the page renders
  // (lib/gone.ts renders this not-found page for it). App Router pages can only answer
  // not-found with 404, which is what client-side navigation to such a path gets; noindex either way.
  if (route.status === 404 || route.status === 410) notFound();
  const ctx = renderCtx(site, route, sp);
  const origin = site.canonicalHost ? `https://${site.canonicalHost}` : "";
  return (
    <>
      <Sections sections={route.sections} ctx={ctx} />
      {route.breadcrumbs.length > 1 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: route.breadcrumbs.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: `${origin}${b.path}` })),
          }}
        />
      )}
      {route.kind === "home" && (
        <JsonLd
          data={[
            { "@context": "https://schema.org", "@type": "Organization", name: site.name, url: origin || undefined },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: site.name,
              url: origin || undefined,
              potentialAction: { "@type": "SearchAction", target: `${origin}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
            },
          ]}
        />
      )}
    </>
  );
}
