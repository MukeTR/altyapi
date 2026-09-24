import { getSite } from "@/lib/site";
import { loadSitemap, origin, sitemapFiles, xmlEscape } from "@/lib/sitemap";

/** Sitemap index pointing to chunked page/product/collection sitemaps. */
export async function GET() {
  const { site, tenant } = await getSite();
  const base = origin(site, tenant);
  const files = sitemapFiles(await loadSitemap(site, tenant), base);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files
    .map((f) => `<sitemap><loc>${xmlEscape(`${base}/sitemaps/${f.name}`)}</loc>${f.lastmod ? `<lastmod>${f.lastmod}</lastmod>` : ""}</sitemap>`)
    .join("")}</sitemapindex>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
