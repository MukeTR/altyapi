import { LOCALE_CODES } from "@altyapi/commerce-core";
import { defineField, type FieldDefInput } from "../fields/types";
import { geoFieldset, localizedDefaults, type ContentTypeDefinition } from "./definition";

/**
 * Built-in content types of Faz 1 (docs/platform/site-turleri-ve-cms.md §4): post with its
 * category and tag taxonomies, service with its category, faq_item, legal_document and
 * document. Vertical packs rename and reconfigure them (hukuk: practice_area, publication)
 * through the site row, never by forking the code definition.
 */

const f = (input: FieldDefInput) => defineField(input);

const title = (label: { tr: string; en: string } = { tr: "Başlık", en: "Title" }) =>
  f({
    key: "title",
    type: "text",
    label,
    localized: true,
    required: "always",
    validation: { maxLength: 200 },
    searchable: true,
    listColumn: true,
    significant: true,
  });

const coverImage = () => f({ key: "coverImage", type: "asset", label: { tr: "Kapak görseli", en: "Cover image" }, validation: { kinds: ["image"] } });

const featured = () =>
  f({
    key: "featured",
    type: "boolean",
    label: { tr: "Öne çıkan", en: "Featured" },
    help: { tr: "Öne çıkan kayıtlar listelerde filtrelenebilir.", en: "Featured entries can be filtered in lists." },
    filterable: true,
    listColumn: true,
  });

const termTitle = () => title({ tr: "Ad", en: "Name" });
const termDescription = () =>
  f({ key: "description", type: "textarea", label: { tr: "Açıklama", en: "Description" }, localized: true, validation: { maxLength: 1_000 }, searchable: true });

const CATEGORY_SEGMENT = localizedDefaults({ tr: "kategori", en: "category", de: "kategorie", fr: "categorie", ru: "kategoriya" });

export const postType: ContentTypeDefinition = {
  key: "post",
  version: 1,
  kind: "collection",
  labels: {
    name: { tr: "Yazı", en: "Post", de: "Beitrag", fr: "Article", ru: "Статья", ar: "مقالة" },
    namePlural: { tr: "Yazılar", en: "Posts", de: "Beiträge", fr: "Articles", ru: "Статьи", ar: "مقالات" },
  },
  description: { tr: "Blog yazıları, haberler, makaleler ve duyurular.", en: "Blog posts, news, articles and announcements." },
  fields: [
    title(),
    f({ key: "body", type: "richDoc", label: { tr: "İçerik", en: "Body" }, localized: true, required: "publish", searchable: true, significant: true }),
    coverImage(),
    f({
      key: "categories",
      type: "multiReference",
      label: { tr: "Kategoriler", en: "Categories" },
      validation: { to: "entry", typeKeys: ["post_category"], maxItems: 10 },
      filterable: true,
      listColumn: true,
    }),
    f({ key: "tags", type: "multiReference", label: { tr: "Etiketler", en: "Tags" }, validation: { to: "entry", typeKeys: ["tag"], maxItems: 30 }, filterable: true }),
    featured(),
    ...geoFieldset(),
  ],
  titleField: "title",
  summaryField: "summary",
  imageField: "coverImage",
  routing: { prefixes: localizedDefaults({ tr: "blog", en: "blog", de: "blog", fr: "blog", ru: "blog" }) },
  taxonomies: [
    { field: "categories", typeKey: "post_category", archiveSegment: CATEGORY_SEGMENT },
    { field: "tags", typeKey: "tag", archiveSegment: localizedDefaults({ tr: "etiket", en: "tag", de: "schlagwort", fr: "etiquette", ru: "teg" }) },
  ],
  requires: ["post_category", "tag"],
  schemaOrg: "BlogPosting",
  defaultSettings: { defaultSort: { field: "publishedAt", direction: "desc" }, indexMode: "auto" },
  cardFields: ["categories", "tags", "featured"],
};

export const postCategoryType: ContentTypeDefinition = {
  key: "post_category",
  version: 1,
  kind: "taxonomy",
  labels: {
    name: { tr: "Yazı kategorisi", en: "Post category", de: "Beitragskategorie", fr: "Catégorie d’articles", ru: "Категория статей", ar: "تصنيف المقالات" },
    namePlural: { tr: "Yazı kategorileri", en: "Post categories", de: "Beitragskategorien", fr: "Catégories d’articles", ru: "Категории статей", ar: "تصنيفات المقالات" },
  },
  description: { tr: "Yazıları konularına göre gruplar.", en: "Groups posts by topic." },
  fields: [termTitle(), termDescription(), f({ key: "image", type: "asset", label: { tr: "Görsel", en: "Image" }, validation: { kinds: ["image"] } })],
  titleField: "title",
  summaryField: "description",
  imageField: "image",
  routing: null,
  taxonomies: [],
  requires: [],
  schemaOrg: "DefinedTerm",
  defaultSettings: { defaultSort: { field: "position", direction: "asc" }, hierarchical: true, maxDepth: 3, indexMode: "none" },
  cardFields: [],
};

