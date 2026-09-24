import { z } from "zod";
import { defineModule } from "../manifest";

export const catalogModuleSettingsSchema = z
  .object({
    /**
     * public: prices are shown. quote_only: prices are hidden and products invite a quote
     * request (B2B catalogs). hidden: neither prices nor quote requests (showcase catalogs).
     * The storefront applies quote_only and hidden with the Faz 3 catalog work (plan §11:
     * priceVisibility, "Teklif iste", no Offer JSON-LD); until then products render with
     * their prices, so no preset enables them.
     */
    priceVisibility: z.enum(["public", "quote_only", "hidden"]).default("public"),
    /**
     * How a product without its own sales mode is offered: cart (sold online; takes effect
     * while the commerce module is active), quote (request for quotation) or catalog_only.
     */
    defaultSalesMode: z.enum(["cart", "quote", "catalog_only"]).default("cart"),
  })
  .refine((s) => s.defaultSalesMode !== "cart" || s.priceVisibility === "public", {
    error: "errors.site.module.catalog_cart_requires_public_prices",
    path: ["defaultSalesMode"],
  });

export type CatalogModuleSettings = z.infer<typeof catalogModuleSettingsSchema>;

/**
 * Products, collections, stock, price lists and catalog integrations (feeds, marketplaces).
 * A catalog works without commerce: corporate and B2B sites show products and collect quote
 * requests without a cart.
 */
export const catalogModule = defineModule({
  key: "catalog",
  version: "1.0.0",
  label: { tr: "Katalog", en: "Catalog" },
  description: {
    tr: "Ürünler, koleksiyonlar, stok, fiyat listeleri, ürün feed'leri ve pazaryeri entegrasyonları.",
    en: "Products, collections, stock, price lists, product feeds and marketplace integrations.",
  },
  dependsOn: [],
  resources: ["catalog", "inventory", "pricing", "integrations"],
  routes: [
    { id: "catalog.products", path: "/products", match: "prefix", cacheClass: "public", pageClass: "marketing" },
    { id: "catalog.collections", path: "/collections", match: "prefix", cacheClass: "public", pageClass: "marketing" },
  ],
  templates: [],
  settings: catalogModuleSettingsSchema,
  events: [
    "product.created",
    "product.published",
    "product.updated",
    "product.deleted",
    "collection.changed",
    "inventory.changed",
    "import.requested",
    "feed.requested",
  ],
  adminNav: [
    { key: "products", label: { tr: "Ürünler", en: "Products" }, path: "/products", permission: "catalog:read", order: 30 },
    { key: "collections", label: { tr: "Koleksiyonlar", en: "Collections" }, path: "/collections", permission: "catalog:read", order: 31 },
    { key: "inventory", label: { tr: "Stok", en: "Inventory" }, path: "/inventory", permission: "inventory:read", order: 32 },
    { key: "price-lists", label: { tr: "Fiyat listeleri", en: "Price lists" }, path: "/pricing", permission: "pricing:read", order: 33 },
    { key: "integrations", label: { tr: "Entegrasyonlar", en: "Integrations" }, path: "/integrations", permission: "integrations:read", order: 34 },
  ],
});
