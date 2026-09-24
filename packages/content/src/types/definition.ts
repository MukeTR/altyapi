import { AppError, LOCALE_CODES, type LocaleCode } from "@altyapi/commerce-core";
import type { ContentTypeSettings, LocalizedText, contentTypes } from "@altyapi/database";
import { customFieldDefsSchema, defineField, type FieldDef, type FieldDefInput } from "../fields/types";

/**
 * Content type definitions (docs/platform/site-turleri-ve-cms.md §3.2, §4). Built-in types
 * live in code like section definitions, so platform updates reach every site; a
 * content_types row installs one for a store and keeps only the site-specific part (key,
 * labels, URL prefixes, hidden optional fields, extra custom fields, default sort).
 */

export type ContentTypeKind = "collection" | "singleton" | "taxonomy";

/** schema.org types a custom type may map to (plan §3.2); built-in types may use more specific ones. */
export const CUSTOM_SCHEMA_ORG_TYPES = ["Thing", "CreativeWork", "Article", "Service", "Place", "Event", "Person", "Organization", "DefinedTerm"] as const;
export type CustomSchemaOrgType = (typeof CUSTOM_SCHEMA_ORG_TYPES)[number];

export interface ContentTypeLabelsDef {
  name: LocalizedText;
  namePlural: LocalizedText;
}

/** A taxonomy a type classifies its entries with, and the URL segment of its archive (/blog/kategori/{term}). */
export interface TaxonomyBinding {
  /** multiReference field of the owning type that holds the term ids. */
  field: string;
  /** Built-in (or installed) taxonomy type key. */
  typeKey: string;
  /** Archive segment per language, under the owner's prefix. */
  archiveSegment: Record<LocaleCode, string>;
}

export interface ContentTypeDefinition {
  key: string;
  /** Bumped when the stored shape of entries changes; upgrade() migrates older data. */
  version: number;
  kind: ContentTypeKind;
  labels: ContentTypeLabelsDef;
  description: LocalizedText;
  /** Fields in editor order; routable types include the GEO fieldset. */
  fields: FieldDef[];
  /** Text field used as the entry name, H1 and default SEO title. */
  titleField: string;
  /** Short answer used as meta description fallback and card text. */
  summaryField: string | null;
  /** Image used on cards and as the default social image. */
  imageField: string | null;
  /** Default URL prefix per registry language; null when entries have no URL of their own. */
  routing: { prefixes: Record<LocaleCode, string> } | null;
  taxonomies: TaxonomyBinding[];
  /** Other built-in types installed with this one (its taxonomies and FAQ items). */
  requires: string[];
  schemaOrg: string;
  /** Settings a fresh install starts with (default sort, index mode, hidden optional fields…). */
  defaultSettings: ContentTypeSettings;
  /** Extra fields copied into the card projection (lists, related entries, FAQ blocks). */
  cardFields: string[];
  /**
   * Upgrade hook: brings entry data written against `fromVersion` up to `version`. Called for
   * entries whose schema_version is behind when they are loaded for editing or publishing.
   */
  upgrade?: ((data: Record<string, unknown>, fromVersion: number) => Record<string, unknown>) | undefined;
}

/**
 * Localized default prefixes: the listed languages as given, every other registry language
 * (ar, fa, az, nl, uk, ka…) with the English one.
 */
export function localizedDefaults(values: Partial<Record<LocaleCode, string>> & { en: string }): Record<LocaleCode, string> {
  return Object.fromEntries(LOCALE_CODES.map((code) => [code, values[code] ?? values.en])) as Record<LocaleCode, string>;
}

// ---------------------------------------------------------------------------
// GEO fieldset (plan §3.5)
// ---------------------------------------------------------------------------

export const GEO_FIELD_KEYS = ["summary", "keyFacts", "faq", "sources", "authors", "reviewedBy", "lastReviewedAt", "significantUpdate"] as const;
export type GeoFieldKey = (typeof GEO_FIELD_KEYS)[number];

/**
 * Fields every routable type gets: the short answer, key facts, FAQ references, sources,
 * authorship and review information, and the note that marks a significant update.
 * Authors and reviewers are names until the people module (Faz 3) provides verified person
 * records; they never point at fabricated person references.
 */