export const tagType: ContentTypeDefinition = {
  key: "tag",
  version: 1,
  kind: "taxonomy",
  labels: {
    name: { tr: "Etiket", en: "Tag", de: "Schlagwort", fr: "Étiquette", ru: "Тег", ar: "وسم" },
    namePlural: { tr: "Etiketler", en: "Tags", de: "Schlagwörter", fr: "Étiquettes", ru: "Теги", ar: "وسوم" },
  },
  description: { tr: "Yazıları serbest anahtar kelimelerle işaretler.", en: "Marks posts with free keywords." },
  fields: [termTitle(), termDescription()],
  titleField: "title",
  summaryField: "description",
  imageField: null,
  routing: null,
  taxonomies: [],
  requires: [],
  schemaOrg: "DefinedTerm",
  defaultSettings: { defaultSort: { field: "title", direction: "asc" }, indexMode: "none" },
  cardFields: [],
};

export const serviceType: ContentTypeDefinition = {
  key: "service",
  version: 1,
  kind: "collection",
  labels: {
    name: { tr: "Hizmet", en: "Service", de: "Leistung", fr: "Service", ru: "Услуга", ar: "خدمة" },
    namePlural: { tr: "Hizmetler", en: "Services", de: "Leistungen", fr: "Services", ru: "Услуги", ar: "خدمات" },
  },
  description: {
    tr: "Bilgi amaçlı hizmet sayfaları. Satılan veya randevu alınan hizmetler ürün olarak tanımlanır ve buradan bağlanır.",
    en: "Informational service pages. Services that are sold or booked are products and are linked from here.",
  },
  fields: [
    title(),
    f({ key: "body", type: "richDoc", label: { tr: "Açıklama", en: "Description" }, localized: true, required: "publish", searchable: true, significant: true }),
    coverImage(),
    f({
      key: "categories",
      type: "multiReference",
      label: { tr: "Hizmet kategorileri", en: "Service categories" },
      validation: { to: "entry", typeKeys: ["service_category"], maxItems: 5 },
      filterable: true,
      listColumn: true,
    }),
    featured(),
    f({
      key: "areaServed",
      type: "text",
      label: { tr: "Hizmet bölgesi", en: "Area served" },
      help: { tr: "Örn. “İstanbul Anadolu Yakası” veya “Türkiye geneli”.", en: "E.g. “Istanbul” or “Nationwide”." },
      localized: true,
      validation: { maxLength: 200 },
    }),
    f({
      key: "relatedProducts",
      type: "multiReference",
      label: { tr: "Satın alınabilir hizmetler", en: "Bookable or purchasable services" },
      help: {
        tr: "Bu hizmetin satın alınabilen veya randevu alınabilen ürünleri (fiyat, vergi ve sipariş ürün modelinde kalır).",
        en: "Products through which this service is bought or booked (price, tax and orders stay on the product).",
      },
      validation: { to: "product", maxItems: 20 },
    }),
    f({ key: "relatedServices", type: "multiReference", label: { tr: "İlgili hizmetler", en: "Related services" }, validation: { to: "entry", typeKeys: ["service"], maxItems: 12 } }),
    ...geoFieldset(),
  ],
  titleField: "title",
  summaryField: "summary",
  imageField: "coverImage",
  routing: { prefixes: localizedDefaults({ tr: "hizmetler", en: "services", de: "leistungen", fr: "services", ru: "uslugi" }) },
  taxonomies: [{ field: "categories", typeKey: "service_category", archiveSegment: CATEGORY_SEGMENT }],
  requires: ["service_category"],
  schemaOrg: "Service",
  defaultSettings: { defaultSort: { field: "position", direction: "asc" }, hierarchical: true, maxDepth: 2, indexMode: "auto" },
  cardFields: ["categories", "featured", "areaServed"],
};

