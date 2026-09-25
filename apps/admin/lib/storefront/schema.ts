import type { JsonSchema } from "./types";

/**
 * Turns the JSON Schemas of section definitions (GET /v1/section-definitions) into form widgets.
 * The schemas carry no titles or widget hints, so the widget is inferred from the schema shape
 * and, for references (assets, collections, menus), from the property name.
 */

export type FieldSpec =
  | { kind: "localizedText"; maxLength: number; multiline: boolean }
  | { kind: "localizedRichHtml"; maxLength: number }
  | { kind: "localizedRichDoc" }
  | { kind: "asset"; nullable: boolean }
  | { kind: "link"; nullable: boolean; labelMaxLength: number }
  | { kind: "href"; nullable: boolean }
  | { kind: "url"; nullable: boolean }
  | { kind: "colorScheme"; options: string[] }
  | { kind: "enum"; options: string[]; nullable: boolean }
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean; min: number | null; max: number | null; nullable: boolean }
  | { kind: "text"; maxLength: number | null; nullable: boolean; pattern: string | null }
  | { kind: "datetime"; nullable: boolean }
  | { kind: "collection"; nullable: boolean }
  | { kind: "products"; maxItems: number | null }
  | { kind: "menu" }
  | { kind: "menus"; maxItems: number | null }
  | { kind: "stringList"; maxItems: number | null; itemMaxLength: number | null }
  | { kind: "objectList"; item: JsonSchema; maxItems: number | null }
  | { kind: "object"; schema: JsonSchema }
  | { kind: "union"; discriminator: string; variants: { value: string; schema: JsonSchema }[] }
  /** References to data the admin cannot pick yet (campaigns, content entries, segments): kept as is. */
  | { kind: "hidden" }
  | { kind: "unsupported" };

const LOCALE_KEY_HINT = "tr";

/** Resolves a local "#/$defs/x" reference against the root schema. */
export function deref(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let s = schema;
  for (let i = 0; i < 8 && s.$ref; i++) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    const next = m?.[1] ? root.$defs?.[m[1]] : undefined;
    if (!next) break;
    s = next;
  }
  return s;
}

function isNull(s: JsonSchema): boolean {
  return s.type === "null";
}

/** Unwraps `anyOf: [X, null]` into X plus a nullable flag. */
export function unwrapNullable(schema: JsonSchema, root: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const s = deref(schema, root);
  if (s.anyOf && s.anyOf.length === 2 && s.anyOf.some(isNull)) {
    const inner = s.anyOf.find((x) => !isNull(x));
    if (inner) return { schema: { ...deref(inner, root), ...(s.default !== undefined ? { default: s.default } : {}) }, nullable: true };
  }
  if (Array.isArray(s.type) && s.type.includes("null")) {
    const rest = s.type.filter((t) => t !== "null");
    return { schema: { ...s, type: rest.length === 1 ? rest[0] : rest }, nullable: true };
  }
  return { schema: s, nullable: false };
}

/** Object keyed by locale codes (`{ tr: "…", en: "…" }`). */
export function isLocalizedMap(s: JsonSchema): boolean {
  const names = s.propertyNames?.enum;
  return s.type === "object" && Array.isArray(names) && names.includes(LOCALE_KEY_HINT) && typeof s.additionalProperties === "object";
}

function isRichDoc(s: JsonSchema, root: JsonSchema): boolean {
  const d = deref(s, root);
  return d.type === "object" && d.properties?.type?.const === "doc";
}

function isUuid(s: JsonSchema): boolean {
  return s.type === "string" && s.format === "uuid";
}

function isLinkObject(s: JsonSchema, root: JsonSchema): boolean {
  const p = s.properties;
  return s.type === "object" && Boolean(p?.href) && Boolean(p?.label) && isLocalizedMap(deref(p!.label!, root));
}

/** Short localized text above this length is edited in a multi-line box. */
const MULTILINE_FROM = 200;
/** Localized strings longer than this are sanitized rich text (HTML), not plain text. */
const RICH_TEXT_FROM = 600;

