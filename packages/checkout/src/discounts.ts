import type { Transaction } from "@altyapi/database";

/** What the campaign engine sees for one cart line. */
export interface DiscountLineInput {
  lineId: string;
  productId: string;
  variantId: string;
  collectionIds: string[];
  tags: string[];
  quantity: number;
  unitPrice: bigint;
  lineSubtotal: bigint;
  /** Unit cost when known (for profit guard). */
  unitCost: bigint | null;
}

export interface DiscountInput {
  storeId: string;
  organizationId: string;
  currency: string;
  channelId: string | null;
  customer: { id: string | null; email: string | null; groupIds: string[]; isFirstOrder: boolean };
  lines: DiscountLineInput[];
  subtotal: bigint;
  shipping: { rateId: string; amount: bigint } | null;
  couponCodes: string[];
  at: Date;
}

export interface AppliedDiscount {
  campaignId: string;
  code: string | null;
  description: string;
  /** Per-line amounts (order-level discounts are pre-allocated by the engine). */
  lineAmounts: { lineId: string; amount: bigint }[];
  shippingAmount: bigint;
}

export interface DiscountResult {
  discounts: AppliedDiscount[];
  appliedCodes: string[];
  rejectedCodes: { code: string; reason: string }[];
  /** Free items added by buy-X-get-Y campaigns are expressed as 100% line discounts. */
  warnings: string[];
}

/** The campaign engine implements this; checkout only consumes the result. */
export interface DiscountEngine {
  evaluate(tx: Transaction, input: DiscountInput): Promise<DiscountResult>;
}

/**
 * Engine used when no campaign engine is configured: applies nothing and reports every coupon
 * as unknown (which is accurate: without campaigns no code can be valid).
 */
export const noDiscountEngine: DiscountEngine = {
  async evaluate(_tx, input) {
    return { discounts: [], appliedCodes: [], rejectedCodes: input.couponCodes.map((code) => ({ code, reason: "not_found" })), warnings: [] };
  },
};
