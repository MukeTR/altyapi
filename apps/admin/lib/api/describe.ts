import type { Catalog } from "@/lib/i18n/catalog";
import { createTranslator, interpolate, type MessageVars } from "@/lib/i18n/translate";
import type { ApiErrorInfo } from "./errors";

export interface DescribedError {
  /** Localized sentence for the error as a whole. */
  message: string;
  /** Localized messages per form field (field name without the leading slash; nested paths use dots). */
  fields: Record<string, string>;
  /** Support code to show and copy. */
  correlationId: string | null;
  /** The permission that was missing, for 403 responses. */
  permission: string | null;
}

/** Scalar detail values become placeholders; arrays of scalars are joined. */
function detailVars(details: unknown): MessageVars | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const vars: MessageVars = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number") vars[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) vars[key] = value.join(", ");
  }
  return vars;
}

/** Normalizes "/email", "sections.0.props.title" and "" to a field name. */
function fieldName(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const name = path.replace(/^\//, "").replace(/\//g, ".");
  return name || null;
}

/**
 * Localizes a validation message. The API sends either an `errors.*` key or zod's English
 * default; the common zod shapes are recognized so Turkish users never see English text.
 */
function fieldMessage(raw: unknown, catalog: Catalog): string {
  const t = createTranslator(catalog.messages);
  if (typeof raw !== "string") return t("ui.field.invalidValue");
  if (raw.startsWith("errors.")) return catalog.apiErrors[raw] ?? t("ui.field.invalidValue");
  let m: RegExpExecArray | null;
  if (/received undefined/i.test(raw)) return t("ui.field.requiredValue");
  if (/invalid email/i.test(raw)) return t("ui.field.invalidEmail");
  if ((m = /too small: expected string to have >=?(\d+) character/i.exec(raw))) {
    return m[1] === "1" ? t("ui.field.requiredValue") : t("ui.field.tooShort", { min: m[1] ?? "" });
  }
  if ((m = /too big: expected string to have <=?(\d+) character/i.exec(raw))) return t("ui.field.tooLong", { max: m[1] ?? "" });
  if ((m = /too small: expected (?:number|int|bigint) to be >=?(-?\d+)/i.exec(raw))) return t("ui.field.tooSmall", { min: m[1] ?? "" });
  if ((m = /too big: expected (?:number|int|bigint) to be <=?(-?\d+)/i.exec(raw))) return t("ui.field.tooLarge", { max: m[1] ?? "" });
  if (/invalid option/i.test(raw)) return t("ui.field.invalidOption");
  return t("ui.field.invalidValue");
}

function collectFieldIssues(details: unknown): { path: unknown; message: unknown }[] {
  if (Array.isArray(details)) return details as { path: unknown; message: unknown }[];
  const issues = (details as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as { path: unknown; message: unknown }[]) : [];
}

/**
 * Turns an API error into merchant-facing text in the given language.
 * `fieldForKey` maps domain error keys that concern one field (e.g. "errors.store.slug_taken")
 * onto that field so the form can show the message inline.
 */
export function describeApiError(error: ApiErrorInfo, catalog: Catalog, fieldForKey?: Record<string, string>): DescribedError {
  const vars = detailVars(error.details);
  const template = catalog.apiErrors[error.messageKey] ?? catalog.apiErrorCodes[error.code] ?? catalog.apiErrorCodes.internal ?? "";
  const message = interpolate(template, vars);

  const fields: Record<string, string> = {};
  for (const issue of collectFieldIssues(error.details)) {
    const name = fieldName(issue.path);
    if (name && !fields[name]) fields[name] = fieldMessage(issue.message, catalog);
  }
  const mapped = fieldForKey?.[error.messageKey];
  if (mapped && !fields[mapped]) fields[mapped] = message;

  const permission =
    error.code === "forbidden" && typeof (error.details as { permission?: unknown } | null)?.permission === "string"
      ? (error.details as { permission: string }).permission
      : null;

  return { message, fields, correlationId: error.correlationId, permission };
}
