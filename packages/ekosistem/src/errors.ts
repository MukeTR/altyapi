import { AppError } from "@altyapi/commerce-core";

/**
 * Error codes of the /ekosistem/v1 envelope (§6.4). `bad_request` covers the 400 cases §5
 * names without a code (duplicate query key, body on GET/DELETE, Content-Encoding, wrong
 * Content-Type, malformed canonical path).
 */
export const EKOSISTEM_ERROR_STATUS = {
  bad_request: 400,
  link_invalid: 401,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
  plan_required: 402,
  scope_missing: 403,
  peer_unverified: 403,
  not_found: 404,
  code_invalid: 404,
  method_not_allowed: 405,
  link_pending: 409,
  payload_too_large: 413,
  validation_failed: 422,
  rate_limited: 429,
  unavailable: 503,
} as const;

export type EkosistemErrorCode = keyof typeof EKOSISTEM_ERROR_STATUS;

export const EKOSISTEM_ERROR_CODES = Object.keys(EKOSISTEM_ERROR_STATUS) as EkosistemErrorCode[];

export function isEkosistemErrorCode(value: unknown): value is EkosistemErrorCode {
  return typeof value === "string" && Object.hasOwn(EKOSISTEM_ERROR_STATUS, value);
}

/** Default Turkish messages for the envelope; informative, never containing secrets. */
export const EKOSISTEM_ERROR_MESSAGES: Record<EkosistemErrorCode, string> = {
  bad_request: "İstek biçimi geçersiz.",
  link_invalid: "Bağlantı bulunamadı ya da etkin değil.",
  signature_invalid: "İstek imzası doğrulanamadı.",
  timestamp_skew: "İstek zaman damgası sunucu saatinden 300 saniyeden fazla farklı.",
  replay: "Bu istek daha önce işlendi (nonce tekrar kullanıldı).",
  plan_required: "Bu özellik mevcut plan kapsamında değil.",
  scope_missing: "Bağlantı bu veri için gereken kapsama sahip değil.",
  peer_unverified: "Eş ürün bağlantıyı doğrulayamadı.",
  not_found: "Kayıt bulunamadı.",
  code_invalid: "Bağlantı kodu geçersiz, süresi dolmuş ya da kullanılmış.",
  method_not_allowed: "Bu HTTP yöntemi desteklenmiyor.",
  link_pending: "Bağlantı henüz onaylanmadı.",
  payload_too_large: "İstek gövdesi 64 KB sınırını aşıyor.",
  validation_failed: "İstek içeriği doğrulanamadı.",
  rate_limited: "Çok fazla istek gönderildi; lütfen daha sonra tekrar deneyin.",
  unavailable: "Hizmet şu anda kullanılamıyor.",
};

/** Only link_invalid is permanent; these are retried (§6.4). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set(["timestamp_skew", "rate_limited", "unavailable"]);
export const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set(["link_invalid"]);

export interface EkosistemErrorEnvelope {
  error: { code: EkosistemErrorCode; message: string };
  requestId: string;
}

export function ekosistemErrorEnvelope(code: EkosistemErrorCode, requestId: string, message?: string): EkosistemErrorEnvelope {
  return { error: { code, message: message ?? EKOSISTEM_ERROR_MESSAGES[code] }, requestId };
}

/** Error raised by /ekosistem/v1 handlers; the route layer turns it into the §6.4 envelope. */
export class EkosistemError extends Error {
  override name = "EkosistemError";
  readonly status: number;
  constructor(
    readonly code: EkosistemErrorCode,
    message?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message ?? EKOSISTEM_ERROR_MESSAGES[code]);
    this.status = EKOSISTEM_ERROR_STATUS[code];
  }
}

/**
 * Outbound failure codes: every §6.4 code the peer may answer with, plus local conditions
 * (peer base not configured, response not matching the contract).
 */
export type PeerErrorCode = EkosistemErrorCode | "not_configured" | "invalid_response";

/** Failure of a call to a peer product, classified for retry decisions. */
export class EkosistemPeerError extends Error {
  override name = "EkosistemPeerError";
  constructor(
    readonly code: PeerErrorCode,
    readonly httpStatus: number | null,
    message: string,
    readonly retryAfterMs: number | null = null,
    readonly requestId: string | null = null,
    /** The call was not made because the circuit breaker for this link is open. */
    readonly circuitOpen = false,
  ) {
    super(message);
  }

  /** link_invalid: the peer no longer knows this link; stop using it. */
  get terminal(): boolean {
    return TERMINAL_ERROR_CODES.has(this.code);
  }

  /** timestamp_skew, rate_limited and unavailable are worth retrying later. */
  get retryable(): boolean {
    return RETRYABLE_ERROR_CODES.has(this.code);
  }

  /** Maps to an admin-facing AppError (errors.ekosistem.* message keys). */
  toAppError(): AppError {
    const details = { peerCode: this.code, ...(this.requestId ? { peerRequestId: this.requestId } : {}) };
    switch (this.code) {
      case "link_invalid":
        return new AppError("conflict", "errors.ekosistem.link_invalid", details);
      case "code_invalid":
        return new AppError("not_found", "errors.ekosistem.code_invalid", details);
      case "peer_unverified":
        return new AppError("forbidden", "errors.ekosistem.peer_unverified", details);
      case "scope_missing":
        return new AppError("forbidden", "errors.ekosistem.scope_missing", details);
      case "plan_required":
        return new AppError("precondition_failed", "errors.ekosistem.plan_required", details);
      case "link_pending":
        return new AppError("conflict", "errors.ekosistem.link_pending", details);
      case "not_configured":
        return new AppError("dependency_unavailable", "errors.ekosistem.peer_not_configured", details);
      case "rate_limited":
      case "unavailable":
      case "timestamp_skew":
        return new AppError("dependency_unavailable", "errors.ekosistem.peer_unavailable", details);
      default:
        return new AppError("dependency_unavailable", "errors.ekosistem.peer_error", details);
    }
  }
}
