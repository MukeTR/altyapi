import type { Metadata } from "next";
import { Listings } from "@/components/integrations/listings";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { param } from "@/lib/commerce/query";
import { getI18n } from "@/lib/i18n/server";
import { LISTINGS_PAGE, type ExternalListing, type IntegrationConnection } from "@/lib/integrations/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.listings.title") };
}

/** Apps & Integrations › Channel listings (integrations:read), offset paged by SKU. */
export default async function ListingsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const sku = param(sp, "sku");
  const unmatched = param(sp, "unmatched") === "true";
  const connectionId = param(sp, "connectionId");
  const offset = Math.max(0, Number.parseInt(param(sp, "offset"), 10) || 0);
  const [listings, connections] = await Promise.all([
    load<ItemList<ExternalListing>>(`${ctx.apiBase}/integrations/listings`, {
      query: { sku: sku || undefined, unmatched: unmatched || undefined, connectionId: /^[0-9a-f-]{36}$/i.test(connectionId) ? connectionId : undefined, limit: LISTINGS_PAGE, offset },
    }),
    load<ItemList<IntegrationConnection>>(`${ctx.apiBase}/integrations/connections`),
  ]);
  return <Listings result={listings} connections={connections.ok ? connections.data.items : []} offset={offset} filtered={Boolean(sku || unmatched || connectionId)} />;
}
