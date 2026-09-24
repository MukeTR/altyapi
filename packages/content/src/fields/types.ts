import { z } from "zod";
import { LOCALE_CODES } from "@altyapi/commerce-core";
import { CONTENT_LIMITS } from "../limits";
import { RICH_BLOCK_TYPES, RICH_MARK_TYPES } from "../rich/schema";

/**
 * Field definitions of content types (docs/platform/site-turleri-ve-cms.md §3.3). Built-in
 * types declare their fields in code; custom types store FieldDef[] in content_types.custom_fields.
 * The field type set is closed: there is no raw HTML, JSON, JSON-LD, iframe, script or code
 * field, so no content type (custom or built-in) can carry executable markup.
 */

export const FIELD_TYPES = [
  // Text
  "text",
  "textarea",
  "richDoc",
  "slug",
  // Number and money
  "number",
  "money",
  // Other scalars
  "boolean",
  "date",
  "datetime",
  "dateRange",
  "duration",
  "select",
  "multiSelect",
  "color",
  // Media
  "asset",
  "gallery",
  "video",
  // Relations
  "link",
  "reference",
  "multiReference",
  // Contact and place
  "email",
  "phone",
  "address",
  "geo",
  "openingHours",
  // Structured
  "keyFacts",
  "sources",
  "group",
  "repeater",
  // Built-in types only
  "credentials",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Fields whose children are fields; they nest one level only. */
export const CONTAINER_FIELD_TYPES = ["group", "repeater"] as const satisfies readonly FieldType[];

/** Field types a custom type may not use (verified credentials are set by the owner through built-in types only). */
export const BUILTIN_ONLY_FIELD_TYPES = ["credentials"] as const satisfies readonly FieldType[];

/** What a reference field can point at. */
export const REFERENCE_TARGET_KINDS = ["entry", "page", "product", "collection", "location"] as const;
export type ReferenceTargetKind = (typeof REFERENCE_TARGET_KINDS)[number];

/** Units of number fields (rendered with localized labels: m², dk, seans…). */
export const NUMBER_UNITS = [
  "m2", "m", "cm", "mm", "km", "kg", "g", "l", "ml", "minute", "hour", "day", "week", "month", "year", "session", "person", "piece", "percent",
] as const;

export const FIELD_ASSET_KINDS = ["image", "video", "document"] as const;

const localeKey = z.enum(LOCALE_CODES);

/** Field and option labels: at least one language. */
export const fieldLabel = z
  .partialRecord(localeKey, z.string().trim().max(120))
  .refine((v) => Object.values(v).some((s) => (s ?? "").length > 0), "errors.content_type.label_required");
const helpText = z.partialRecord(localeKey, z.string().trim().max(500));

/** camelCase key, unique within its type (or its container). */
export const fieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,47}$/, "errors.content_type.invalid_field_key");

const baseField = {
  key: fieldKeySchema,
  label: fieldLabel,
  help: helpText.optional(),
  /** Stores { locale: value } instead of one value. */
  localized: z.boolean().default(false),
  /** false: optional; publish: needed to publish (per published language when localized); always: needed to save. */
  required: z.union([z.literal(false), z.literal("publish"), z.literal("always")]).default(false),
  ui: z
    .object({
      width: z.enum(["full", "half", "third"]).optional(),
      placeholder: helpText.optional(),
      /** Editor tab or panel the field is shown in. */
      section: z.string().regex(/^[a-z][a-zA-Z0-9]{0,47}$/).optional(),
    })
    .default({}),
  /** internal: never sent to the storefront, the Delivery API, JSON-LD or AI prompts. */
  visibility: z.enum(["public", "internal"]).default("public"),
  searchable: z.boolean().default(false),
  listColumn: z.boolean().default(false),
  filterable: z.boolean().default(false),
  /** A change of this field on publish counts as a significant update (dateModified, sitemap lastmod). */
  significant: z.boolean().default(false),
};

const optionValue = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "errors.content_type.invalid_option_value");
const selectOptions = z
  .array(z.object({ value: optionValue, label: fieldLabel }))
  .min(1)
  .max(CONTENT_LIMITS.selectOptions)
  .refine((opts) => new Set(opts.map((o) => o.value)).size === opts.length, "errors.content_type.duplicate_option");

const isoDate = z.iso.date();

