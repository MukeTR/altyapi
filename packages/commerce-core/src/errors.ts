export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unprocessable"
  | "dependency_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  unprocessable: 422,
  dependency_unavailable: 503,
  internal: 500,
};

/**
 * Domain-level error. Carries a stable machine code and an i18n message key; the HTTP
 * layer maps it to a status code without domain code knowing about HTTP.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, messageKey: string, details?: Record<string, unknown>, message?: string) {
    super(message ?? messageKey);
    this.name = "AppError";
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (resource: string, id?: string) =>
  new AppError("not_found", `errors.${resource}.not_found`, id ? { id } : undefined);

export const forbidden = (permission?: string) =>
  new AppError("forbidden", "errors.forbidden", permission ? { permission } : undefined);

export const conflict = (messageKey: string, details?: Record<string, unknown>) =>
  new AppError("conflict", messageKey, details);

export const invalid = (messageKey: string, details?: Record<string, unknown>) =>
  new AppError("validation_failed", messageKey, details);
