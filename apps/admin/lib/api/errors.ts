/**
 * The API error envelope, `{ error: { code, message_key, details?, correlation_id } }`, as a
 * plain serializable object (so it can cross the server/client boundary) plus a throwable class.
 */
export interface ApiErrorInfo {
  /** HTTP status; 0 when no response arrived (network error or timeout). */
  status: number;
  /** Stable machine code: bad_request, validation_failed, forbidden, not_found, conflict, … */
  code: string;
  /** i18n key, e.g. "errors.store.slug_taken". */
  messageKey: string;
  details?: unknown;
  /** Support code shown to the merchant (x-correlation-id). */
  correlationId: string | null;
  /** Seconds from Retry-After on 429 responses. */
  retryAfter?: number | null;
}

export class ApiError extends Error implements ApiErrorInfo {
  readonly status: number;
  readonly code: string;
  readonly messageKey: string;
  readonly details?: unknown;
  readonly correlationId: string | null;
  readonly retryAfter: number | null;

  constructor(info: ApiErrorInfo) {
    super(`${info.status} ${info.code} ${info.messageKey}`);
    this.name = "ApiError";
    this.status = info.status;
    this.code = info.code;
    this.messageKey = info.messageKey;
    this.details = info.details;
    this.correlationId = info.correlationId;
    this.retryAfter = info.retryAfter ?? null;
  }

  toInfo(): ApiErrorInfo {
    return {
      status: this.status,
      code: this.code,
      messageKey: this.messageKey,
      ...(this.details !== undefined ? { details: this.details } : {}),
      correlationId: this.correlationId,
      retryAfter: this.retryAfter,
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "validation_failed",
  429: "rate_limited",
  503: "dependency_unavailable",
};

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Builds an ApiError from a non-2xx response, tolerating bodies that are not the envelope. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const correlationId = res.headers.get("x-correlation-id");
  const retryAfter = res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error (proxy page, empty body): fall back to the status.
  }
  const envelope = (body as { error?: Record<string, unknown> } | null)?.error;
  if (envelope && typeof envelope.code === "string" && typeof envelope.message_key === "string") {
    return new ApiError({
      status: res.status,
      code: envelope.code,
      messageKey: envelope.message_key,
      ...(envelope.details !== undefined ? { details: envelope.details } : {}),
      correlationId: typeof envelope.correlation_id === "string" ? envelope.correlation_id : correlationId,
      retryAfter,
    });
  }
  const code = STATUS_CODES[res.status] ?? (res.status >= 500 ? "internal" : "bad_request");
  return new ApiError({ status: res.status, code, messageKey: `errors.${code}`, correlationId, retryAfter });
}

export function networkError(timeout: boolean): ApiError {
  const code = timeout ? "timeout" : "network";
  return new ApiError({ status: 0, code, messageKey: `errors.${code}`, correlationId: null });
}