export const serviceCategoryType: ContentTypeDefinition = {
  key: "service_category",
  version: 1,
  kind: "taxonomy",
  labels: {
    name: { tr: "Hizmet kategorisi", en: "Service category", de: "Leistungskategorie", fr: "Catégorie de services", ru: "Категория услуг", ar: "فئة الخدمات" },
    namePlural: { tr: "Hizmet kategorileri", en: "Service categories", de: "Leistungskategorien", fr: "Catégories de services", ru: "Категории услуг", ar: "فئات الخدمات" },
  },
  description: { tr: "Hizmetleri gruplar.", en: "Groups services." },
  fields: [termTitle(), termDescription(), f({ key: "image", type: "asset", label: { tr: "Görsel", en: "Image" }, validation: { kinds: ["image"] } })],
  titleField: "title",
  summaryField: "description",
  imageField: "image",
  routing: null,
  taxonomies: [],
  requires: [],
  schemaOrg: "DefinedTerm",
  defaultSettings: { defaultSort: { field: "position", direction: "asc" }, indexMode: "none" },
  cardFields: [],
};

export const faqItemType: ContentTypeDefinition = {
  key: "faq_item",
  version: 1,
  kind: "collection",
  labels: {
    name: { tr: "Soru", en: "Question", de: "Frage", fr: "Question", ru: "Вопрос", ar: "سؤال" },
    namePlural: { tr: "Sık sorulan sorular", en: "Frequently asked questions", de: "Häufige Fragen", fr: "Questions fréquentes", ru: "Частые вопросы", ar: "الأسئلة الشائعة" },
  },
  description: {
    tr: "Soru ve cevaplar. SSS sayfasında, bölümlerde ve diğer içeriklerin SSS alanında kullanılır.",
    en: "Questions and answers, shown on the FAQ page, in sections and in the FAQ field of other content.",
  },
  fields: [
    f({
      key: "question",
      type: "text",
      label: { tr: "Soru", en: "Question" },
      localized: true,
      required: "always",
      validation: { maxLength: 300 },
      searchable: true,
      listColumn: true,
      significant: true,
    }),
    f({
      key: "answer",
      type: "richDoc",
      label: { tr: "Cevap", en: "Answer" },
      localized: true,
      required: "publish",
      validation: { nodes: ["paragraph", "bulletList", "orderedList", "table", "callout", "image"], maxChars: 20_000 },
      searchable: true,
      significant: true,
    }),
    ...geoFieldset({ exclude: ["faq"] }),
  ],
  titleField: "question",
  summaryField: null,
  imageField: null,
  routing: { prefixes: localizedDefaults({ tr: "sss", en: "faq", de: "faq", fr: "faq", ru: "faq" }) },
  taxonomies: [],
  requires: [],
  schemaOrg: "Question",
  defaultSettings: { defaultSort: { field: "position", direction: "asc" }, indexMode: "auto", hiddenFields: ["summary", "keyFacts", "authors", "reviewedBy"] },
  cardFields: ["answer"],
};

export const legalDocumentType: ContentTypeDefinition = {
  key: "legal_document",
  version: 1,
  kind: "collection",
  labels: {
    name: { tr: "Yasal metin", en: "Legal document", de: "Rechtstext", fr: "Document juridique", ru: "Правовой документ", ar: "وثيقة قانونية" },
    namePlural: { tr: "Yasal metinler", en: "Legal documents", de: "Rechtstexte", fr: "Documents juridiques", ru: "Правовые документы", ar: "وثائق قانونية" },
  },
  description: {
    tr: "KVKK aydınlatma metni, çerez politikası, mesafeli satış sözleşmesi gibi sürümlü yasal metinler.",
    en: "Versioned legal texts: privacy notice, cookie policy, distance sales contract and similar.",
  },
  fields: [
    title(),
    f({
      key: "documentKind",
      type: "select",
      label: { tr: "Metin türü", en: "Document kind" },
      required: "publish",
      filterable: true,
      listColumn: true,
      validation: {
        options: [
          { value: "kvkk_aydinlatma", label: { tr: "KVKK aydınlatma metni", en: "Privacy notice (KVKK)" } },
          { value: "acik_riza", label: { tr: "Açık rıza metni", en: "Explicit consent text" } },
          { value: "cerez_politikasi", label: { tr: "Çerez politikası", en: "Cookie policy" } },
          { value: "gizlilik_politikasi", label: { tr: "Gizlilik politikası", en: "Privacy policy" } },
          { value: "mesafeli_satis", label: { tr: "Mesafeli satış sözleşmesi", en: "Distance sales contract" } },
          { value: "on_bilgilendirme", label: { tr: "Ön bilgilendirme formu", en: "Pre-contract information" } },
          { value: "iade_iptal", label: { tr: "İade ve iptal koşulları", en: "Returns and cancellation" } },
          { value: "kullanim_kosullari", label: { tr: "Kullanım koşulları", en: "Terms of use" } },
          { value: "uyelik_sozlesmesi", label: { tr: "Üyelik sözleşmesi", en: "Membership agreement" } },
          { value: "kunye", label: { tr: "Künye", en: "Imprint" } },
          { value: "diger", label: { tr: "Diğer", en: "Other" } },
        ],
      },
    }),
    f({
      key: "body",
      type: "richDoc",
      label: { tr: "Metin", en: "Text" },
      localized: true,
      required: "publish",
      validation: { nodes: ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "table", "callout"] },
      searchable: true,
      significant: true,
    }),
    f({ key: "effectiveDate", type: "date", label: { tr: "Yürürlük tarihi", en: "Effective date" }, required: "publish", significant: true, listColumn: true }),
    f({
      key: "versionLabel",
      type: "text",
      label: { tr: "Sürüm", en: "Version" },
      help: { tr: "Örn. “v2” veya “2026-09”.", en: "E.g. “v2” or “2026-09”." },
      validation: { maxLength: 40 },
      listColumn: true,
    }),
    ...geoFieldset(),
  ],
  titleField: "title",
  summaryField: "summary",
  imageField: null,
  routing: {
    prefixes: localizedDefaults({ tr: "yasal", en: "legal", de: "rechtliches", fr: "mentions-legales", ru: "pravovaya-informatsiya" }),
  },
  taxonomies: [],
  requires: [],
  schemaOrg: "CreativeWork",
  defaultSettings: { defaultSort: { field: "title", direction: "asc" }, indexMode: "auto", hiddenFields: ["keyFacts", "faq", "authors", "reviewedBy", "sources"] },
  cardFields: ["documentKind", "effectiveDate", "versionLabel"],
};