export function geoFieldset(options: { exclude?: GeoFieldKey[] } = {}): FieldDef[] {
  const all: Record<GeoFieldKey, FieldDefInput> = {
    summary: {
      key: "summary",
      type: "textarea",
      label: { tr: "Kısa cevap", en: "Short answer" },
      help: {
        tr: "40–80 kelimelik, tek başına anlaşılır özet. Meta açıklama, liste kartı ve yapay zekâ özetlerinde kullanılır.",
        en: "A 40–80 word summary that stands on its own. Used as meta description, card text and in AI summaries.",
      },
      localized: true,
      validation: { maxLength: 800 },
      searchable: true,
      significant: true,
      ui: { section: "geo" },
    },
    keyFacts: {
      key: "keyFacts",
      type: "keyFacts",
      label: { tr: "Öne çıkan bilgiler", en: "Key facts" },
      localized: true,
      significant: true,
      ui: { section: "geo" },
    },
    faq: {
      key: "faq",
      type: "multiReference",
      label: { tr: "Sık sorulan sorular", en: "FAQ" },
      help: { tr: "Bu sayfada gösterilecek SSS kayıtları.", en: "FAQ entries shown on this page." },
      validation: { to: "entry", typeKeys: ["faq_item"], maxItems: 20 },
      ui: { section: "geo" },
    },
    sources: {
      key: "sources",
      type: "sources",
      label: { tr: "Kaynaklar", en: "Sources" },
      help: { tr: "Metindeki bilgi ve istatistiklerin kaynakları.", en: "Where the facts and figures come from." },
      significant: true,
      ui: { section: "geo" },
    },
    authors: {
      key: "authors",
      type: "repeater",
      label: { tr: "Yazarlar", en: "Authors" },
      validation: {
        maxItems: 10,
        fields: [
          { key: "name", type: "text", label: { tr: "Ad soyad", en: "Full name" }, required: "always", validation: { maxLength: 120 } },
          { key: "role", type: "text", label: { tr: "Unvan", en: "Role" }, localized: true, validation: { maxLength: 120 } },
        ],
      },
      ui: { section: "geo" },
    },
    reviewedBy: {
      key: "reviewedBy",
      type: "text",
      label: { tr: "İnceleyen", en: "Reviewed by" },
      help: { tr: "İçeriği kontrol eden kişinin adı.", en: "Name of the person who checked the content." },
      validation: { maxLength: 120 },
      ui: { section: "geo" },
    },
    lastReviewedAt: {
      key: "lastReviewedAt",
      type: "date",
      label: { tr: "Son inceleme tarihi", en: "Last reviewed" },
      ui: { section: "geo" },
    },
    significantUpdate: {
      key: "significantUpdate",
      type: "textarea",
      label: { tr: "Önemli güncelleme notu", en: "Significant update note" },
      help: {
        tr: "Doldurulur veya değiştirilirse yayında “Son güncelleme” tarihi yenilenir ve not sayfada gösterilir.",
        en: "When filled in or changed, publishing refreshes the “Last updated” date and shows the note on the page.",
      },
      localized: true,
      validation: { maxLength: 300 },
      significant: true,
      ui: { section: "geo" },
    },
  };
  const exclude = new Set(options.exclude ?? []);
  return GEO_FIELD_KEYS.filter((k) => !exclude.has(k)).map((k) => defineField(all[k]));
}

/** Keys no custom field may use: entry columns, GEO fields and editor-reserved names. */
export const RESERVED_FIELD_KEYS = new Set<string>([
  "id", "type", "typeId", "slug", "slugs", "seo", "status", "locale", "locales", "parent", "parentId", "position", "createdAt", "updatedAt", "publishedAt",
  ...GEO_FIELD_KEYS,
]);

// ---------------------------------------------------------------------------
// Effective types (definition + site row)
// ---------------------------------------------------------------------------

export type ContentTypeRow = typeof contentTypes.$inferSelect;

export interface EffectiveContentType {
  id: string;
  key: string;
  kind: ContentTypeKind;
  status: ContentTypeRow["status"];
  builtin: ContentTypeDefinition | null;
  /** Schema version entries are written against. */
  version: number;
  labels: ContentTypeLabelsDef;
  /** Built-in fields followed by the site's custom fields (hidden ones included). */
  fields: FieldDef[];
  /** Keys of the site's custom fields. */
  customFieldKeys: Set<string>;
  hiddenFields: Set<string>;
  titleField: string;
  summaryField: string | null;
  imageField: string | null;
  /** Stored URL prefixes by language; empty when the type has no routes. */
  routePrefix: Record<string, string>;
  routable: boolean;
  /** Entries carry slugs: routable types and taxonomies (their terms get archive URLs). */
  hasSlugs: boolean;
  taxonomies: TaxonomyBinding[];
  settings: ContentTypeSettings;
  schemaOrg: string;
  cardFields: string[];
}

/** Standard title field of custom types (every entry has a name). */
export function customTitleField(): FieldDef {
  return defineField({
    key: "title",
    type: "text",
    label: { tr: "Başlık", en: "Title" },
    localized: true,
    required: "always",
    validation: { maxLength: 200 },
    searchable: true,
    listColumn: true,
    significant: true,
  });
}

/** The site's own fields of a type (extra fields of a built-in type, or all fields of a custom type). */
function parseStoredFields(row: ContentTypeRow): FieldDef[] {
  const parsed = customFieldDefsSchema.safeParse(row.customFields);
  if (!parsed.success) throw new AppError("internal", "errors.content_type.invalid_definition", { typeId: row.id });
  return parsed.data;
}

