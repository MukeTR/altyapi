/**
 * Response shapes of the commerce endpoints (orders, catalog, pricing, inventory, imports,
 * assets). Money is always a string of integer minor units; dates are ISO strings. The API adds
 * fields without a version bump and many GET routes return raw rows, so these types list only
 * what the admin reads and are never assumed to be exhaustive.
 */

export type LocalizedText = Record<string, string>;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = ["draft", "awaiting_payment", "confirmed", "processing", "partially_fulfilled", "fulfilled", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "partially_refunded", "refunded", "failed", "voided"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface OrderListItem {
  id: string;
  number: string;
  email: string | null;
  status: OrderStatus | (string & {});
  paymentStatus: PaymentStatus | (string & {});
  fulfillmentStatus: string;
  currency: string;
  total: string;
  itemCount: number;
  tags: string[];
  createdAt: string;
}

export interface OrderRow {
  id: string;
  number: string;
  email: string | null;
  phone: string | null;
  status: OrderStatus | (string & {});
  paymentStatus: PaymentStatus | (string & {});
  fulfillmentStatus: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  total: string;
  refundedTotal: string;
  locale: string | null;
  note: string | null;
  tags: string[];
  couponCodes: string[] | null;
  shippingMethod: { rateId?: string; name?: string; carrierCode?: string | null; amount?: string } | null;
  source: string | null;
  cancelReason: string | null;
  placedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface OrderLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageObjectKey: string | null;
  quantity: number;
  unitPrice: string;
  compareAtUnitPrice: string | null;
  unitCost: string | null;
  discountAmount: string;
  taxRateBps: number;
  taxAmount: string;
  taxIncluded: boolean;
  total: string;
  requiresShipping: boolean;
  fulfilledQuantity: number;
  returnedQuantity: number;
  refundedQuantity: number;
}

export interface OrderAddress {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  line1?: string | null;
  line2?: string | null;
  district?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  phone?: string | null;
  identityNumber?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
}

export interface OrderAdjustment {
  id: string;
  kind?: string;
  type?: string;
  code?: string | null;
  label?: string | null;
  description?: string | null;
  amount: string;
}

export interface OrderHistoryEntry {
  id?: string;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  principalType: string | null;
  principalId: string | null;
  createdAt: string;
}

export interface OrderPayment {
  id: string;
  provider: string;
  mode: string;
  status: string;
  amount: string;
  refundedAmount: string;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Fulfillment {
  id: string;
  status: string;
  carrierCode: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  locationId: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  lines: { orderLineId: string; quantity: number }[];
}

export interface Refund {
  id: string;
  amount: string;
  shippingAmount: string;
  currency: string;
  status: string;
  reason: string | null;
  lines: { orderLineId: string; quantity: number; amount: string }[];
  providerRefundId: string | null;
  failureReason: string | null;
  processedAt?: string | null;
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  status: string;
  reason: string | null;
  customerNote: string | null;
  createdAt: string;
  lines: { id?: string; orderLineId: string; quantity: number; reason?: string | null; restock?: boolean }[];
}

export interface OrderDetail {
  order: OrderRow;
  lines: OrderLine[];
  shippingAddress: OrderAddress | null;
  billingAddress: OrderAddress | null;
  adjustments: OrderAdjustment[];
  history: OrderHistoryEntry[];
  payments: OrderPayment[];
  fulfillments: Fulfillment[];
  refunds: Refund[];
  returns: ReturnRequest[];
}

export interface Carrier {
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type ProductStatus = "draft" | "active" | "archived";

export interface ProductListItem {
  id: string;
  title: string;
  handle: string;
  status: ProductStatus | (string & {});
  variantCount: number;
  skus: string[];
  totalAvailable: number;
  priceMin: string | null;
  priceMax: string | null;
  currency: string;
  imageObjectKey: string | null;
  updatedAt: string;
}

export interface ProductTranslation {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ProductOptionValue {
  id: string;
  value: LocalizedText;
  swatchColor: string | null;
  swatchAssetId: string | null;
}

export interface ProductOption {
  id: string;
  name: LocalizedText;
  values: ProductOptionValue[];
}

export interface StockByLocation {
  inventoryItemId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface ProductVariant {
  id: string;
  sku: string | null;
  barcode: string | null;
  optionValueIds: string[];
  weightGrams: number | null;
  requiresShipping: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  taxClassId: string | null;
  digitalAssetId: string | null;
  externalRef: string | null;
  price: { amount: string; compareAtAmount: string | null; currency: string } | null;
  cost: string | null;
  inventory: { onHand: number; reserved: number; available: number; byLocation: StockByLocation[] } | null;
}

export interface ProductMedia {
  id: string;
  assetId: string;
  objectKey: string;
  kind: string;
  width: number | null;
  height: number | null;
  alt: LocalizedText;
  variantIds: string[];
}

export interface ProductAttribute {
  key: string;
  label: LocalizedText;
  value: LocalizedText;
}

export interface ProductDetail {
  id: string;
  status: ProductStatus;
  kind: "physical" | "digital";
  productType: string | null;
  vendor: { id: string; name: string } | null;
  categoryId: string | null;
  taxClassId: string | null;
  weightGrams: number | null;
  dimensionsMm: { length: number; width: number; height: number } | null;
  attributes: ProductAttribute[];
  publishAt: string | null;
  publishedAt: string | null;
  externalRef: string | null;
  translations: Record<string, ProductTranslation>;
  options: ProductOption[];
  variants: ProductVariant[];
  media: ProductMedia[];
  tags: string[];
  collectionIds: string[];
  channelListings: { channelId: string; isVisible: boolean; availableForPurchase: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionListItem {
  id: string;
  type: "manual" | "automated";
  title: string;
  handle: string;
  isPublished: boolean;
  productCount: number;
  updatedAt: string;
}

export const COLLECTION_SORT_ORDERS = ["manual", "best_selling", "newest", "price_asc", "price_desc", "title_asc", "title_desc"] as const;
export type CollectionSortOrder = (typeof COLLECTION_SORT_ORDERS)[number];

export const RULE_FIELDS = ["tag", "vendor", "category", "product_type", "title", "price", "compare_at_price", "inventory", "attribute", "created_at"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = ["equals", "not_equals", "contains", "not_contains", "starts_with", "greater_than", "less_than", "in"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface CollectionRule {
  field: RuleField;
  operator: RuleOperator;
  attributeKey?: string | null;
  value: string;
}

export interface CollectionDetail {
  id: string;
  type: "manual" | "automated";
  sortOrder: CollectionSortOrder;
  matchAll: boolean;
  imageAssetId: string | null;
  isPublished: boolean;
  translations: Record<string, { title: string; handle: string; descriptionHtml: string; seoTitle: string | null; seoDescription: string | null }>;
  rules: CollectionRule[];
  productCount: number;
  updatedAt: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: LocalizedText;
  handle: string;
  position: number;
  googleCategoryId: number | null;
}

export interface TaxClass {
  id: string;
  code: string;
  name: string;
  rateBps: number;
  pricesIncludeTax: boolean;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export type PriceListKind = "base" | "sale" | "customer_group" | "channel" | "scheduled";

export interface PriceList {
  id: string;
  name: string;
  kind: PriceListKind;
  currency: string;
  priority: number;
  isActive: boolean;
  channelIds: string[];
  customerGroupIds: string[];
  schedule: { startsAt: string; endsAt: string | null }[];
  createdAt: string;
}

export interface ResolvedPrice {
  variantId: string;
  currency: string;
  price: { amount: string; compareAtAmount: string | null; priceListId: string; priceListKind: PriceListKind; minQuantity: number } | null;
  cost: string | null;
  marginBps: number | null;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface Location {
  id: string;
  code: string;
  name: string;
  address: Record<string, string> | null;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
  priority: number;
}

export interface InventoryLevel {
  variantId: string;
  inventoryItemId: string;
  tracked: boolean;
  allowBackorder: boolean;
  onHand: number;
  reserved: number;
  available: number;
  byLocation: StockByLocation[];
}

// ---------------------------------------------------------------------------
// Imports (assets: lib/media/types.ts)
// ---------------------------------------------------------------------------

export const IMPORT_TERMINAL = ["completed", "completed_with_errors", "failed", "cancelled"] as const;

export interface ImportOptions {
  xmlItemPath?: string;
  xmlVariantPath?: string;
  csvDelimiter?: string;
  locale?: string;
  currency?: string;
  matchBy?: "sku" | "external_ref" | "handle";
  groupBy?: "handle" | "external_ref" | "none";
  updateExisting?: boolean;
  publishImported?: boolean;
}

export interface ImportPreviewGroup {
  rows: number[];
  title: string | null;
  handle: string | null;
  variants: { sku: string | null; optionValues: string[]; price: string; stock: number | null }[];
  images: number;
  errors: unknown[];
}

export interface ImportJob {
  id: string;
  assetId: string;
  format: string;
  status: string;
  mapping: Record<string, string> | null;
  options: ImportOptions | null;
  detectedColumns: string[] | null;
  sampleRows: Record<string, string>[] | null;
  preview: ImportPreviewGroup[] | null;
  totalRows: number | null;
  processedRows: number | null;
  createdCount: number | null;
  updatedCount: number | null;
  failedCount: number | null;
  errorReportAssetId: string | null;
  failureReason: string | null;
  profileId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  errorsPreview?: { rowNumber: number; errors: unknown }[];
}

export interface ImportProfile {
  id: string;
  name: string;
  format: string;
  mapping: Record<string, string>;
  options: ImportOptions;
}
