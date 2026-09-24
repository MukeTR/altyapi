import { createHash } from "node:crypto";
import type { ContentTranslationState } from "@altyapi/database";
import { isEmptyFieldValue } from "./compile";
import type { FieldDef, LeafFieldDef } from "./types";

/**
 * Translation state per field and language (plan §3.6): which default-language text a
 * translation was made from (sourceHash) and how (machine, reviewed, manual). A translation
 * whose source hash no longer matches the default-language value is out of date.
 */

export type TranslationStatus = "machine" | "reviewed" | "manual";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function translationSourceHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

/** Localized leaf fields with their paths: top-level fields and the children of groups (repeater items have no stable path). */
function localizedLeaves(fields: readonly FieldDef[], data: Record<string, unknown> | null | undefined): { path: string; field: LeafFieldDef; value: unknown }[] {
  const out: { path: string; field: LeafFieldDef; value: unknown }[] = [];
  for (const field of fields) {
    if (field.type === "repeater") continue;
    if (field.type === "group") {
      const group = (data?.[field.key] ?? null) as Record<string, unknown> | null;
      for (const child of field.validation.fields) if (child.localized) out.push({ path: `${field.key}.${child.key}`, field: child, value: group?.[child.key] });
      continue;
    }
    if (field.localized) out.push({ path: field.key, field, value: data?.[field.key] });
  }
  return out;
}

function mapOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Translation state after a save: every non-default language value that was added or changed
 * is recorded against the current default-language value with the given status; removed
 * translations drop out.
 */
export function nextTranslationState(
  fields: readonly FieldDef[],
  prevData: Record<string, unknown>,
  nextData: Record<string, unknown>,
  prevState: ContentTranslationState,
  defaultLocale: string,
  status: TranslationStatus,
): ContentTranslationState {
  const prevLeaves = new Map(localizedLeaves(fields, prevData).map((l) => [l.path, l.value]));
  const state: ContentTranslationState = {};
  for (const { path, field, value } of localizedLeaves(fields, nextData)) {
    const next = mapOf(value);
    const prev = mapOf(prevLeaves.get(path));
    const sourceHash = translationSourceHash(next[defaultLocale] ?? null);
    const entries: Record<string, { sourceHash: string; status: TranslationStatus }> = {};
    for (const [locale, v] of Object.entries(next)) {
      if (locale === defaultLocale || isEmptyFieldValue(field, v)) continue;
      const changed = stableStringify(v) !== stableStringify(prev[locale] ?? null);
      const kept = prevState[path]?.[locale];
      if (changed || !kept) entries[locale] = { sourceHash, status };
      else entries[locale] = kept;
    }
    if (Object.keys(entries).length) state[path] = entries;
  }
  return state;
}

export interface StaleTranslation {
  field: string;
  locale: string;
  status: TranslationStatus;
}

/** Translations made from a default-language text that has changed since. */
export function staleTranslations(fields: readonly FieldDef[], data: Record<string, unknown>, state: ContentTranslationState, defaultLocale: string): StaleTranslation[] {
  const out: StaleTranslation[] = [];
  for (const { path, value } of localizedLeaves(fields, data)) {
    const current = translationSourceHash(mapOf(value)[defaultLocale] ?? null);
    for (const [locale, entry] of Object.entries(state[path] ?? {})) {
      if (entry.sourceHash !== current) out.push({ field: path, locale, status: entry.status });
    }
  }
  return out;
}
