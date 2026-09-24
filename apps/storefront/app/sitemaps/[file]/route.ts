import { getSite } from "@/lib/site";
import { buildEntries, loadSitemap, origin, SITEMAP_CHUNK, urlset } from "@/lib/sitemap";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^(products|collections|pages)-(\d+)\.xml$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const kind = m[1] as "products" | "collections" | "pages";
  const chunk = Number(m[2]);
  const { site, tenant } = await getSite();
  const entries = buildEntries(await loadSitemap(tenant), kind, origin(site, tenant));
  const slice = entries.slice((chunk - 1) * SITEMAP_CHUNK, chunk * SITEMAP_CHUNK);
  if (!slice.length && chunk > 1) return new Response("Not found", { status: 404 });
  return new Response(urlset(slice), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
