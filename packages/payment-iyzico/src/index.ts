import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  decimalToMinor,
  minorToDecimal2,
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
  type ProviderTransaction,
  type RefundPaymentInput,
  type VerifiedPaymentEvent,
} from "@altyapi/payments";

export const iyzicoCredentialsSchema = z.object({
  apiKey: z.string().min(8).max(128),
  secretKey: z.string().min(8).max(128),
});

export type IyzicoCredentials = z.infer<typeof iyzicoCredentialsSchema>;

const BASE_URL: Record<PaymentMode, string> = { test: "https://sandbox-api.iyzipay.com", live: "https://api.iyzipay.com" };

/**
 * iyzico does not issue checkout without a buyer identity number; for shoppers who do not
 * provide a TCKN the documented placeholder is used.
 */
export const IDENTITY_PLACEHOLDER = "11111111111";

interface IyzicoResponse {
  status: "success" | "failure";
  errorCode?: string;
  errorMessage?: string;
  conversationId?: string;
  [k: string]: unknown;
}

interface RetrieveResponse extends IyzicoResponse {
  token?: string;
  paymentStatus?: string;
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  fraudStatus?: number;
  signature?: string;
  itemTransactions?: { itemId: string; paymentTransactionId: string; price: number; paidPrice: number; transactionStatus?: number }[];
}

function hmacHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

