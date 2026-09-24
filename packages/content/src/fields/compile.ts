import { z } from "zod";
import { isValidSlug, LOCALE_CODES } from "@altyapi/commerce-core";
import { isRichDocEmpty, richDocSchema, type RichDoc } from "../rich/schema";
import { CONTENT_LIMITS } from "../limits";
import type { FieldDef, LeafFieldDef } from "./types";
import {
  addressValueSchema,
  assetUsageSchema,
  credentialSchema,
  dateRangeValueSchema,
  geoPointValueSchema,
  keyFactSchema,
  linkValueSchema,
  moneyValueSchema,
  openingHoursValueSchema,
  phoneValueSchema,
  sourceCitationSchema,
  videoValueSchema,
  type AssetUsage,
  unknownLocaleError,
} from "./values";

/**
 * FieldDef[] → zod (validation of entry data) and JSON Schema (the editor's generated forms).
 *
 * draft mode accepts incomplete entries: only `required: "always"` fields must be filled, in
 * at least one language. publish mode requires every `required` field in each of the
 * requiredLocales, plus what published content needs inside values (alt text of images, a
 * source on statistics).
 */

export interface CompileOptions {
  mode: "draft" | "publish";
  /** Language keys localized values may carry (the store's languages plus any already stored). */
  locales: readonly string[];
  /**
   * publish mode: languages whose required fields must be filled (the default language first,
   * then every language being published). Defaults to the first of `locales`.
   */
  requiredLocales?: readonly string[] | undefined;
  /** Fields that are hidden on this site: never required. */
  hiddenFields?: ReadonlySet<string> | undefined;
}

/** Anything with fields: a built-in definition or a resolved (effective) type. */
export interface FieldSource {
  fields: readonly FieldDef[];
}

// ---------------------------------------------------------------------------
// Emptiness
// ---------------------------------------------------------------------------

/** True when a (single-language) value counts as not filled. */
export function isEmptyFieldValue(field: FieldDef | LeafFieldDef, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  switch (field.type) {
    case "richDoc":
      return isRichDocEmpty(value as RichDoc);
    case "asset":
      return !(value as Partial<AssetUsage>).assetId;
    case "group":
      return field.validation.fields.every((child) => isEmptyLocalizedAware(child, (value as Record<string, unknown>)[child.key]));
    default:
      return false;
  }
}

function isEmptyLocalizedAware(field: LeafFieldDef, value: unknown): boolean {
  if (!field.localized) return isEmptyFieldValue(field, value);
  if (!value || typeof value !== "object") return true;
  return Object.values(value as Record<string, unknown>).every((v) => isEmptyFieldValue(field, v));
}

/** Value of a field in one language (the value itself for non-localized fields). */
export function fieldValueIn(field: FieldDef | LeafFieldDef, value: unknown, locale: string): unknown {
  if (!field.localized) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[locale];
}

// ---------------------------------------------------------------------------
// Single values
// ---------------------------------------------------------------------------

interface ValueContext {
  mode: "draft" | "publish";
  locales: readonly string[];
  /** Language whose alt text published images need (the default language). */
  primaryLocale: string;
}

function textSchema(min: number | undefined, max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((v) => !min || v.length === 0 || v.length >= min, { message: "errors.content.too_short", params: { min } });
}

function uniqueArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((items) => new Set(items.map((i) => JSON.stringify(i))).size === items.length, "errors.content.duplicate_item");
}

function assetSchema(ctx: ValueContext, requireAlt: boolean) {
  if (ctx.mode !== "publish" || !requireAlt) return assetUsageSchema;
  return assetUsageSchema.refine((a) => a.decorative === true || (a.alt?.[ctx.primaryLocale as keyof typeof a.alt] ?? "").trim().length > 0, {
    path: ["alt"],
    message: "errors.content.image_alt_required",
  });
}

