import { getSite } from "@/lib/site";
import { buildEntries, chunkOf, loadSitemap, origin, urlset, type SitemapKind } from "@/lib/sitemap";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^(products|collections|pages)-(\d+)\.xml$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const kind = m[1] as SitemapKind;
  const chunk = Number(m[2]);
  if (chunk < 1) return new Response("Not found", { status: 404 });
  const { site, tenant } = await getSite();
  const entries = buildEntries(await loadSitemap(site, tenant), kind, origin(site, tenant));
  const slice = chunkOf(entries, chunk);
  if (!slice.length && chunk > 1) return new Response("Not found", { status: 404 });
  return new Response(urlset(slice), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