/** Resolves a stored type row against its code definition (or its custom fields). */
export function resolveContentType(row: ContentTypeRow, registry: (key: string) => ContentTypeDefinition | undefined): EffectiveContentType {
  const custom = parseStoredFields(row);
  const builtin = row.builtinKey ? (registry(row.builtinKey) ?? null) : null;
  if (row.builtinKey && !builtin) throw new AppError("internal", "errors.content_type.unknown_builtin", { builtinKey: row.builtinKey });
  const routable = Object.keys(row.routePrefix ?? {}).length > 0;
  const settings = row.settings ?? {};
  let fields: FieldDef[];
  if (builtin) {
    fields = [...builtin.fields, ...custom];
  } else {
    // Custom field keys never collide with GEO keys (RESERVED_FIELD_KEYS), and the stored
    // fields always start with the standard title field (added when the type is created).
    fields = routable ? [...custom, ...geoFieldset()] : custom;
  }
  // The cover image goes on cards and becomes the social image, so only a public field can be
  // it: an internal image (an intake photo kept for the admin) never reaches the storefront.
  const publicImage = (f: FieldDef) => f.type === "asset" && f.visibility === "public" && f.validation.kinds.includes("image");
  const imageField =
    builtin?.imageField ??
    fields.find((f) => publicImage(f) && (f.key === "image" || f.key === "coverImage"))?.key ??
    fields.find(publicImage)?.key ??
    null;
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    status: row.status,
    builtin,
    version: builtin?.version ?? 1,
    labels: row.labels,
    fields,
    customFieldKeys: new Set(custom.map((f) => f.key)),
    hiddenFields: new Set(settings.hiddenFields ?? []),
    titleField: builtin?.titleField ?? "title",
    summaryField: builtin ? builtin.summaryField : fields.some((f) => f.key === "summary") ? "summary" : null,
    imageField,
    routePrefix: row.routePrefix ?? {},
    routable,
    hasSlugs: routable || row.kind === "taxonomy",
    taxonomies: builtin?.taxonomies ?? [],
    settings,
    schemaOrg: builtin?.schemaOrg ?? "Thing",
    cardFields: builtin?.cardFields ?? fields.filter((f) => f.listColumn && f.visibility === "public").map((f) => f.key),
  };
}

/**
 * URL prefix of a type in a language: the stored prefix, else the English one, else any
 * stored one (a language added to the store after the type was installed still gets URLs).
 */
export function typePrefixFor(type: Pick<EffectiveContentType, "routePrefix">, locale: string): string | null {
  const p = type.routePrefix;
  if (!Object.keys(p).length) return null;
  return p[locale] ?? p.en ?? Object.values(p)[0] ?? null;
}

/** Whether a type answers /{prefix} itself (shared with the route table and the site profile checks). */
export { servesIndexRoute } from "@altyapi/site";

/** Sanity checks of a built-in definition (run when the registry loads, like the section registry sync). */
export function assertValidDefinition(def: ContentTypeDefinition, all: readonly ContentTypeDefinition[]): void {
  const keys = new Set<string>();
  for (const f of def.fields) {
    if (keys.has(f.key)) throw new Error(`content type ${def.key}: duplicate field ${f.key}`);
    keys.add(f.key);
  }
  if (!keys.has(def.titleField)) throw new Error(`content type ${def.key}: title field ${def.titleField} missing`);
  if (def.summaryField && !keys.has(def.summaryField)) throw new Error(`content type ${def.key}: summary field ${def.summaryField} missing`);
  if (def.imageField && !keys.has(def.imageField)) throw new Error(`content type ${def.key}: image field ${def.imageField} missing`);
  // Title, summary and cover image are shown on the storefront (H1, cards, meta and social tags).
  for (const key of [def.titleField, def.summaryField, def.imageField]) {
    if (key && def.fields.find((f) => f.key === key)?.visibility !== "public") throw new Error(`content type ${def.key}: field ${key} is shown on the storefront and must be public`);
  }
  for (const t of def.taxonomies) {
    const field = def.fields.find((f) => f.key === t.field);
    if (!field || field.type !== "multiReference" || field.validation.to !== "entry" || !field.validation.typeKeys?.includes(t.typeKey)) {
      throw new Error(`content type ${def.key}: taxonomy field ${t.field} must reference ${t.typeKey}`);
    }
    const target = all.find((d) => d.key === t.typeKey);
    if (!target || target.kind !== "taxonomy") throw new Error(`content type ${def.key}: ${t.typeKey} is not a taxonomy`);
  }
  for (const r of def.requires) if (!all.some((d) => d.key === r)) throw new Error(`content type ${def.key}: requires unknown type ${r}`);
  if (def.routing && !def.fields.some((f) => f.key === "summary")) throw new Error(`content type ${def.key}: routable types need the GEO fieldset`);
}
