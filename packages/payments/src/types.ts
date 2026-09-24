/**
 * Provider-independent payment contracts. Adapters translate these to provider APIs;
 * provider payloads never leak into order or checkout code.
 */
export type ProviderName = "paytr" | "iyzico";
export type PaymentMode = "test" | "live";

export interface PaymentLineItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  /** Unit price after discounts, tax included, in minor units. */
  unitPrice: bigint;
  kind: "physical" | "digital" | "shipping";
}

export interface PaymentParty {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  /** TCKN / VKN when provided; providers that require one get a documented placeholder. */
  identityNumber: string | null;
  ip: string;
  registeredAt: Date | null;
}

export interface PaymentAddress {
  contactName: string;
  line: string;
  city: string;
  country: string;
  postalCode: string | null;
}

export interface CreatePaymentInput {
  attemptId: string;
  /** Unique, provider-safe reference (alphanumeric). */
  reference: string;
  orderNumber: string;
  amount: bigint;
  currency: string;
  locale: string;
  items: PaymentLineItem[];
  buyer: PaymentParty;
  shippingAddress: PaymentAddress | null;
  billingAddress: PaymentAddress;
  urls: { success: string; failure: string; callback: string };
  maxInstallments: number;
  timeoutMinutes: number;
}

export interface PaymentSession {
  kind: "iframe" | "script" | "redirect";
  /** Provider session token (PayTR iframe token / iyzico checkout token). */
  token: string;
  url: string | null;
  /** Embeddable markup returned by the provider (iyzico checkoutFormContent). */
  html: string | null;
  expiresAt: Date;
}

export interface CallbackInput {
  headers: Record<string, string | string[] | undefined>;
  /** Parsed body (form or JSON). */
  body: Record<string, unknown>;
  rawBody: string;
  /** Payment attempt this callback targets, when encoded in the URL. */
  reference?: string;
}

export type PaymentOutcome = "paid" | "failed" | "pending" | "unknown";

export interface ProviderTransaction {
  id: string;
  amount: bigint;
  itemId?: string;
}

export interface VerifiedPaymentEvent {
  verified: boolean;
  /** Stable id for deduplication (provider event id, or derived from payload). */
  providerEventId: string;
  type: string;
  reference: string | null;
  outcome: PaymentOutcome;
  amountPaid: bigint | null;
  providerPaymentId: string | null;
  transactions: ProviderTransaction[];
  failureCode: string | null;
  failureMessage: string | null;
  /** What the provider expects back (PayTR requires plain "OK"). */
  ack: { status: number; contentType: string; body: string };
  /** Redacted payload to store as evidence. */
  evidence: Record<string, unknown>;
}

export interface GetPaymentInput {
  reference: string;
  providerPaymentId: string | null;
  token: string | null;
}

export interface PaymentStatus {
  outcome: PaymentOutcome | "not_found";
  amountPaid: bigint | null;
  refundedAmount: bigint | null;
  providerPaymentId: string | null;
  transactions: ProviderTransaction[];
  raw: string | null;
}

export interface CancelPaymentInput {
  reference: string;
  providerPaymentId: string | null;
  amount: bigint;
  currency: string;
  ip: string;
}

export interface RefundPaymentInput {
  reference: string;
  providerPaymentId: string | null;
  /** Amount to refund in minor units. */
  amount: bigint;
  currency: string;
  ip: string;
  /** Idempotency / correlation id for the provider. */
  refundId: string;
  /** Sale transactions with remaining refundable amounts (providers that refund per item). */
  transactions: { id: string; refundable: bigint }[];
}

export interface PaymentResult {
  ok: boolean;
  providerRefundIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  createSession(input: CreatePaymentInput): Promise<PaymentSession>;
  verifyCallback(input: CallbackInput): Promise<VerifiedPaymentEvent>;
  getPayment(input: GetPaymentInput): Promise<PaymentStatus>;
  cancel(input: CancelPaymentInput): Promise<PaymentResult>;
  refund(input: RefundPaymentInput): Promise<PaymentResult>;
  /** Checks credentials against the provider without moving money. */
  verifyCredentials(): Promise<{ ok: boolean; message: string | null }>;
}

export class ProviderRequestError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

/** Decimal string with exactly two fraction digits ("129.90") from minor units. */
export function minorToDecimal2(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const s = abs.toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Parses provider decimals ("129.9", "129.90", "129") into minor units without floats. */
export function decimalToMinor(value: string | number): bigint {
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,}))?$/.exec(s);
  if (!m) throw new Error(`Invalid decimal amount: ${s}`);
  const frac = (m[3] ?? "").padEnd(2, "0");
  let v = BigInt(`${m[2]}${frac.slice(0, 2)}`);
  if (frac.length > 2 && Number(frac[2]) >= 5) v += 1n;
  return m[1] ? -v : v;
}
