import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  LayoutDashboard,
  Megaphone,
  Package,
  Radar,
  Receipt,
  Settings,
  Store,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/translate";
import { hasAnyPermission, type Permission } from "@/lib/permissions";

/**
 * Navigation registry: the admin's information architecture in display order. Sidebar,
 * command palette and go-to shortcuts are all derived from it.
 *
 * An entry is shown only when (a) `ready` is true, meaning its screen exists under
 * app/o/[org]/[store]/(shell)/<path>, and (b) the user holds one of `anyOf` for the current
 * store. Areas whose backend does not exist yet (customers, content, campaigns, analytics,
 * AI actions) have no entry at all. A feature stage that ships a screen sets `ready: true` on
 * its entry; nothing else in the shell needs to change.
 */
export interface NavLeaf {
  id: string;
  label: MessageKey;
  /** Path below the store base, e.g. "/orders"; "" is the store overview. */
  path: string;
  /** Visible when the user holds any of these (empty: everyone with access to the store). */
  anyOf: readonly Permission[];
  /** True once the screen exists. */
  ready: boolean;
  /** Extra search terms for the command palette (both UI languages). */
  keywords?: readonly string[];
}

export interface NavItem extends NavLeaf {
  icon: LucideIcon;
  /** Second key of a "g <key>" go-to shortcut. */
  goKey?: string;
  /** Sub-pages; the group is shown when at least one child is visible. */
  children?: readonly NavLeaf[];
}

const leaf = (id: string, label: MessageKey, path: string, anyOf: readonly Permission[], ready = false, keywords?: string[]): NavLeaf => ({
  id,
  label,
  path,
  anyOf,
  ready,
  ...(keywords ? { keywords } : {}),
});

