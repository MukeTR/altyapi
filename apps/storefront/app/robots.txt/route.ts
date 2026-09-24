import { getSite } from "@/lib/site";
import { origin } from "@/lib/sitemap";

export async function GET() {
  const { site, tenant } = await getSite();
  const live = site.status === "active" && !site.preview;
  const body = live
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /account",
        "Disallow: /api/",
        "Disallow: /search",
        "Disallow: /*?*sort=",
        "Disallow: /*?*price_min=",
        "Disallow: /*?*price_max=",
        "Disallow: /*?*in_stock=",
        "Disallow: /*?*on_sale=",
        "",
        `Sitemap: ${origin(site, tenant)}/sitemap.xml`,
      ].join("\n")
    : "User-agent: *\nDisallow: /";
  return new Response(`${body}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