export const documentType: ContentTypeDefinition = {
  key: "document",
  version: 1,
  kind: "collection",
  labels: {
    name: { tr: "Belge", en: "Document", de: "Dokument", fr: "Document", ru: "Документ", ar: "مستند" },
    namePlural: { tr: "Belgeler", en: "Documents", de: "Dokumente", fr: "Documents", ru: "Документы", ar: "مستندات" },
  },
  description: {
    tr: "Katalog, broşür, sertifika ve teknik föy gibi indirilebilir belgeler.",
    en: "Downloadable documents: catalogs, brochures, certificates, data sheets.",
  },
  fields: [
    title(),
    f({ key: "description", type: "textarea", label: { tr: "Açıklama", en: "Description" }, localized: true, validation: { maxLength: 2_000 }, searchable: true }),
    f({
      key: "file",
      type: "asset",
      label: { tr: "Dosya", en: "File" },
      required: "publish",
      validation: { kinds: ["document"] },
      significant: true,
    }),
    f({
      key: "documentType",
      type: "select",
      label: { tr: "Belge türü", en: "Document type" },
      filterable: true,
      listColumn: true,
      validation: {
        options: [
          { value: "catalog", label: { tr: "Katalog", en: "Catalog" } },
          { value: "brochure", label: { tr: "Broşür", en: "Brochure" } },
          { value: "certificate", label: { tr: "Sertifika", en: "Certificate" } },
          { value: "datasheet", label: { tr: "Teknik föy", en: "Data sheet" } },
          { value: "manual", label: { tr: "Kılavuz", en: "Manual" } },
          { value: "policy", label: { tr: "Politika", en: "Policy" } },
          { value: "report", label: { tr: "Rapor", en: "Report" } },
          { value: "other", label: { tr: "Diğer", en: "Other" } },
        ],
      },
    }),
    f({
      key: "documentLanguages",
      type: "multiSelect",
      label: { tr: "Belgenin dili", en: "Document language" },
      validation: { options: LOCALE_CODES.map((code) => ({ value: code, label: { tr: code.toUpperCase(), en: code.toUpperCase() } })) },
    }),
    f({ key: "validFrom", type: "date", label: { tr: "Geçerlilik başlangıcı", en: "Valid from" } }),
    f({ key: "validUntil", type: "date", label: { tr: "Geçerlilik bitişi", en: "Valid until" }, listColumn: true, significant: true }),
    coverImage(),
    ...geoFieldset(),
  ],
  titleField: "title",
  summaryField: "description",
  imageField: "coverImage",
  routing: { prefixes: localizedDefaults({ tr: "belgeler", en: "documents", de: "dokumente", fr: "documents", ru: "dokumenty" }) },
  taxonomies: [],
  requires: [],
  schemaOrg: "DigitalDocument",
  defaultSettings: { defaultSort: { field: "publishedAt", direction: "desc" }, indexMode: "auto", hiddenFields: ["keyFacts", "faq", "authors", "reviewedBy"] },
  cardFields: ["documentType", "file", "validUntil", "documentLanguages"],
};