export function classifyField(key: string, raw: JsonSchema, root: JsonSchema): FieldSpec {
  const { schema: s, nullable } = unwrapNullable(raw, root);

  if (isLocalizedMap(s)) {
    const value = deref(s.additionalProperties as JsonSchema, root);
    if (isRichDoc(value, root)) return { kind: "localizedRichDoc" };
    const max = value.maxLength ?? 300;
    if (value.type === "string" && max > RICH_TEXT_FROM) return { kind: "localizedRichHtml", maxLength: max };
    if (value.type === "string") return { kind: "localizedText", maxLength: max, multiline: max >= MULTILINE_FROM };
    return { kind: "unsupported" };
  }

  if (key === "campaignId" || key === "segmentIds" || key === "entryIds" || key === "termIds" || key === "locationId" || key === "locationIds") return { kind: "hidden" };

  if (isUuid(s)) {
    if (/AssetId$/.test(key) || key === "assetId") return { kind: "asset", nullable };
    if (key === "collectionId") return { kind: "collection", nullable };
    return { kind: "hidden" };
  }

  if (s.type === "string") {
    if (key === "colorScheme" && s.enum) return { kind: "colorScheme", options: s.enum.map(String) };
    if (s.enum) return { kind: "enum", options: s.enum.map(String), nullable };
    if (s.format === "date-time") return { kind: "datetime", nullable };
    if (s.format === "uri") return { kind: "url", nullable };
    if (key === "menuHandle") return { kind: "menu" };
    if (/^(link|href)$/i.test(key)) return { kind: "href", nullable };
    return { kind: "text", maxLength: s.maxLength ?? null, nullable, pattern: s.pattern ?? null };
  }

  if (s.type === "boolean") return { kind: "boolean" };
  if (s.type === "integer" || s.type === "number") {
    return { kind: "number", integer: s.type === "integer", min: s.minimum ?? null, max: s.maximum ?? null, nullable };
  }

  if (s.type === "array" && s.items) {
    const item = unwrapNullable(s.items, root).schema;
    if (key === "productIds" && isUuid(item)) return { kind: "products", maxItems: s.maxItems ?? null };
    if (key === "menuHandles" && item.type === "string") return { kind: "menus", maxItems: s.maxItems ?? null };
    if (isUuid(item)) return { kind: "hidden" };
    if (item.type === "string" && !item.enum) return { kind: "stringList", maxItems: s.maxItems ?? null, itemMaxLength: item.maxLength ?? null };
    if (item.type === "object") return { kind: "objectList", item, maxItems: s.maxItems ?? null };
    return { kind: "unsupported" };
  }

  if (s.type === "object" && isLinkObject(s, root)) {
    const label = deref(deref(s.properties!.label!, root).additionalProperties as JsonSchema, root);
    return { kind: "link", nullable, labelMaxLength: label.maxLength ?? 80 };
  }

  const variants = s.oneOf ?? s.anyOf;
  if (variants && variants.length > 1) {
    const resolved = variants.map((v) => deref(v, root));
    const discriminator = "type";
    if (resolved.every((v) => v.type === "object" && typeof v.properties?.[discriminator]?.const === "string")) {
      return { kind: "union", discriminator, variants: resolved.map((v) => ({ value: String(v.properties![discriminator]!.const), schema: v })) };
    }
    return { kind: "unsupported" };
  }

  if (s.type === "object" && s.properties) return { kind: "object", schema: s };
  return { kind: "unsupported" };
}

/** Default value of a schema node (explicit default, else an empty value of its type). */
export function schemaDefault(raw: JsonSchema, root: JsonSchema): unknown {
  const s = deref(raw, root);
  if (s.default !== undefined) return structuredClone(s.default);
  const { schema, nullable } = unwrapNullable(s, root);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (nullable) return null;
  if (isLocalizedMap(schema)) return {};
  switch (schema.type) {
    case "string":
      return schema.enum?.[0] ?? "";
    case "boolean":
      return false;
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (schema.required?.includes(k) || deref(v, root).default !== undefined) out[k] = schemaDefault(v, root);
      }
      return out;
    }
    default:
      return null;
  }
}

/** Initial props of a new block or list item: every property that has a default. */
export function objectDefaults(schema: JsonSchema, root: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(deref(schema, root).properties ?? {})) {
    const d = deref(v, root);
    const inner = unwrapNullable(d, root);
    if (d.default !== undefined) out[k] = structuredClone(d.default);
    else if (inner.nullable) out[k] = null;
    else if (isLocalizedMap(inner.schema)) out[k] = {};
  }
  return out;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Required properties that have no value yet (e.g. a new category card without its collection,
 * a countdown without an end date). Saving such content would be refused by the API, so the
 * editor asks for them first.
 */
export function missingRequired(schema: JsonSchema, value: Record<string, unknown>, root: JsonSchema): string[] {
  const s = deref(schema, root);
  return (s.required ?? []).filter((k) => {
    const prop = s.properties?.[k];
    if (!prop) return false;
    const { nullable } = unwrapNullable(prop, root);
    return !nullable && isEmpty(value[k]);
  });
}

/** Fallback label for a property the interface has no translation for ("columnsDesktop" → "Columns desktop"). */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