function leafValueSchema(field: LeafFieldDef, ctx: ValueContext): z.ZodType {
  switch (field.type) {
    case "text":
      return textSchema(field.validation.minLength, field.validation.maxLength);
    case "textarea":
      return textSchema(field.validation.minLength, field.validation.maxLength);
    case "richDoc":
      return richDocSchema({ nodes: field.validation.nodes, marks: field.validation.marks, maxChars: field.validation.maxChars, mode: ctx.mode });
    case "slug":
      return z.string().trim().toLowerCase().refine(isValidSlug, "errors.content.invalid_slug");
    case "number": {
      const v = field.validation;
      let s = z.number().finite();
      if (v.integer) s = s.int();
      if (v.min !== undefined) s = s.min(v.min);
      if (v.max !== undefined) s = s.max(v.max);
      return s;
    }
    case "money": {
      const v = field.validation;
      return moneyValueSchema
        .refine((m) => !v.currency || m.currency === v.currency, { path: ["currency"], message: "errors.content.invalid_currency" })
        .refine((m) => v.minMinor === undefined || m.amountMinor >= v.minMinor, { path: ["amountMinor"], message: "errors.content.too_small" })
        .refine((m) => v.maxMinor === undefined || m.amountMinor <= v.maxMinor, { path: ["amountMinor"], message: "errors.content.too_big" });
    }
    case "boolean":
      return z.boolean();
    case "date": {
      const v = field.validation;
      return z.iso
        .date()
        .refine((d) => !v.min || d >= v.min, "errors.content.too_early")
        .refine((d) => !v.max || d <= v.max, "errors.content.too_late");
    }
    case "datetime":
      return z.iso.datetime({ offset: true });
    case "dateRange":
      return dateRangeValueSchema;
    case "duration": {
      const v = field.validation;
      return z
        .number()
        .int()
        .min(v.minMinutes ?? 0)
        .max(v.maxMinutes ?? 525_600);
    }
    case "select":
      return z.enum(field.validation.options.map((o) => o.value) as [string, ...string[]]);
    case "multiSelect":
      return uniqueArray(z.enum(field.validation.options.map((o) => o.value) as [string, ...string[]]), field.validation.maxItems ?? CONTENT_LIMITS.selectOptions);
    case "color":
      return z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "errors.content.invalid_color")
        .transform((c) => c.toLowerCase());
    case "asset": {
      const imagesOnly = field.validation.kinds.every((k) => k === "image");
      return assetSchema(ctx, imagesOnly);
    }
    case "gallery":
      return z.array(assetSchema(ctx, true)).max(field.validation.maxItems);
    case "video":
      return videoValueSchema;
    case "link":
      return linkValueSchema;
    case "reference":
      return z.uuid();
    case "multiReference":
      return uniqueArray(z.uuid(), field.validation.maxItems);
    case "email":
      return z.email("errors.content.invalid_email").max(254);
    case "phone":
      return phoneValueSchema;
    case "address":
      return addressValueSchema;
    case "geo":
      return geoPointValueSchema;
    case "openingHours":
      return openingHoursValueSchema;
    case "keyFacts":
      return z.array(keyFactSchema).max(field.validation.maxItems);
    case "sources":
      return z.array(sourceCitationSchema).max(field.validation.maxItems);
    case "credentials":
      return z.array(credentialSchema).max(field.validation.maxItems);
  }
}

// ---------------------------------------------------------------------------
// Fields and entries
// ---------------------------------------------------------------------------

function localizedMap(inner: z.ZodType, locales: readonly string[]) {
  const keys = locales.filter((l): l is (typeof LOCALE_CODES)[number] => (LOCALE_CODES as readonly string[]).includes(l));
  return z.partialRecord(z.enum(keys.length ? (keys as [string, ...string[]]) : ["tr"]), inner.nullable(), { error: unknownLocaleError });
}