function gsm(phone: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+9${digits}`;
  if (digits.length === 10) return `+90${digits}`;
  return `+${digits}`;
}

/** iyzico renders amounts without trailing zeros in signatures ("10.50" → "10.5", "10.00" → "10"). */
function sigNumber(raw: string): string {
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed;
}

/**
 * iyzico Checkout Form adapter (IYZWSv2 authentication).
 * The authoritative payment result always comes from the server-to-server retrieve call;
 * browser callbacks and webhooks only trigger it.
 */
export class IyzicoProvider implements PaymentProvider {
  readonly name = "iyzico" as const;
  private readonly base: string;

  constructor(
    private readonly creds: IyzicoCredentials,
    private readonly mode: PaymentMode,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = BASE_URL[mode];
  }

  /** Returns the parsed body and the raw text (raw keeps number formatting for signatures). */
  private async request<T extends IyzicoResponse>(path: string, body: Record<string, unknown>): Promise<{ data: T; raw: string }> {
    const json = JSON.stringify(body);
    const randomKey = `${Date.now()}${randomBytes(8).toString("hex")}`;
    const signature = hmacHex(this.creds.secretKey, randomKey + path + json);
    const auth = Buffer.from(`apiKey:${this.creds.apiKey}&randomKey:${randomKey}&signature:${signature}`, "utf8").toString("base64");
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": randomKey },
      body: json,
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await res.text();
    try {
      return { data: JSON.parse(raw) as T, raw };
    } catch {
      throw new ProviderRequestError("iyzico", `http_${res.status}`, raw.slice(0, 300));
    }
  }

  async createSession(input: CreatePaymentInput): Promise<PaymentSession> {
    // iyzico rejects zero-priced basket items and requires sum(items) == price.
    const items = input.items
      .map((i) => ({ i, total: i.unitPrice * BigInt(i.quantity) }))
      .filter((x) => x.total > 0n)
      .map(({ i, total }) => ({
        id: i.id,
        name: i.name.slice(0, 200),
        category1: i.category.slice(0, 100) || "Genel",
        itemType: i.kind === "digital" ? "VIRTUAL" : "PHYSICAL",
        price: minorToDecimal2(total),
      }));
    const sum = input.items.reduce((s, i) => s + i.unitPrice * BigInt(i.quantity), 0n);
    if (sum !== input.amount) throw new ProviderRequestError("iyzico", "basket_mismatch", "Basket total differs from payment amount");
    const installments = [1, 2, 3, 6, 9, 12].filter((n) => n <= Math.max(1, input.maxInstallments));
    const addr = (a: NonNullable<CreatePaymentInput["shippingAddress"]>) => ({
      contactName: a.contactName.slice(0, 100),
      city: a.city,
      country: a.country,
      address: a.line.slice(0, 500),
      ...(a.postalCode ? { zipCode: a.postalCode } : {}),
    });
    const body = {
      locale: input.locale === "tr" ? "tr" : "en",
      conversationId: input.reference,
      price: minorToDecimal2(input.amount),
      paidPrice: minorToDecimal2(input.amount),
      currency: input.currency === "TRY" ? "TRY" : input.currency,
      basketId: input.orderNumber,
      paymentGroup: "PRODUCT",
      callbackUrl: input.urls.callback,
      enabledInstallments: installments,
      buyer: {
        id: input.buyer.id,
        name: input.buyer.firstName.slice(0, 50) || "-",
        surname: input.buyer.lastName.slice(0, 50) || "-",
        ...(gsm(input.buyer.phone) ? { gsmNumber: gsm(input.buyer.phone) } : {}),
        email: input.buyer.email,
        identityNumber: input.buyer.identityNumber ?? IDENTITY_PLACEHOLDER,
        ...(input.buyer.registeredAt ? { registrationDate: input.buyer.registeredAt.toISOString().slice(0, 19).replace("T", " ") } : {}),
        registrationAddress: input.billingAddress.line.slice(0, 500),
        ip: input.buyer.ip,
        city: input.billingAddress.city,
        country: input.billingAddress.country,
        ...(input.billingAddress.postalCode ? { zipCode: input.billingAddress.postalCode } : {}),
      },
      ...(input.shippingAddress ? { shippingAddress: addr(input.shippingAddress) } : {}),
      billingAddress: addr(input.billingAddress),
      basketItems: items,
    };
    const { data } = await this.request<IyzicoResponse & { token?: string; checkoutFormContent?: string; tokenExpireTime?: number; paymentPageUrl?: string }>(
      "/payment/iyzipos/checkoutform/initialize/auth/ecom",
      body,
    );
    if (data.status !== "success" || !data.token) {
      throw new ProviderRequestError("iyzico", data.errorCode ?? "initialize_failed", data.errorMessage ?? "unknown");
    }
    return {
      kind: "script",
      token: data.token,
      url: data.paymentPageUrl ?? null,
      html: data.checkoutFormContent ?? null,
      expiresAt: new Date(Date.now() + (data.tokenExpireTime ?? 1800) * 1000),
    };
  }

  private async retrieve(token: string, conversationId: string) {
    const { data, raw } = await this.request<RetrieveResponse>("/payment/iyzipos/checkoutform/auth/ecom/detail", {
      locale: "tr",
      conversationId,
      token,
    });
    return { data, raw };
  }

  /** Verifies the v2 response signature using the raw number formatting from the response. */
  private responseSignatureValid(data: RetrieveResponse, raw: string): boolean | null {
    if (!data.signature) return null;
    const rawNum = (field: string) => sigNumber(new RegExp(`"${field}"\\s*:\\s*([0-9.]+)`).exec(raw)?.[1] ?? String(data[field] ?? ""));
    const parts = [data.paymentStatus, data.paymentId, data.currency, data.basketId, data.conversationId, rawNum("paidPrice"), rawNum("price"), data.token].map((p) => String(p ?? ""));
    return safeEqual(hmacHex(this.creds.secretKey, parts.join(":")), data.signature);
  }

  private toTransactions(data: RetrieveResponse): ProviderTransaction[] {
    return (data.itemTransactions ?? []).map((t) => ({ id: t.paymentTransactionId, itemId: t.itemId, amount: decimalToMinor(t.paidPrice) }));
  }

  /**
   * Handles both the browser callback (form POST with "token") and merchant webhooks
   * (X-IYZ-SIGNATURE-V3). In both cases the result comes from the retrieve call.
   */
  async verifyCallback(input: CallbackInput): Promise<VerifiedPaymentEvent> {
    const b = input.body;
    const isWebhook = typeof b.iyziEventType === "string";
    let webhookValid = true;
    if (isWebhook) {
      const header = input.headers["x-iyz-signature-v3"];
      const sig = Array.isArray(header) ? header[0] : header;
      const expected = hmacHex(
        this.creds.secretKey,
        this.creds.secretKey + String(b.iyziEventType ?? "") + String(b.iyziPaymentId ?? "") + String(b.token ?? "") + String(b.paymentConversationId ?? "") + String(b.status ?? ""),
      );
      webhookValid = typeof sig === "string" && safeEqual(expected, sig);
    }
    const token = String(b.token ?? "");
    const conversationId = String(b.paymentConversationId ?? input.reference ?? "");
    const unverified = (reason: string): VerifiedPaymentEvent => ({
      verified: false,
      providerEventId: `${isWebhook ? "webhook" : "callback"}:${token}:${reason}`,
      type: isWebhook ? "webhook" : "callback",
      reference: conversationId || null,
      outcome: "unknown",
      amountPaid: null,
      providerPaymentId: null,
      transactions: [],
      failureCode: reason,
      failureMessage: null,
      ack: { status: 400, contentType: "application/json", body: JSON.stringify({ status: "rejected" }) },
      evidence: { token: token.slice(0, 12), reason },
    });
    if (!token || !webhookValid) return unverified(!token ? "missing_token" : "invalid_signature");

    const { data, raw } = await this.retrieve(token, conversationId);
    if (data.status !== "success") return unverified(data.errorCode ?? "retrieve_failed");
    if (input.reference && data.conversationId && data.conversationId !== input.reference) return unverified("reference_mismatch");
    const signatureOk = this.responseSignatureValid(data, raw);
    const paid = data.paymentStatus === "SUCCESS" && data.fraudStatus !== -1;
    const pending = data.paymentStatus === "SUCCESS" && data.fraudStatus === 0;
    return {
      verified: true,
      providerEventId: `${data.paymentId ?? token}:${data.paymentStatus}:${data.fraudStatus ?? ""}`,
      type: isWebhook ? `webhook:${String(b.iyziEventType)}` : "callback",
      reference: data.conversationId ?? (conversationId || null),
      outcome: pending ? "pending" : paid ? "paid" : data.paymentStatus === "FAILURE" ? "failed" : "pending",
      amountPaid: paid && data.paidPrice !== undefined ? decimalToMinor(data.paidPrice) : null,
      providerPaymentId: data.paymentId ?? null,
      transactions: paid ? this.toTransactions(data) : [],
      failureCode: paid ? null : data.errorCode ?? data.paymentStatus ?? null,
      failureMessage: paid ? null : data.errorMessage ?? null,
      ack: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) },
      evidence: {
        paymentStatus: data.paymentStatus,
        paymentId: data.paymentId,
        conversationId: data.conversationId,
        basketId: data.basketId,
        price: data.price,
        paidPrice: data.paidPrice,
        currency: data.currency,
        fraudStatus: data.fraudStatus,
        responseSignatureValid: signatureOk,
        eventType: b.iyziEventType ?? "callback",
      },
    };
  }

  async getPayment(input: GetPaymentInput): Promise<PaymentStatus> {
    if (!input.token) return { outcome: "not_found", amountPaid: null, refundedAmount: null, providerPaymentId: null, transactions: [], raw: "no_token" };
    const { data } = await this.retrieve(input.token, input.reference);
    if (data.status !== "success") return { outcome: "not_found", amountPaid: null, refundedAmount: null, providerPaymentId: null, transactions: [], raw: data.errorMessage ?? null };
    const paid = data.paymentStatus === "SUCCESS" && data.fraudStatus !== -1;
    return {
      outcome: paid ? (data.fraudStatus === 0 ? "pending" : "paid") : data.paymentStatus === "FAILURE" ? "failed" : "pending",
      amountPaid: paid && data.paidPrice !== undefined ? decimalToMinor(data.paidPrice) : null,
      refundedAmount: null,
      providerPaymentId: data.paymentId ?? null,
      transactions: paid ? this.toTransactions(data) : [],
      raw: data.paymentStatus ?? null,
    };
  }

  /** Refunds are issued per item transaction; the amount is spread over refundable items. */
  async refund(input: RefundPaymentInput): Promise<PaymentResult> {
    let remaining = input.amount;
    const ids: string[] = [];
    const sorted = [...input.transactions].sort((a, b) => (b.refundable > a.refundable ? 1 : -1));
    for (const tx of sorted) {
      if (remaining <= 0n) break;
      const part = tx.refundable < remaining ? tx.refundable : remaining;
      if (part <= 0n) continue;
      const { data } = await this.request<IyzicoResponse & { paymentTransactionId?: string }>("/payment/refund", {
        locale: "tr",
        conversationId: input.refundId,
        paymentTransactionId: tx.id,
        price: minorToDecimal2(part),
        ip: input.ip,
        currency: input.currency,
      });
      if (data.status !== "success") {
        return { ok: false, providerRefundIds: ids, errorCode: data.errorCode ?? "refund_failed", errorMessage: data.errorMessage ?? null };
      }
      ids.push(`${tx.id}:${minorToDecimal2(part)}`);
      remaining -= part;
    }
    if (remaining > 0n) return { ok: false, providerRefundIds: ids, errorCode: "insufficient_refundable", errorMessage: "Refund exceeds refundable amount" };
    return { ok: true, providerRefundIds: ids, errorCode: null, errorMessage: null };
  }

  async cancel(input: CancelPaymentInput): Promise<PaymentResult> {
    if (!input.providerPaymentId) return { ok: false, providerRefundIds: [], errorCode: "payment_id_required", errorMessage: null };
    const { data } = await this.request<IyzicoResponse>("/payment/cancel", {
      locale: "tr",
      conversationId: `cancel-${input.reference}`,
      paymentId: input.providerPaymentId,
      ip: input.ip,
    });
    return data.status === "success"
      ? { ok: true, providerRefundIds: [input.providerPaymentId], errorCode: null, errorMessage: null }
      : { ok: false, providerRefundIds: [], errorCode: data.errorCode ?? "cancel_failed", errorMessage: data.errorMessage ?? null };
  }

  async verifyCredentials(): Promise<{ ok: boolean; message: string | null }> {
    const { data } = await this.request<IyzicoResponse>("/payment/bin/check", { locale: "tr", conversationId: "credential-check", binNumber: "554960" });
    return data.status === "success" ? { ok: true, message: null } : { ok: false, message: data.errorMessage ?? data.errorCode ?? null };
  }
}
