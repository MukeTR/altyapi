/** Cart as returned by the Storefront API (amounts are minor-unit strings). */
export interface CartLineView {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string | null;
  handle: string | null;
  sku: string | null;
  imageObjectKey: string | null;
  quantity: number;
  unitPrice: string;
  compareAtUnitPrice: string | null;
  subtotal: string;
  discount: string;
  total: string;
  available: boolean;
  availableQuantity: number | null;
  issues: string[];
}

export interface AddressView {
  firstName: string;
  lastName: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  district?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  countryCode: string;
  phone?: string | null;
  identityNumber?: string | null;
}

export interface CartView {
  id: string;
  status: string;
  currency: string;
  email: string | null;
  phone: string | null;
  acceptsMarketing: boolean;
  itemCount: number;
  lines: CartLineView[];
  discounts: { code: string | null; description: string; amount: string }[];
  couponCodes: string[];
  shipping: { rateId: string; name: string; amount: string; discount: string } | null;
  requiresShipping: boolean;
  shippingAddress: AddressView | null;
  billingAddress: AddressView | null;
  totals: { subtotal: string; discountTotal: string; shippingTotal: string; taxTotal: string; total: string };
  issues: string[];
}

export interface ApiErrorBody {
  error?: { code?: string; message_key?: string; details?: Record<string, unknown> };
}
