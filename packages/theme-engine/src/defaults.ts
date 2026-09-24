import type { NavigationItem, PageContent } from "@altyapi/database";
import { newId } from "@altyapi/commerce-core";
import type { PageTypeName } from "./sections/definitions";
import { validatePageContent, type PageContentInput } from "./validation";

function build(input: PageContentInput, placement: PageTypeName | "global"): PageContent {
  const result = validatePageContent(input, placement);
  if (!result.ok) throw new Error(`Invalid default content for ${placement}: ${JSON.stringify(result.issues)}`);
  return result.content;
}

export function defaultGlobalSections(): PageContent {
  return build(
    {
      sections: [
        {
          type: "announcement-bar",
          props: {},
          blocks: [{ type: "message", props: { text: { tr: "Tüm siparişlerde hızlı kargo", en: "Fast shipping on all orders" } } }],
          disabled: true,
        },
        { type: "header", props: {} },
        {
          type: "footer",
          props: { text: { tr: "<p>Güvenli alışveriş.</p>", en: "<p>Secure shopping.</p>" } },
        },
      ],
    },
    "global",
  );
}

export interface DefaultPage {
  type: PageTypeName;
  handle: string;
  title: Record<string, string>;
  content: PageContent;
}

export function defaultPages(storeName: string): DefaultPage[] {
  return [
    {
      type: "home",
      handle: "index",
      title: { tr: storeName, en: storeName },
      content: build(
        {
          sections: [
            {
              type: "hero",
              props: {
                heading: { tr: `${storeName} mağazasına hoş geldiniz`, en: `Welcome to ${storeName}` },
                subheading: { tr: "Yeni sezon ürünlerini keşfedin.", en: "Discover the new season." },
                primaryCta: { label: { tr: "Alışverişe başla", en: "Shop now" }, href: "/collections/all" },
              },
            },
            { type: "product-grid", props: { heading: { tr: "Yeni ürünler", en: "New arrivals" }, source: "newest" } },
            {
              type: "newsletter",
              props: {
                heading: { tr: "Kampanyalardan haberdar olun", en: "Stay in the loop" },
                buttonLabel: { tr: "Abone ol", en: "Subscribe" },
                placeholder: { tr: "E-posta adresiniz", en: "Your e-mail" },
                successMessage: { tr: "Teşekkürler!", en: "Thank you!" },
              },
            },
          ],
        },
        "home",
      ),
    },
    { type: "product", handle: "default", title: { tr: "Ürün", en: "Product" }, content: build({ sections: [{ type: "product-main", props: {} }] }, "product") },
    {
      type: "collection",
      handle: "default",
      title: { tr: "Koleksiyon", en: "Collection" },
      content: build({ sections: [{ type: "collection-main", props: {} }] }, "collection"),
    },
    { type: "cart", handle: "default", title: { tr: "Sepet", en: "Cart" }, content: build({ sections: [{ type: "cart-main", props: {} }] }, "cart") },
    { type: "search", handle: "default", title: { tr: "Arama", en: "Search" }, content: build({ sections: [{ type: "search-main", props: {} }] }, "search") },
    {
      type: "not_found",
      handle: "default",
      title: { tr: "Sayfa bulunamadı", en: "Page not found" },
      content: build(
        {
          sections: [
            {
              type: "not-found-main",
              props: {
                heading: { tr: "Aradığınız sayfa bulunamadı", en: "We couldn't find that page" },
                body: { tr: "Bağlantı değişmiş ya da kaldırılmış olabilir.", en: "The link may have changed or been removed." },
              },
            },
          ],
        },
        "not_found",
      ),
    },
  ];
}

export function defaultNavigations(): { handle: string; name: string; items: NavigationItem[] }[] {
  return [
    {
      handle: "main",
      name: "Ana menü",
      items: [
        { id: newId(), label: { tr: "Ana sayfa", en: "Home" }, link: { type: "home" } },
        { id: newId(), label: { tr: "Tüm ürünler", en: "All products" }, link: { type: "url", url: "/collections/all" } },
      ],
    },
    {
      handle: "footer",
      name: "Alt menü",
      items: [{ id: newId(), label: { tr: "Arama", en: "Search" }, link: { type: "search" } }],
    },
  ];
}
