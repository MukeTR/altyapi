import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import type { ResolvedRoute } from "@altyapi/theme-engine";
import { fetchRoute } from "@/lib/api";
import { getSite, renderCtx } from "@/lib/site";
import { mediaUrl } from "@/lib/media";
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
  const image = route.seo.imageObjectKey ? mediaUrl(site.mediaBaseUrl, route.seo.imageObjectKey, "social") : null;
  return {
    title: route.kind === "home" ? { absolute: route.seo.title } : route.seo.title,
    description: route.seo.description || undefined,
    alternates: {
      canonical: route.canonicalPath,
      languages: {
        ...route.alternates,
        ...(route.alternates[site.defaultLocale] ? { "x-default": route.alternates[site.defaultLocale] } : {}),
      },
    },
    openGraph: {
      title: route.seo.title,
      description: route.seo.description || undefined,
      url: route.canonicalPath,
      siteName: site.name,
      locale: site.locale === "tr" ? "tr_TR" : site.locale,
      type: route.kind === "product" ? "website" : "website",
      ...(image ? { images: [{ url: image, width: 1200, height: 630 }] } : {}),
    },
    ...(route.seo.noindex || route.status === 404 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Page(props: Props) {
  const { site } = await getSite();
  const { route, sp } = await resolve(props);
  if (route.kind === "redirect" && route.redirectTo) {
    if (route.status === 302) redirect(route.redirectTo);
    permanentRedirect(route.redirectTo);
  }
  if (route.status === 404) notFound();
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
