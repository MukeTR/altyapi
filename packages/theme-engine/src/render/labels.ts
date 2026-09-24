import { uiLocaleChain, type UiLocaleCode } from "@altyapi/commerce-core";

/**
 * Interface labels the route resolver writes into page titles and breadcrumbs (and so into
 * <title> and BreadcrumbList JSON-LD). They follow the storefront UI languages and fallback
 * (English, then Turkish), so a title always matches the heading the storefront renders for
 * the same page; a page is never labelled in Turkish unless it is Turkish or no other
 * interface text exists.
 */
const LABELS: Record<UiLocaleCode, { home: string; allProducts: string }> = {
  tr: { home: "Ana sayfa", allProducts: "Tüm ürünler" },
  en: { home: "Home", allProducts: "All products" },
  de: { home: "Startseite", allProducts: "Alle Produkte" },
  ar: { home: "الرئيسية", allProducts: "جميع المنتجات" },
  ru: { home: "Главная", allProducts: "Все товары" },
  fr: { home: "Accueil", allProducts: "Tous les produits" },
};

export type RouteLabel = keyof (typeof LABELS)["tr"];

export function routeLabel(locale: string, key: RouteLabel): string {
  return LABELS[uiLocaleChain(locale)[0]!][key];
}