function fieldSchema(field: LeafFieldDef, ctx: ValueContext): z.ZodType {
  const value = leafValueSchema(field, ctx);
  return (field.localized ? localizedMap(value, ctx.locales) : value).nullable().optional();
}

interface RequiredCheck {
  field: LeafFieldDef;
  path: (string | number)[];
  value: unknown;
}

/** Adds "required" issues for one field (or a container child) under the current mode. */
function checkRequired(check: RequiredCheck, opts: CompileOptions, addIssue: (path: (string | number)[], message: string) => void) {
  const { field, path, value } = check;
  const required = field.required;
  if (!required || (opts.mode === "draft" && required !== "always")) return;
  if (!field.localized) {
    if (isEmptyFieldValue(field, value)) addIssue(path, "errors.content.field_required");
    return;
  }
  const map = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (opts.mode === "draft") {
    if (Object.values(map).every((v) => isEmptyFieldValue(field, v))) addIssue(path, "errors.content.field_required");
    return;
  }
  for (const locale of opts.requiredLocales ?? opts.locales.slice(0, 1)) {
    if (isEmptyFieldValue(field, map[locale])) addIssue([...path, locale], "errors.content.field_required");
  }
}

/**
 * Validation schema of entry data for a type. Unknown keys (fields removed from the type) are
 * dropped; hidden fields are validated but never required.
 */
