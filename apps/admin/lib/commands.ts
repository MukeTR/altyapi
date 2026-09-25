import type { LucideIcon } from "lucide-react";
import { CreditCard, FilePlus2, Globe, Layers, Link2, Package, Palette, PlugZap, Plus, Receipt, Upload } from "lucide-react";
import { bff } from "@/lib/api/client";
import type { CursorPage } from "@/lib/api/types";
import type { OrderListItem, ProductListItem } from "@/lib/commerce/types";
import type { StoreContextValue } from "@/components/providers/store-provider";
import type { MessageKey } from "@/lib/i18n/translate";
import type { Permission } from "@/lib/permissions";

/**
 * Command palette extension points. The palette always offers navigation (from lib/nav.ts),
 * store switching and the built-in commands; features add their own entries here when their
 * screens ship.
 */

/** A search over one kind of record (orders by number or e-mail, products by title or SKU). */
export interface RecordSearchProvider {
  id: string;
  /** Group heading. */
  label: MessageKey;
  icon: LucideIcon;
  /** The provider runs only when the user holds one of these. */
  anyOf: readonly Permission[];
  /** Minimum query length before searching. */
  minLength?: number;
  /** Called debounced (200 ms) with an AbortSignal; returns at most a handful of results. */
  search: (query: string, ctx: StoreContextValue, signal: AbortSignal) => Promise<RecordResult[]>;
}

export interface RecordResult {
  id: string;
  label: string;
  description?: string;
  href: string;
}

/** A navigation shortcut to a create/edit flow ("New product", "Add domain"). */
export interface StoreCommand {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  anyOf: readonly Permission[];
  /** Path below the store base. */
  path: string;
  keywords?: readonly string[];
}

export const RECORD_SEARCH_PROVIDERS: readonly RecordSearchProvider[] = [
  {
    id: "orders",
    label: "orders.search.group",
    icon: Receipt,
    anyOf: ["orders:read"],
    minLength: 2,
    search: async (query, ctx, signal) => {
      const page = await bff<CursorPage<OrderListItem>>(`${ctx.apiBase}/orders`, { query: { q: query, limit: 5 }, signal });
      return page.items.map((o) => ({ id: o.id, label: `#${o.number}`, ...(o.email ? { description: o.email } : {}), href: `${ctx.basePath}/orders/${o.id}` }));
    },
  },
  {
    id: "products",
    label: "products.search.group",
    icon: Package,
    anyOf: ["catalog:read"],
    minLength: 2,
    search: async (query, ctx, signal) => {
      const page = await bff<CursorPage<ProductListItem>>(`${ctx.apiBase}/products`, { query: { q: query, limit: 5 }, signal });
      return page.items.map((p) => ({ id: p.id, label: p.title || p.handle, ...(p.skus[0] ? { description: p.skus[0] } : {}), href: `${ctx.basePath}/products/${p.id}` }));
    },
  },
];

export const STORE_COMMANDS: readonly StoreCommand[] = [
  { id: "product.new", label: "products.commands.new", icon: Plus, anyOf: ["catalog:write"], path: "/products/new", keywords: ["new product", "yeni ürün", "ürün ekle"] },
  { id: "product.import", label: "products.commands.import", icon: Upload, anyOf: ["catalog:write"], path: "/products/imports/new", keywords: ["import", "csv", "excel", "xml", "içe aktar"] },
  { id: "collection.new", label: "products.commands.newCollection", icon: Layers, anyOf: ["catalog:write"], path: "/products/collections/new", keywords: ["collection", "koleksiyon"] },
  { id: "page.new", label: "storefront.pages.new", icon: FilePlus2, anyOf: ["content:write"], path: "/storefront?new=1", keywords: ["new page", "yeni sayfa", "landing", "sayfa ekle"] },
  { id: "theme.edit", label: "storefront.pages.editTheme", icon: Palette, anyOf: ["storefront:write"], path: "/storefront/editor?panel=theme", keywords: ["theme", "tema", "renk", "font", "logo"] },
  { id: "domain.add", label: "domains.add", icon: Globe, anyOf: ["domains:manage"], path: "/settings/domains?add=1", keywords: ["domain", "alan adı", "dns", "ssl"] },
  { id: "payments.connect", label: "payments.commands.connect", icon: CreditCard, anyOf: ["payments:manage"], path: "/settings/payments", keywords: ["paytr", "iyzico", "ödeme", "payment"] },
  { id: "integration.connect", label: "integrations.commands.connect", icon: PlugZap, anyOf: ["integrations:manage"], path: "/apps", keywords: ["trendyol", "hepsiburada", "stockmount", "dopigo", "entegrasyon", "integration"] },
  { id: "ekosistem.link", label: "ekosistem.commands.link", icon: Link2, anyOf: ["karmatik:manage", "yanit:manage"], path: "/apps/ekosistem", keywords: ["kârmatik", "karmatik", "yanıt", "yanit", "bağla", "link"] },
];
