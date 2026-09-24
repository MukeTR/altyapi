import type { Database, LocalizedText, SectionInstance } from "@altyapi/database";
import { loadLiveSnapshot, resolvePage, type StorefrontSnapshot } from "@altyapi/theme-engine";
import { stripHtml } from "@altyapi/catalog";

/**
 * Facts about the live storefront that the exports report (structured data, canonical
 * paths). They are derived from the same published snapshot the storefront renders.
 */

export interface StorefrontFacts {
  snapshot: StorefrontSnapshot | null;
  /** The live product template renders product-main, which emits Product JSON-LD. */
  productJsonLd: boolean;
  /** The live collection template renders collection-main, which emits ItemList JSON-LD. */
  collectionItemList: boolean;
}

/** Same rule as the storefront: disabled sections and sections outside their schedule are not rendered. */
export function isRendered(s: SectionInstance, now: Date): boolean {
  if (s.disabled) return false;
  const start = s.visibility?.startsAt ? Date.parse(s.visibility.startsAt) : null;
  const end = s.visibility?.endsAt ? Date.parse(s.visibility.endsAt) : null;
  if (start !== null && start > now.getTime()) return false;
  if (end !== null && end <= now.getTime()) return false;
  return true;
}

export async function loadStorefrontFacts(db: Database, ref: { organizationId: string; storeId: string }, now: Date = new Date()): Promise<StorefrontFacts> {
  const snapshot = await loadLiveSnapshot(db, ref);
  if (!snapshot) return { snapshot: null, productJsonLd: false, collectionItemList: false };
  const [product, collection] = await Promise.all([resolvePage(db, ref, snapshot, "product", "default"), resolvePage(db, ref, snapshot, "collection", "default")]);
  const has = (page: typeof product, type: string) => Boolean(page?.content.sections.some((s) => s.type === type && isRendered(s, now)));
  return { snapshot, productJsonLd: has(product, "product-main"), collectionItemList: has(collection, "collection-main") };
}

export function pickLocalized(map: LocalizedText | null | undefined, locale: string, fallback: string): string {
  if (!map || typeof map !== "object") return "";
  return map[locale] || map[fallback] || Object.values(map).find(Boolean) || "";
}

function isLocalizedMap(value: unknown): value is LocalizedText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([k, v]) => /^[a-z]{2}$/.test(k) && typeof v === "string");
}

/** Section props that carry page text (see packages/theme-engine/src/sections/definitions.ts). */
const TEXT_PROPS = new Set(["heading", "subheading", "title", "body", "text", "description", "quote", "question", "answer", "caption"]);

/**
 * Plain-text excerpt of a page: the localized text props of its rendered sections and
 * blocks (headings, rich text, quotes, FAQ questions and answers), HTML removed. Labels,
 * placeholders, alt texts and form messages are not page text and are skipped.
 */
export function sectionsExcerpt(sections: SectionInstance[], locale: string, fallback: string, now: Date, max = 1000): string {
  const parts: string[] = [];
  let length = 0;
  const take = (props: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(props)) {
      if (length > max * 2 || !TEXT_PROPS.has(key) || !isLocalizedMap(value)) continue;
      const text = pickLocalized(value, locale, fallback);
      if (!text) continue;
      parts.push(text);
      length += text.length + 1;
    }
  };
  for (const s of sections) {
    if (!isRendered(s, now)) continue;
    take(s.props);
    for (const b of s.blocks ?? []) take(b.props);
  }
  return stripHtml(parts.join(" ")).slice(0, max);
}

/** JSON-LD types the storefront emits for a page's sections (FAQ sections emit FAQPage). */
export function sectionJsonLdTypes(sections: SectionInstance[], now: Date): string[] {
  const types = new Set<string>();
  for (const s of sections) {
    if (!isRendered(s, now)) continue;
    if (s.type === "faq" && (s.props as Record<string, unknown>).emitStructuredData !== false && (s.blocks ?? []).some((b) => b.type === "item")) types.add("FAQPage");
  }
  return [...types];
}