const leafFieldSchemas = [
  z.object({ ...baseField, type: z.literal("text"), validation: z.object({ minLength: z.number().int().min(0).max(1_000).optional(), maxLength: z.number().int().min(1).max(1_000).default(200) }).default({ maxLength: 200 }) }),
  z.object({ ...baseField, type: z.literal("textarea"), validation: z.object({ minLength: z.number().int().min(0).max(10_000).optional(), maxLength: z.number().int().min(1).max(10_000).default(2_000) }).default({ maxLength: 2_000 }) }),
  z.object({
    ...baseField,
    type: z.literal("richDoc"),
    validation: z
      .object({
        nodes: z.array(z.enum(RICH_BLOCK_TYPES)).min(1).optional(),
        marks: z.array(z.enum(RICH_MARK_TYPES)).optional(),
        maxChars: z.number().int().min(1).max(CONTENT_LIMITS.richDocCharsPerLocale).optional(),
      })
      .default({}),
  }),
  z.object({ ...baseField, type: z.literal("slug"), validation: z.object({}).default({}) }),
  z.object({
    ...baseField,
    type: z.literal("number"),
    validation: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        integer: z.boolean().default(false),
        unit: z.enum(NUMBER_UNITS).optional(),
      })
      .default({ integer: false }),
  }),
  z.object({
    ...baseField,
    type: z.literal("money"),
    validation: z
      .object({
        /** Fixed currency; otherwise any of the store's currencies. */
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        minMinor: z.number().int().optional(),
        maxMinor: z.number().int().optional(),
      })
      .default({}),
  }),
  z.object({ ...baseField, type: z.literal("boolean"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("date"), validation: z.object({ min: isoDate.optional(), max: isoDate.optional() }).default({}) }),
  z.object({ ...baseField, type: z.literal("datetime"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("dateRange"), validation: z.object({}).default({}) }),
  z.object({
    ...baseField,
    type: z.literal("duration"),
    validation: z.object({ minMinutes: z.number().int().min(0).optional(), maxMinutes: z.number().int().min(1).max(525_600).optional() }).default({}),
  }),
  z.object({ ...baseField, type: z.literal("select"), validation: z.object({ options: selectOptions }) }),
  z.object({
    ...baseField,
    type: z.literal("multiSelect"),
    validation: z.object({ options: selectOptions, maxItems: z.number().int().min(1).max(CONTENT_LIMITS.selectOptions).optional() }),
  }),
  z.object({ ...baseField, type: z.literal("color"), validation: z.object({}).default({}) }),
  z.object({
    ...baseField,
    type: z.literal("asset"),
    validation: z.object({ kinds: z.array(z.enum(FIELD_ASSET_KINDS)).min(1).default(["image"]) }).default({ kinds: ["image"] }),
  }),
  z.object({
    ...baseField,
    type: z.literal("gallery"),
    validation: z.object({ maxItems: z.number().int().min(1).max(CONTENT_LIMITS.galleryItems).default(30) }).default({ maxItems: 30 }),
  }),
  z.object({ ...baseField, type: z.literal("video"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("link"), validation: z.object({}).default({}) }),
  z.object({
    ...baseField,
    type: z.literal("reference"),
    validation: z.object({
      to: z.enum(REFERENCE_TARGET_KINDS),
      /** Entry references: allowed content type keys (default: any type). */
      typeKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)).min(1).max(20).optional(),
    }),
  }),
  z.object({
    ...baseField,
    type: z.literal("multiReference"),
    validation: z.object({
      to: z.enum(REFERENCE_TARGET_KINDS),
      typeKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)).min(1).max(20).optional(),
      maxItems: z.number().int().min(1).max(CONTENT_LIMITS.multiReferenceItems).default(20),
    }),
  }),
  z.object({ ...baseField, type: z.literal("email"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("phone"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("address"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("geo"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("openingHours"), validation: z.object({}).default({}) }),
  z.object({ ...baseField, type: z.literal("keyFacts"), validation: z.object({ maxItems: z.number().int().min(1).max(30).default(12) }).default({ maxItems: 12 }) }),
  z.object({ ...baseField, type: z.literal("sources"), validation: z.object({ maxItems: z.number().int().min(1).max(50).default(20) }).default({ maxItems: 20 }) }),
  z.object({ ...baseField, type: z.literal("credentials"), validation: z.object({ maxItems: z.number().int().min(1).max(50).default(20) }).default({ maxItems: 20 }) }),
] as const;

const leafFieldDefSchema = z.discriminatedUnion("type", leafFieldSchemas, { error: (iss: { code?: string }) => (iss.code === "invalid_union" ? "errors.content_type.field_type_not_allowed" : undefined) });

const uniqueKeys = (fields: { key: string }[]) => new Set(fields.map((f) => f.key)).size === fields.length;

const containerFieldSchemas = [
  z.object({
    ...baseField,
    type: z.literal("group"),
    validation: z.object({ fields: z.array(leafFieldDefSchema).min(1).max(30).refine(uniqueKeys, "errors.content_type.duplicate_field") }),
  }),
  z.object({
    ...baseField,
    type: z.literal("repeater"),
    validation: z.object({
      fields: z.array(leafFieldDefSchema).min(1).max(30).refine(uniqueKeys, "errors.content_type.duplicate_field"),
      minItems: z.number().int().min(0).max(CONTENT_LIMITS.repeaterItems).optional(),
      maxItems: z.number().int().min(1).max(CONTENT_LIMITS.repeaterItems).default(20),
    }),
  }),
] as const;

/** Any field definition, built-in types included. */
/** A field type outside the closed set (raw HTML, JSON, iframe, script…) is refused with this key. */
const unknownFieldType = { error: (iss: { code?: string }) => (iss.code === "invalid_union" ? "errors.content_type.field_type_not_allowed" : undefined) };

export const fieldDefSchema = z
  .discriminatedUnion("type", [...leafFieldSchemas, ...containerFieldSchemas], unknownFieldType)
  .superRefine((field, ctx) => {
    // A container is not localized itself; its children are, individually.
    if ((field.type === "group" || field.type === "repeater") && field.localized) {
      ctx.addIssue({ code: "custom", path: ["localized"], message: "errors.content_type.container_not_localized" });
    }
    if (field.type === "select" || field.type === "multiSelect" || field.type === "boolean") {
      // Option values are language-neutral; their labels are localized in the definition.
      if (field.localized) ctx.addIssue({ code: "custom", path: ["localized"], message: "errors.content_type.field_not_localizable" });
    }
    if ((field.type === "reference" || field.type === "multiReference") && field.validation.typeKeys && field.validation.to !== "entry") {
      ctx.addIssue({ code: "custom", path: ["validation", "typeKeys"], message: "errors.content_type.type_keys_entry_only" });
    }
    if (field.type === "number" && field.validation.min !== undefined && field.validation.max !== undefined && field.validation.min > field.validation.max) {
      ctx.addIssue({ code: "custom", path: ["validation"], message: "errors.content_type.invalid_range" });
    }
  });

export type FieldDef = z.output<typeof fieldDefSchema>;
export type FieldDefInput = z.input<typeof fieldDefSchema>;
export type LeafFieldDef = z.output<typeof leafFieldDefSchema>;
export type FieldOf<T extends FieldType> = Extract<FieldDef, { type: T }>;

/**
 * A custom type's fields: the same definitions minus the built-in-only types, anywhere in the
 * tree (a repeater cannot smuggle in credentials).
 */
export const customFieldDefsSchema = z
  .array(fieldDefSchema)
  .max(CONTENT_LIMITS.fieldsPerType)
  .superRefine((fields, ctx) => {
    const keys = new Set<string>();
    fields.forEach((field, i) => {
      if (keys.has(field.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: "errors.content_type.duplicate_field" });
      keys.add(field.key);
      const children = field.type === "group" || field.type === "repeater" ? field.validation.fields : [];
      for (const f of [field, ...children]) {
        if ((BUILTIN_ONLY_FIELD_TYPES as readonly string[]).includes(f.type)) {
          ctx.addIssue({ code: "custom", path: [i], message: "errors.content_type.field_type_not_allowed", params: { type: f.type } });
        }
      }
    });
    if (countFields(fields) > CONTENT_LIMITS.fieldsPerType) {
      ctx.addIssue({ code: "custom", path: [], message: "errors.content_type.too_many_fields", params: { max: CONTENT_LIMITS.fieldsPerType } });
    }
  });

/** Fields of a definition counting container children individually. */
export function countFields(fields: readonly FieldDef[]): number {
  return fields.reduce((n, f) => n + 1 + (f.type === "group" || f.type === "repeater" ? f.validation.fields.length : 0), 0);
}

/** Parses a field definition written in code (built-in types); throws on a programming error. */
export function defineField(input: FieldDefInput): FieldDef {
  return fieldDefSchema.parse(input);
}

export function isContainerField(field: FieldDef): field is FieldOf<"group"> | FieldOf<"repeater"> {
  return field.type === "group" || field.type === "repeater";
}
