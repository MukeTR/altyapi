import type { SeoFields } from "@altyapi/database";
import { isInternalTarget, type LinkTarget } from "../links";
import { collectRefs } from "../rich/render";
import type { RichDoc } from "../rich/schema";
import type { FieldDef, LeafFieldDef } from "./types";
import type { AssetUsage, LinkValue, VideoValue } from "./values";

/** Kinds a content_references row can point at. */
export type RefTargetKind = "entry" | "page" | "product" | "collection" | "asset" | "location";

export interface EntryRef {
  targetKind: RefTargetKind;
  targetId: string;
  /** Where in the entry the reference sits ("body.tr", "faq", "gallery.2", "seo.imageAssetId"). */
  fieldPath: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** [locale | null, value] pairs of a field value (one pair for non-localized fields). */
function perLocale(field: LeafFieldDef | FieldDef, value: unknown): [string | null, unknown][] {
  if (!field.localized) return [[null, value]];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

function leafRefs(field: LeafFieldDef, value: unknown, basePath: string, out: EntryRef[]): void {
  for (const [locale, v] of perLocale(field, value)) {
    if (v === null || v === undefined) continue;
    const path = locale ? `${basePath}.${locale}` : basePath;
    const add = (targetKind: RefTargetKind, id: unknown, suffix = "") => {
      if (typeof id === "string" && UUID.test(id)) out.push({ targetKind, targetId: id.toLowerCase(), fieldPath: path + suffix });
    };
    const addTarget = (t: LinkTarget | undefined, suffix = "") => {
      if (t && isInternalTarget(t)) add(t.type, t.id, suffix);
    };
    switch (field.type) {
      case "richDoc":
        if (typeof v === "object" && Array.isArray((v as RichDoc).content)) for (const r of collectRefs(v as RichDoc)) add(r.kind, r.id);
        break;
      case "asset":
        add("asset", (v as AssetUsage).assetId);
        break;
      case "gallery":
        if (Array.isArray(v)) (v as AssetUsage[]).forEach((a, i) => add("asset", a?.assetId, `.${i}`));
        break;
      case "video":
        add("asset", (v as VideoValue).captionsAssetId);
        break;
      case "link":
        addTarget((v as LinkValue).target);
        break;
      case "reference":
        add(field.validation.to, v);
        break;
      case "multiReference":
        if (Array.isArray(v)) v.forEach((id) => add(field.validation.to, id));
        break;
      default:
        break;
    }
  }
}

/**
 * Every record an entry points at, for content_references (reverse lists, "used in", delete
 * protection, publish dependency checks, link resolution, cache purge) and asset_references.
 */
export function collectEntryRefs(
  fields: readonly FieldDef[],
  data: Record<string, unknown>,
  extra: { seo?: SeoFields | null; parentId?: string | null } = {},
): EntryRef[] {
  const out: EntryRef[] = [];
  for (const field of fields) {
    const value = data[field.key];
    if (value === null || value === undefined) continue;
    if (field.type === "group") {
      for (const child of field.validation.fields) leafRefs(child, (value as Record<string, unknown>)[child.key], `${field.key}.${child.key}`, out);
    } else if (field.type === "repeater") {
      if (!Array.isArray(value)) continue;
      value.forEach((item, i) => {
        for (const child of field.validation.fields) leafRefs(child, (item as Record<string, unknown> | null)?.[child.key], `${field.key}.${i}.${child.key}`, out);
      });
    } else {
      leafRefs(field, value, field.key, out);
    }
  }
  if (extra.seo?.imageAssetId && UUID.test(extra.seo.imageAssetId)) out.push({ targetKind: "asset", targetId: extra.seo.imageAssetId.toLowerCase(), fieldPath: "seo.imageAssetId" });
  if (extra.parentId) out.push({ targetKind: "entry", targetId: extra.parentId, fieldPath: "parentId" });
  const unique = new Map<string, EntryRef>();
  for (const r of out) unique.set(`${r.targetKind}|${r.targetId}|${r.fieldPath}`, r);
  return [...unique.values()];
}