export const NAV_MAIN: readonly NavItem[] = [
  { id: "overview", label: "nav.overview", icon: LayoutDashboard, path: "", anyOf: ["store:read"], ready: true, goKey: "h", keywords: ["dashboard", "home", "ana sayfa"] },
  { id: "orders", label: "nav.orders", icon: Receipt, path: "/orders", anyOf: ["orders:read"], ready: true, goKey: "o", keywords: ["order", "sipariş"] },
  {
    id: "products",
    label: "nav.products",
    icon: Package,
    path: "/products",
    anyOf: ["catalog:read", "pricing:read"],
    ready: false,
    goKey: "p",
    children: [
      leaf("products.all", "nav.productsAll", "/products", ["catalog:read"], true, ["product", "ürün", "katalog"]),
      leaf("products.collections", "nav.collections", "/products/collections", ["catalog:read"], true, ["collection"]),
      leaf("products.categories", "nav.categories", "/products/categories", ["catalog:read"], true, ["category"]),
      leaf("products.priceLists", "nav.priceLists", "/products/price-lists", ["pricing:read"], true, ["price", "fiyat"]),
      leaf("products.imports", "nav.imports", "/products/imports", ["catalog:write"], true, ["import", "csv", "xml", "excel"]),
    ],
  },
  {
    id: "inventory",
    label: "nav.inventory",
    icon: Warehouse,
    path: "/inventory",
    anyOf: ["inventory:read"],
    ready: false,
    goKey: "i",
    children: [
      leaf("inventory.levels", "nav.inventoryLevels", "/inventory", ["inventory:read"], true, ["stock", "stok"]),
      leaf("inventory.locations", "nav.locations", "/inventory/locations", ["inventory:read"], true, ["warehouse", "depo"]),
    ],
  },
  {
    id: "storefront",
    label: "nav.storefront",
    icon: Store,
    path: "/storefront",
    anyOf: ["storefront:read", "media:read"],
    ready: false,
    goKey: "s",
    children: [
      leaf("storefront.pages", "nav.pages", "/storefront", ["storefront:read"], true, ["page", "sayfa"]),
      leaf("storefront.editor", "nav.editor", "/storefront/editor", ["storefront:read"], true, ["theme", "tema", "editor"]),
      leaf("storefront.menus", "nav.menus", "/storefront/navigation", ["storefront:read"], true, ["menu", "navigation"]),
      leaf("storefront.redirects", "nav.redirects", "/storefront/redirects", ["storefront:read"], true, ["redirect", "301"]),
      leaf("storefront.publications", "nav.publications", "/storefront/publications", ["storefront:read"], true, ["publish", "yayın", "rollback"]),
      leaf("storefront.media", "nav.media", "/storefront/media", ["media:read"], true, ["image", "görsel", "asset"]),
    ],
  },
  {
    id: "marketing",
    label: "nav.marketing",
    icon: Megaphone,
    path: "/marketing",
    anyOf: ["tracking:read"],
    ready: false,
    children: [leaf("marketing.tracking", "nav.tracking", "/marketing/tracking", ["tracking:read"], true, ["pixel", "gtm", "ga4", "consent", "çerez"])],
  },
  {
    id: "karmatik",
    label: "nav.karmatik",
    icon: TrendingUp,
    path: "/karmatik",
    anyOf: ["karmatik:read"],
    ready: false,
    children: [
      leaf("karmatik.overview", "nav.karmatikOverview", "/karmatik", ["karmatik:read"], true, ["kâr", "profit"]),
      leaf("karmatik.profitability", "nav.profitability", "/karmatik/profitability", ["karmatik:read"], true, ["margin", "marj"]),
      leaf("karmatik.suggestions", "nav.suggestions", "/karmatik/suggestions", ["karmatik:read"], true, ["price", "fiyat"]),
      leaf("karmatik.alerts", "nav.alerts", "/karmatik/alerts", ["karmatik:read"], true, ["alert"]),
      leaf("karmatik.competitors", "nav.competitors", "/karmatik/competitors", ["karmatik:read"], true, ["competitor"]),
      leaf("karmatik.settings", "nav.profitGuard", "/karmatik/settings", ["settings:read"], true, ["profit guard"]),
    ],
  },
  {
    id: "yanit",
    label: "nav.yanit",
    icon: Radar,
    path: "/yanit",
    anyOf: ["yanit:read"],
    ready: false,
    children: [
      leaf("yanit.visibility", "nav.visibility", "/yanit", ["yanit:read"], true, ["ai", "visibility"]),
      leaf("yanit.gaps", "nav.gaps", "/yanit/gaps", ["yanit:read"], true, ["gap"]),
      leaf("yanit.opportunities", "nav.opportunities", "/yanit/opportunities", ["yanit:read"], true, ["opportunity"]),
      leaf("yanit.citations", "nav.citations", "/yanit/citations", ["yanit:read"], true, ["citation"]),
    ],
  },
  {
    id: "apps",
    label: "nav.apps",
    icon: Blocks,
    path: "/apps",
    anyOf: ["integrations:read", "karmatik:read", "yanit:read"],
    ready: false,
    children: [
      leaf("apps.connections", "nav.connections", "/apps", ["integrations:read"], true, ["integration", "entegrasyon", "trendyol", "hepsiburada"]),
      leaf("apps.ekosistem", "nav.ekosistem", "/apps/ekosistem", ["karmatik:read", "yanit:read"], true, ["kârmatik", "yanıt", "link"]),
      leaf("apps.orders", "nav.channelOrders", "/apps/orders", ["integrations:read"], true, ["marketplace", "pazaryeri"]),
      leaf("apps.listings", "nav.listings", "/apps/listings", ["integrations:read"], true, ["listing", "sku"]),
      leaf("apps.discrepancies", "nav.discrepancies", "/apps/discrepancies", ["integrations:read"], true, ["discrepancy"]),
      leaf("apps.ownership", "nav.ownership", "/apps/ownership", ["integrations:read"], true, ["ownership"]),
    ],
  },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_BOTTOM: readonly NavItem[] = [
  {
    id: "settings",
    label: "nav.settings",
    icon: Settings,
    path: "/settings",
    anyOf: [],
    ready: false,
    children: [
      leaf("settings.general", "nav.settingsGeneral", "/settings", ["store:read"], true, ["general", "language", "dil", "currency"]),
      leaf("settings.domains", "nav.domains", "/settings/domains", ["domains:read"], true, ["domain", "dns", "ssl"]),
      leaf("settings.payments", "nav.payments", "/settings/payments", ["payments:read"], true, ["payment", "paytr", "iyzico"]),
      leaf("settings.shipping", "nav.shipping", "/settings/shipping", ["settings:read"], false, ["shipping", "kargo"]),
      leaf("settings.taxes", "nav.taxes", "/settings/taxes", ["settings:read"], false, ["tax", "kdv", "vergi"]),
      leaf("settings.team", "nav.team", "/settings/team", ["members:read"], true, ["team", "member", "role", "üye"]),
      leaf("settings.brand", "nav.brand", "/settings/brand", ["settings:read"], true, ["brand", "marka"]),
    ],
  },
];

/** A nav entry resolved for the current user: only visible children, hrefs made absolute. */
export interface VisibleNavItem {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  href: string;
  goKey?: string;
  keywords: readonly string[];
  children: { id: string; label: MessageKey; href: string; keywords: readonly string[] }[];
}

function visibleLeaf(item: NavLeaf, permissions: readonly string[]): boolean {
  return item.ready && hasAnyPermission(permissions, item.anyOf);
}

export function resolveNav(items: readonly NavItem[], permissions: readonly string[], basePath: string): VisibleNavItem[] {
  const out: VisibleNavItem[] = [];
  for (const item of items) {
    if (!hasAnyPermission(permissions, item.anyOf)) continue;
    const children = (item.children ?? [])
      .filter((c) => visibleLeaf(c, permissions))
      .map((c) => ({ id: c.id, label: c.label, href: `${basePath}${c.path}`, keywords: c.keywords ?? [] }));
    if (item.children) {
      const first = children[0];
      if (!first) continue;
      out.push({ id: item.id, label: item.label, icon: item.icon, href: first.href, ...(item.goKey ? { goKey: item.goKey } : {}), keywords: item.keywords ?? [], children });
    } else if (item.ready) {
      out.push({ id: item.id, label: item.label, icon: item.icon, href: `${basePath}${item.path}`, ...(item.goKey ? { goKey: item.goKey } : {}), keywords: item.keywords ?? [], children: [] });
    }
  }
  return out;
}

/**
 * The href of the nav entry that owns `pathname`: the longest visible href that equals it or is
 * a path prefix of it, so "/products/collections/…" selects Collections rather than All products.
 */
export function activeHref(pathname: string, items: readonly VisibleNavItem[], basePath: string): string | null {
  let best: string | null = null;
  const consider = (href: string) => {
    const matches = href === basePath ? pathname === basePath : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (!best || href.length > best.length)) best = href;
  };
  for (const item of items) {
    if (item.children.length === 0) consider(item.href);
    for (const child of item.children) consider(child.href);
  }
  return best;
}