export function compileEntrySchema(source: FieldSource, opts: CompileOptions): z.ZodType<Record<string, unknown>> {
  const requiredLocales = opts.requiredLocales?.length ? opts.requiredLocales : opts.locales.slice(0, 1);
  const ctx: ValueContext = { mode: opts.mode, locales: opts.locales, primaryLocale: requiredLocales[0] ?? "tr" };
  const hidden = opts.hiddenFields ?? new Set<string>();
  const shape: Record<string, z.ZodType> = {};
  for (const field of source.fields) {
    if (field.type === "group") {
      const inner: Record<string, z.ZodType> = {};
      for (const child of field.validation.fields) inner[child.key] = fieldSchema(child, ctx);
      shape[field.key] = z.object(inner).nullable().optional();
    } else if (field.type === "repeater") {
      const inner: Record<string, z.ZodType> = {};
      for (const child of field.validation.fields) inner[child.key] = fieldSchema(child, ctx);
      shape[field.key] = z
        .array(z.object(inner))
        .max(field.validation.maxItems)
        .nullable()
        .optional();
    } else {
      shape[field.key] = fieldSchema(field, ctx);
    }
  }
  return z.object(shape).superRefine((data, zctx) => {
    const addIssue = (path: (string | number)[], message: string) => zctx.addIssue({ code: "custom", path, message });
    for (const field of source.fields) {
      if (hidden.has(field.key)) continue;
      const value = (data as Record<string, unknown>)[field.key];
      if (field.type === "group" || field.type === "repeater") {
        const required = field.required && (opts.mode === "publish" || field.required === "always");
        if (required && isEmptyFieldValue(field, value)) addIssue([field.key], "errors.content.field_required");
        if (field.type === "repeater" && opts.mode === "publish" && field.validation.minItems && ((value as unknown[] | null) ?? []).length < field.validation.minItems) {
          addIssue([field.key], "errors.content.too_few_items");
        }
        const items = field.type === "group" ? (value ? [value] : []) : ((value as unknown[] | null) ?? []);
        items.forEach((item, i) => {
          for (const child of field.validation.fields) {
            const path = field.type === "group" ? [field.key, child.key] : [field.key, i, child.key];
            checkRequired({ field: child, path, value: (item as Record<string, unknown>)[child.key] }, { ...opts, requiredLocales }, addIssue);
          }
        });
        continue;
      }
      checkRequired({ field, path: [field.key], value }, { ...opts, requiredLocales }, addIssue);
    }
  }) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Languages an entry can be published in: the candidates (store languages, default first) in
 * which every required localized field is filled. Non-localized required fields gate every
 * language at once. The default language is included only when it qualifies; callers refuse
 * to publish without it.
 */
export function publishableLocales(source: FieldSource, data: Record<string, unknown>, candidates: readonly string[], hiddenFields?: ReadonlySet<string>): string[] {
  const hidden = hiddenFields ?? new Set<string>();
  const required = source.fields.filter((f) => f.required && !hidden.has(f.key));
  for (const field of required) {
    if (!field.localized && field.type !== "group" && field.type !== "repeater" && isEmptyFieldValue(field, data[field.key])) return [];
    if ((field.type === "group" || field.type === "repeater") && isEmptyFieldValue(field, data[field.key])) return [];
  }
  return candidates.filter((locale) =>
    required.every((field) => {
      if (field.type === "group" || field.type === "repeater") {
        const items = field.type === "group" ? [data[field.key]] : ((data[field.key] as unknown[] | null) ?? []);
        return items.every((item) =>
          field.validation.fields
            .filter((c) => c.required && c.localized)
            .every((c) => !isEmptyFieldValue(c, fieldValueIn(c, (item as Record<string, unknown> | null)?.[c.key], locale))),
        );
      }
      return !field.localized || !isEmptyFieldValue(field, fieldValueIn(field, data[field.key], locale));
    }),
  );
}

// ---------------------------------------------------------------------------
// JSON Schema (editor)
// ---------------------------------------------------------------------------

type FieldMeta = { title?: string; description?: string; "x-altyapi-field"?: Record<string, unknown> };

/**
 * JSON Schema of a type's entry data for the editor's generated forms. Each property carries
 * its field definition under "x-altyapi-field" (type, labels, localized, required, ui) so the
 * editor can pick widgets; hidden and internal-only concerns stay in the definition.
 */
export function toJsonSchema(source: FieldSource, opts: { locales: readonly string[]; hiddenFields?: ReadonlySet<string> | undefined; editorLocale?: string }): Record<string, unknown> {
  const hidden = opts.hiddenFields ?? new Set<string>();
  const visible: FieldSource = { fields: source.fields.filter((f) => !hidden.has(f.key)) };
  const ctx: ValueContext = { mode: "draft", locales: opts.locales, primaryLocale: opts.locales[0] ?? "tr" };
  const registry = z.registry<FieldMeta>();
  const lang = opts.editorLocale ?? "tr";
  const describe = (field: FieldDef | LeafFieldDef, schema: z.ZodType) => {
    const label = field.label as Record<string, string | undefined>;
    const help = field.help as Record<string, string | undefined> | undefined;
    registry.add(schema, {
      title: label[lang] ?? label.tr ?? Object.values(label).find(Boolean) ?? field.key,
      ...(help ? { description: help[lang] ?? help.tr ?? Object.values(help).find(Boolean) ?? "" } : {}),
      "x-altyapi-field": {
        key: field.key,
        type: field.type,
        label: field.label,
        ...(field.help ? { help: field.help } : {}),
        localized: field.localized,
        required: field.required,
        ui: field.ui,
        visibility: field.visibility,
        validation: field.type === "group" || field.type === "repeater" ? { ...field.validation, fields: undefined } : field.validation,
      },
    });
    return schema;
  };
  const shape: Record<string, z.ZodType> = {};
  for (const field of visible.fields) {
    if (field.type === "group" || field.type === "repeater") {
      const inner: Record<string, z.ZodType> = {};
      for (const child of field.validation.fields) inner[child.key] = describe(child, fieldSchema(child, ctx));
      const obj = z.object(inner);
      shape[field.key] = describe(field, (field.type === "group" ? obj : z.array(obj).max(field.validation.maxItems)).nullable().optional());
    } else {
      shape[field.key] = describe(field, fieldSchema(field, ctx));
    }
  }
  return z.toJSONSchema(z.object(shape), { io: "input", unrepresentable: "any", metadata: registry }) as Record<string, unknown>;
}
