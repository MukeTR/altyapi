import { getSite } from "@/lib/site";
import { loadSitemap, origin, SITEMAP_CHUNK, xmlEscape } from "@/lib/sitemap";

/** Sitemap index pointing to chunked product/collection/page sitemaps. */
export async function GET() {
  const { site, tenant } = await getSite();
  const data = await loadSitemap(tenant);
  const base = origin(site, tenant);
  const files: string[] = ["pages-1.xml"];
  const productCount = data.products.filter((p) => p.locale === data.defaultLocale).length;
  const collectionCount = data.collections.filter((c) => c.locale === data.defaultLocale).length;
  for (let i = 1; i <= Math.max(1, Math.ceil(productCount / SITEMAP_CHUNK)); i++) files.push(`products-${i}.xml`);
  for (let i = 1; i <= Math.max(1, Math.ceil(collectionCount / SITEMAP_CHUNK)); i++) files.push(`collections-${i}.xml`);
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files
    .map((f) => `<sitemap><loc>${xmlEscape(`${base}/sitemaps/${f}`)}</loc><lastmod>${now}</lastmod></sitemap>`)
    .join("")}</sitemapindex>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
