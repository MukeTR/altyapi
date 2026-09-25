import "server-only";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { StoreContextValue } from "@/components/providers/store-provider";
import type { Category, CollectionListItem, Location, PriceList, ResolvedPrice, TaxClass } from "@/lib/commerce/types";
import type { ApiErrorInfo } from "@/lib/api/errors";

/** Reference data of the product editor. Lists the user may not read come back empty (null error-free). */
export interface ProductEditorData {
  collections: CollectionListItem[];
  categories: Category[];
  /** null when the user cannot read tax classes (settings:read). */
  taxClasses: TaxClass[] | null;
  locations: Location[];
  priceLists: PriceList[] | null;
  /** Failure of a list the editor depends on (shown above the form). */
  error: ApiErrorInfo | null;
}

export async function loadProductEditorData(ctx: StoreContextValue): Promise<ProductEditorData> {
  const can = (p: string) => ctx.permissions.includes(p);
  const [collections, categories, taxClasses, locations, priceLists] = await Promise.all([
    load<ItemList<CollectionListItem>>(`${ctx.apiBase}/collections`),
    load<ItemList<Category>>(`${ctx.apiBase}/categories`),
    can("settings:read") ? load<ItemList<TaxClass>>(`${ctx.apiBase}/tax-classes`) : Promise.resolve(null),
    can("inventory:read") ? load<ItemList<Location>>(`${ctx.apiBase}/inventory/locations`) : Promise.resolve(null),
    can("pricing:read") ? load<ItemList<PriceList>>(`${ctx.apiBase}/price-lists`) : Promise.resolve(null),
  ]);
  const firstError = [collections, categories].find((r) => !r.ok);
  return {
    collections: collections.ok ? collections.data.items : [],
    categories: categories.ok ? categories.data.items : [],
    taxClasses: taxClasses?.ok ? taxClasses.data.items : null,
    locations: locations?.ok ? locations.data.items : [],
    priceLists: priceLists?.ok ? priceLists.data.items : null,
    error: firstError && !firstError.ok ? firstError.error : null,
  };
}

/** Resolved price of every variant in each enabled currency (the price shoppers pay today). */
export async function loadResolvedPrices(ctx: StoreContextValue, variantIds: string[]): Promise<Record<string, ResolvedPrice[]> | null> {
  if (!ctx.permissions.includes("pricing:read") || variantIds.length === 0) return null;
  const results = await Promise.all(
    ctx.store.supportedCurrencies.map((currency) =>
      load<ItemList<ResolvedPrice>>(`${ctx.apiBase}/prices/query`, { method: "POST", body: { variantIds: variantIds.slice(0, 500), currency } }),
    ),
  );
  const out: Record<string, ResolvedPrice[]> = {};
  ctx.store.supportedCurrencies.forEach((currency, i) => {
    const r = results[i];
    if (r?.ok) out[currency] = r.data.items;
  });
  return out;
}
