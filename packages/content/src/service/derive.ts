import { fieldValueIn } from "../fields/compile";
import type { FieldDef, LeafFieldDef } from "../fields/types";
import type { AssetUsage } from "../fields/values";
import { deriveRichDoc, readingMinutes, type DerivedRichDoc, type OutlineItem, type QaPair } from "../rich/render";
import type { RichDoc } from "../rich/schema";
import type { EffectiveContentType } from "../types/definition";

/**
 * What a publish derives from an entry per published language (record_versions.derived): the
 * card other pages list it with, derived rich text output, and the aggregates the storefront,
 * feeds, llms.txt and JSON-LD read without re-rendering the documents.
 */

/** List card of an entry in one language. */
export interface EntryCard {
  title: string;
  summary: string;
  image: AssetUsage | null;
  /** Field the image was taken from; the storefront shows it only while that field is still the type's public cover. */
  imageField?: string | null;
  readingMinutes: number;
  /** The type's card fields in this language; richDoc fields as { html, plain } (html with tokens). */
  fields: Record<string, unknown>;
}

export interface EntryLocaleDerived {
  card: EntryCard;
  /** Derived output of every public richDoc field by path ("body", "sections.0.text"). */
  rich: Record<string, DerivedRichDoc>;
  wordCount: number;
  readingMinutes: number;
  /** Headings of the main (first) richDoc field. */
  outline: OutlineItem[];
  /** Question/answer pairs of all richDoc fields. */
  qa: QaPair[];
}

const SUMMARY_MAX = 200;

/** A plain-text excerpt cut at a word boundary. */
export function excerpt(text: string, max = SUMMARY_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

function isPublicField(type: EffectiveContentType, field: FieldDef | LeafFieldDef, topLevelKey: string): boolean {
  return field.visibility === "public" && !type.hiddenFields.has(topLevelKey);
}

/** Public richDoc values of an entry in one language, by path. */
function richDocsIn(type: EffectiveContentType, data: Record<string, unknown>, locale: string): [string, RichDoc][] {
  const out: [string, RichDoc][] = [];
  const push = (path: string, field: LeafFieldDef, value: unknown) => {
    const doc = fieldValueIn(field, value, locale) as RichDoc | undefined;
    if (doc && typeof doc === "object" && Array.isArray(doc.content)) out.push([path, doc]);
  };
  for (const field of type.fields) {
    if (!isPublicField(type, field, field.key)) continue;
    const value = data[field.key];
    if (field.type === "richDoc") push(field.key, field, value);
    else if (field.type === "group" && value && typeof value === "object") {
      for (const child of field.validation.fields) if (child.type === "richDoc" && child.visibility === "public") push(`${field.key}.${child.key}`, child, (value as Record<string, unknown>)[child.key]);
    } else if (field.type === "repeater" && Array.isArray(value)) {
      value.forEach((item, i) => {
        for (const child of field.validation.fields) if (child.type === "richDoc" && child.visibility === "public") push(`${field.key}.${i}.${child.key}`, child, (item as Record<string, unknown> | null)?.[child.key]);
      });
    }
  }
  return out;
}

function stringIn(type: EffectiveContentType, data: Record<string, unknown>, key: string | null, locale: string): string {
  if (!key) return "";
  const field = type.fields.find((f) => f.key === key);
  if (!field) return "";
  const value = fieldValueIn(field, data[key], locale);
  return typeof value === "string" ? value.trim() : "";
}

/** The field behind a key if the storefront may show it (public and not hidden by the site). */
export function publicFieldOf(type: EffectiveContentType, key: string | null): FieldDef | null {
  if (!key) return null;
  const field = type.fields.find((f) => f.key === key);
  return field && isPublicField(type, field, key) ? field : null;
}

/**
 * The image of a stored card as the storefront may show it now: only while the field it came
 * from is still the type's cover and public (a field made internal or hidden after the publish
 * takes its image off the site at once). Cards stored before the field was recorded are
 * checked against the type's current cover field.
 */
export function visibleCardImage(type: EffectiveContentType, card: Pick<EntryCard, "image" | "imageField"> | null | undefined): AssetUsage | null {
  if (!card?.image) return null;
  const cover = publicFieldOf(type, type.imageField);
  if (!cover) return null;
  return card.imageField === undefined || card.imageField === cover.key ? card.image : null;
}

/**
 * The list card of an entry: title, summary, cover image and the type's card fields, all
 * from public fields only (internal fields never reach the storefront, cards included).
 */
export function projectCard(type: EffectiveContentType, data: Record<string, unknown>, locale: string, rich: Record<string, DerivedRichDoc>, readingMinutes: number): EntryCard {
  const firstRich = Object.values(rich)[0];
  const summaryField = publicFieldOf(type, type.summaryField);
  const summary = stringIn(type, data, summaryField?.key ?? null, locale) || (firstRich ? excerpt(firstRich.plain) : "");
  let image: AssetUsage | null = null;
  const imageField = publicFieldOf(type, type.imageField);
  if (imageField) {
    const value = fieldValueIn(imageField, data[imageField.key], locale);
    if (value && typeof value === "object" && typeof (value as AssetUsage).assetId === "string") image = value as AssetUsage;
  }
  const titleField = publicFieldOf(type, type.titleField);
  const fields: Record<string, unknown> = {};
  for (const key of type.cardFields) {
    const field = type.fields.find((f) => f.key === key);
    if (!field || !isPublicField(type, field, key)) continue;
    if (field.type === "richDoc") {
      const d = rich[key];
      if (d) fields[key] = { html: d.html, plain: d.plain };
      continue;
    }
    const value = fieldValueIn(field, data[key], locale);
    if (value !== undefined && value !== null) fields[key] = value;
  }
  return { title: stringIn(type, data, titleField?.key ?? null, locale), summary, image, imageField: image ? imageField!.key : null, readingMinutes, fields };
}

/** Derived output of an entry for each language it is published in. */
export function deriveEntry(type: EffectiveContentType, data: Record<string, unknown>, locales: readonly string[]): Record<string, EntryLocaleDerived> {
  const out: Record<string, EntryLocaleDerived> = {};
  for (const locale of locales) {
    const rich: Record<string, DerivedRichDoc> = {};
    for (const [path, doc] of richDocsIn(type, data, locale)) rich[path] = deriveRichDoc(doc);
    const docs = Object.values(rich);
    const words = docs.reduce((n, d) => n + d.wordCount, 0);
    const minutes = readingMinutes(words);
    out[locale] = {
      card: projectCard(type, data, locale, rich, minutes),
      rich,
      wordCount: words,
      readingMinutes: minutes,
      outline: docs[0]?.outline ?? [],
      qa: docs.flatMap((d) => d.qa),
    };
  }
  return out;
}
