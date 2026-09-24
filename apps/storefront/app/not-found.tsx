import { fetchRoute } from "@/lib/api";
import { getSite, renderCtx } from "@/lib/site";
import { Sections } from "@/components/sections/render";

/** Renders the store's own "not found" template (with 404 status set by Next.js). */
export default async function NotFound() {
  const { site, tenant } = await getSite();
  const route = await fetchRoute(tenant, site, "/__not_found__", new URLSearchParams());
  return <Sections sections={route.sections} ctx={renderCtx(site, route, new URLSearchParams())} />;
}
