import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  minorToDecimal2,
  decimalToMinor,
  ProviderRequestError,
  type CallbackInput,
  type CancelPaymentInput,
  type CreatePaymentInput,
  type GetPaymentInput,
  type PaymentMode,
  type PaymentProvider,
  type PaymentResult,
  type PaymentSession,
  type PaymentStatus,
  type RefundPaymentInput,
  type VerifiedPaymentEvent,
} from "@altyapi/payments";

/** Merchant credentials from the PayTR panel (Destek & Kurulum → Entegrasyon Bilgileri). */
export const paytrCredentialsSchema = z.object({
  merchantId: z.string().regex(/^\d{1,20}$/, "errors.paytr.merchant_id"),
  merchantKey: z.string().min(8).max(64),
  merchantSalt: z.string().min(8).max(64),
});

export type PaytrCredentials = z.infer<typeof paytrCredentialsSchema>;

const BASE_URL = "https://www.paytr.com";
const CURRENCY: Record<string, string> = { TRY: "TL", USD: "USD", EUR: "EUR", GBP: "GBP", RUB: "RUB" };

function sign(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/**
 * PayTR iFrame API adapter.
 * - get-token: server-side token with HMAC over merchant/order/basket fields
 * - Bildirim URL: POST notification verified with HMAC(merchant_oid + salt + status + total_amount)
 * - durum-sorgu: status inquiry for reconciliation
 * - iade: full/partial refunds (PayTR has no separate void; cancel = full refund)
 */
export class PaytrProvider implements PaymentProvider {
  readonly name = "paytr" as const;

  constructor(
    private readonly creds: PaytrCredentials,
    private readonly mode: PaymentMode,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, fields: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderRequestError("paytr", `http_${res.status}`, text.slice(0, 300));
    }
  }

  async createSession(input: CreatePaymentInput): Promise<PaymentSession> {
    const currency = CURRENCY[input.currency];
    if (!currency) throw new ProviderRequestError("paytr", "unsupported_currency", input.currency);
    if (!input.buyer.phone) throw new ProviderRequestError("paytr", "phone_required", "PayTR requires the buyer phone number");

    const basket = input.items.map((i) => [i.name.slice(0, 200), minorToDecimal2(i.unitPrice), i.quantity]);
    const userBasket = Buffer.from(JSON.stringify(basket), "utf8").toString("base64");
    const paymentAmount = input.amount.toString(); // kuruş
    const noInstallment = input.maxInstallments <= 1 ? "1" : "0";
    const maxInstallment = input.maxInstallments <= 1 ? "0" : String(Math.min(12, input.maxInstallments));
    const testMode = this.mode === "test" ? "1" : "0";
    const hashStr =
      this.creds.merchantId + input.buyer.ip + input.reference + input.buyer.email + paymentAmount + userBasket + noInstallment + maxInstallment + currency + testMode;
    const token = sign(this.creds.merchantKey, hashStr + this.creds.merchantSalt);

    const address = input.billingAddress;
    const res = await this.post<{ status: string; token?: string; reason?: string }>("/odeme/api/get-token", {
      merchant_id: this.creds.merchantId,
      user_ip: input.buyer.ip,
      merchant_oid: input.reference,
      email: input.buyer.email,
      payment_amount: paymentAmount,
      paytr_token: token,
      user_basket: userBasket,
      debug_on: testMode,
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: `${input.buyer.firstName} ${input.buyer.lastName}`.trim().slice(0, 60),
      user_address: `${address.line} ${address.city}`.slice(0, 400),
      user_phone: input.buyer.phone.slice(0, 20),
      merchant_ok_url: input.urls.success,
      merchant_fail_url: input.urls.failure,
      timeout_limit: String(input.timeoutMinutes),
      currency,
      test_mode: testMode,
      lang: input.locale === "tr" ? "tr" : "en",
    });
    if (res.status !== "success" || !res.token) throw new ProviderRequestError("paytr", "get_token_failed", res.reason ?? "unknown");
    return {
      kind: "iframe",
      token: res.token,
      url: `${BASE_URL}/odeme/guvenli/${res.token}`,
      html: null,
      expiresAt: new Date(Date.now() + input.timeoutMinutes * 60_000),
    };
  }

  async verifyCallback(input: CallbackInput): Promise<VerifiedPaymentEvent> {
    const b = input.body;
    const merchantOid = str(b.merchant_oid);
    const status = str(b.status);
    const totalAmount = str(b.total_amount);
    const expected = sign(this.creds.merchantKey, merchantOid + this.creds.merchantSalt + status + totalAmount);
    const verified = Boolean(merchantOid) && safeEqual(expected, str(b.hash));
    const paid = status === "success";
    return {
      verified,
      // PayTR repeats the same notification until it receives "OK"; these fields identify it.
      providerEventId: `${merchantOid}:${status}:${totalAmount}`,
      type: "payment_notification",
      reference: merchantOid || null,
      outcome: !verified ? "unknown" : paid ? "paid" : "failed",
      amountPaid: paid && /^\d+$/.test(totalAmount) ? BigInt(totalAmount) : null,
      providerPaymentId: null,
      transactions: paid && /^\d+$/.test(totalAmount) ? [{ id: merchantOid, amount: BigInt(totalAmount) }] : [],
      failureCode: paid ? null : str(b.failed_reason_code) || null,
      failureMessage: paid ? null : str(b.failed_reason_msg) || null,
      // Only acknowledge verified notifications; unverified ones get an error so they are visible in PayTR.
      ack: verified ? { status: 200, contentType: "text/plain", body: "OK" } : { status: 400, contentType: "text/plain", body: "INVALID_HASH" },
      evidence: {
        merchant_oid: merchantOid,
        status,
        total_amount: totalAmount,
        payment_amount: str(b.payment_amount),
        payment_type: str(b.payment_type),
        currency: str(b.currency),
        test_mode: str(b.test_mode),
        installment_count: str(b.installment_count),
        failed_reason_code: str(b.failed_reason_code),
        failed_reason_msg: str(b.failed_reason_msg),
      },
    };
  }

  async getPayment(input: GetPaymentInput): Promise<PaymentStatus> {
    const token = sign(this.creds.merchantKey, this.creds.merchantId + input.reference + this.creds.merchantSalt);
    const res = await this.post<{
      status: string;
      payment_amount?: string;
      payment_total?: string;
      returns?: { return_amount?: string }[] | string;
      err_no?: string;
      err_msg?: string;
    }>("/odeme/durum-sorgu", { merchant_id: this.creds.merchantId, merchant_oid: input.reference, paytr_token: token });
    if (res.status !== "success") {
      return { outcome: "not_found", amountPaid: null, refundedAmount: null, providerPaymentId: null, transactions: [], raw: res.err_msg ?? null };
    }
    const returns = Array.isArray(res.returns) ? res.returns : [];
    const refunded = returns.reduce((s, r) => s + (r.return_amount ? decimalToMinor(r.return_amount) : 0n), 0n);
    const paid = res.payment_total ?? res.payment_amount;
    return {
      outcome: "paid",
      amountPaid: paid ? decimalToMinor(paid) : null,
      refundedAmount: refunded,
      providerPaymentId: null,
      transactions: [],
      raw: "success",
    };
  }

  async refund(input: RefundPaymentInput): Promise<PaymentResult> {
    const returnAmount = minorToDecimal2(input.amount);
    const token = sign(this.creds.merchantKey, this.creds.merchantId + input.reference + returnAmount + this.creds.merchantSalt);
    const res = await this.post<{ status: string; err_no?: string; err_msg?: string; reference_no?: string }>("/odeme/iade", {
      merchant_id: this.creds.merchantId,
      merchant_oid: input.reference,
      return_amount: returnAmount,
      paytr_token: token,
      reference_no: input.refundId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64),
    });
    return res.status === "success"
      ? { ok: true, providerRefundIds: [res.reference_no ?? input.refundId], errorCode: null, errorMessage: null }
      : { ok: false, providerRefundIds: [], errorCode: res.err_no ?? "refund_failed", errorMessage: res.err_msg ?? null };
  }

  /** PayTR has no void endpoint; cancelling a paid order is a full refund. */
  async cancel(input: CancelPaymentInput): Promise<PaymentResult> {
    return this.refund({ ...input, refundId: `cancel${input.reference}`, transactions: [] });
  }

  async verifyCredentials(): Promise<{ ok: boolean; message: string | null }> {
    // Status inquiry for an order id that cannot exist: valid credentials yield "not found",
    // invalid ones fail token validation.
    const probe = await this.getPayment({ reference: `probe${Date.now()}`, providerPaymentId: null, token: null });
    const msg = (probe.raw ?? "").toLowerCase();
    const authError = /token|hash|merchant|yetki|gecersiz|geçersiz|invalid/.test(msg) && !/bulunamad|not found/.test(msg);
    return authError ? { ok: false, message: probe.raw } : { ok: true, message: null };
  }
}
