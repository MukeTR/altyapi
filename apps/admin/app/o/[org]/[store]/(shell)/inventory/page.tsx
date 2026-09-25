import type { Metadata } from "next";
import { InventoryView, type InventoryRow } from "@/components/inventory/inventory-view";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { mediaConfig } from "@/lib/commerce/media-server";
import { oneOf, param } from "@/lib/commerce/query";
import type { Location, ProductDetail, ProductListItem } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Products per page: every product's variants and per-location levels are read from its detail. */
const PAGE_SIZE = 20;

interface OwnershipEntry {
  domain: string;
  connectionId: string | null;
  connectionName: string | null;
  externalOwnerLabel: string | null;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("inventory.title") };
}

/** Stock by variant and location with adjustments and counts. */
export default async function InventoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const { t } = await getI18n();
  const q = param(sp, "q");
  const status = oneOf(param(sp, "status"), ["draft", "active", "archived"] as const);
  const [page, locations, ownership] = await Promise.all([
    load<CursorPage<ProductListItem>>(`${ctx.apiBase}/products`, { query: { q: q || undefined, status, limit: PAGE_SIZE, cursor: param(sp, "cursor") || undefined } }),
    load<ItemList<Location>>(`${ctx.apiBase}/inventory/locations`),
    ctx.permissions.includes("integrations:read") ? load<ItemList<OwnershipEntry>>(`${ctx.apiBase}/integrations/ownership`) : Promise.resolve(null),
  ]);

  let rows: InventoryRow[] = [];
  let detailError = null;
  if (page.ok) {
    const details = await Promise.all(page.data.items.map((p) => load<ProductDetail>(`${ctx.apiBase}/products/${p.id}`)));
    for (const [i, d] of details.entries()) {
      const item = page.data.items[i]!;
      if (!d.ok) {
        detailError ??= d.error;
        continue;
      }
      const titleOf = (valueIds: string[]) =>
        d.data.options
          .map((o) => o.values.find((v) => valueIds.includes(v.id)))
          .filter(Boolean)
          .map((v) => v!.value[ctx.store.defaultLocale] ?? Object.values(v!.value)[0] ?? "")
          .join(" / ");
      for (const v of d.data.variants) {
        rows.push({
          productId: item.id,
          productTitle: item.title,
          productStatus: item.status,
          imageObjectKey: item.imageObjectKey,
          variantId: v.id,
          variantTitle: titleOf(v.optionValueIds),
          sku: v.sku,
          trackInventory: v.trackInventory,
          allowBackorder: v.allowBackorder,
          inventory: v.inventory,
        });
      }
    }
  }
  const stockOwner = ownership?.ok ? (ownership.data.items.find((o) => o.domain === "stock" && (o.connectionId || o.externalOwnerLabel)) ?? null) : null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("inventory.title")} />
      <InventoryView
        page={page.ok ? { ok: true, data: { rows, nextCursor: page.data.nextCursor } } : page}
        locations={locations.ok ? locations.data.items : []}
        locationsError={locations.ok ? null : locations.error}
        detailError={detailError}
        stockOwner={stockOwner ? (stockOwner.connectionName ?? stockOwner.externalOwnerLabel) : null}
        filtered={Boolean(q || status)}
        media={mediaConfig()}
      />
    </div>
  );
}
