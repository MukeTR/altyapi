import { objectDefaults } from "./schema";
import type { BlockInstance, Placement, SectionDefinition, SectionInstance } from "./types";

/** The API refuses more sections than this on one page or in the global tree. */
export const MAX_SECTIONS = 60;

/** Newest version of every section type, in the order the API lists them. */
export function latestDefinitions(defs: readonly SectionDefinition[]): SectionDefinition[] {
  const latest = new Map<string, SectionDefinition>();
  for (const d of defs) {
    const cur = latest.get(d.type);
    if (!cur || cur.version < d.version) latest.set(d.type, d);
  }
  return [...latest.values()];
}

/** Definition of an instance: its pinned version, else the newest one. */
export function definitionOf(defs: readonly SectionDefinition[], type: string, version?: number): SectionDefinition | undefined {
  if (version !== undefined) {
    const exact = defs.find((d) => d.type === type && d.version === version);
    if (exact) return exact;
  }
  return latestDefinitions(defs.filter((d) => d.type === type))[0];
}

/**
 * Sections that must exist exactly once on a placement and cannot be removed or hidden (header
 * and footer globally, the main section of product/collection/cart/search/404 templates). Older
 * APIs do not send requiredIn; there every singleton limited to one placement is required.
 */
export function isRequiredOn(def: SectionDefinition | undefined, placement: Placement): boolean {
  if (!def) return false;
  const required = def.requiredIn ?? (def.singleton && def.allowedIn.length === 1 ? def.allowedIn : []);
  return required.includes(placement);
}

export type Unavailable =
  | { reason: "placement"; allowed: Placement[] }
  | { reason: "singleton" }
  | { reason: "module"; module: string }
  | { reason: "limit" }
  | { reason: "template" };

const PLACEMENTS: readonly Placement[] = ["global", "home", "page", "landing", "collection", "product", "cart", "search", "not_found"];

/**
 * Why a section cannot be added to a placement, or null when it can. Template sections of other
 * page types are reported separately so the library can leave them out entirely.
 */
export function unavailableReason(
  def: SectionDefinition,
  placement: Placement,
  sections: readonly SectionInstance[],
  storeModules: readonly string[] | null,
): Unavailable | null {
  if (!def.allowedIn.includes(placement)) {
    if (def.category === "template") return { reason: "template" };
    return { reason: "placement", allowed: PLACEMENTS.filter((p) => def.allowedIn.includes(p)) };
  }
  if (def.module && storeModules && !storeModules.includes(def.module)) return { reason: "module", module: def.module };
  if (def.singleton && sections.some((s) => s.type === def.type)) return { reason: "singleton" };
  if (sections.length >= MAX_SECTIONS) return { reason: "limit" };
  return null;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** A new section instance with the definition's defaults and a client-side id (the API keeps it). */
export function newSection(def: SectionDefinition): SectionInstance {
  return {
    id: newId(),
    type: def.type,
    version: def.version,
    props: { ...objectDefaults(def.props, def.props), ...structuredClone(def.defaults) },
  };
}

export function newBlock(def: SectionDefinition, blockType: string): BlockInstance {
  const schema = def.blocks[blockType];
  return { id: newId(), type: blockType, props: schema ? objectDefaults(schema, schema) : {} };
}

/** Deep copy with fresh ids for the section and its blocks. */
export function duplicateSection(section: SectionInstance): SectionInstance {
  const copy = structuredClone(section);
  copy.id = newId();
  if (copy.blocks) copy.blocks = copy.blocks.map((b) => ({ ...b, id: newId() }));
  return copy;
}

/** Whether the definition supports blocks at all and whether another one fits. */
export function canAddBlock(def: SectionDefinition | undefined, section: SectionInstance): boolean {
  if (!def || Object.keys(def.blocks).length === 0) return false;
  return def.maxBlocks === null || (section.blocks?.length ?? 0) < def.maxBlocks;
}

function firstText(value: unknown, locale: string, fallbackLocale: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const map = value as Record<string, unknown>;
  const text = map[locale] ?? map[fallbackLocale];
  return typeof text === "string" && text.trim() ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null;
}

const SUMMARY_KEYS = ["heading", "title", "text", "question", "label", "quote", "alt", "name", "author"];

/** Short description of an instance for the tree (its heading or first text), if it has one. */
export function instanceSummary(props: Record<string, unknown>, locale: string, fallbackLocale: string): string | null {
  for (const key of SUMMARY_KEYS) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    const text = firstText(v, locale, fallbackLocale);
    if (text) return text;
  }
  return null;
}

function emptyObject(value: unknown): boolean {
  return !value || (typeof value === "object" && Object.values(value).every((v) => v === undefined || (Array.isArray(v) && v.length === 0)));
}

/** Instance as sent to the API: empty settings and visibility objects are left out. */
export function toSectionInput(section: SectionInstance): SectionInstance {
  const { settings, visibility, blocks, disabled, ...rest } = section;
  return {
    ...rest,
    ...(settings && !emptyObject(settings) ? { settings } : {}),
    ...(visibility && !emptyObject(visibility) ? { visibility } : {}),
    ...(blocks && blocks.length ? { blocks } : {}),
    ...(disabled ? { disabled: true } : {}),
  };
}

/** Moves an item inside an array (returns a new array). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
