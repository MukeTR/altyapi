import { z } from "zod";
import { LOCALE_CODES } from "@altyapi/commerce-core";
import type { GeoPoint, LocalizedText, OpeningHours, SiteAddress } from "@altyapi/database";
import { e164Phone, httpsUrl, linkTargetSchema, type LinkTarget } from "../links";

/**
 * Value shapes of structured field types. Shared by content fields and the site tables that
 * store the same facts (business identity, locations): one shape for an address, a geo point
 * or opening hours everywhere.
 */

const localeKey = z.enum(LOCALE_CODES);

/** Localized short text inside a structured value ({ tr: "…", en: "…" }). */
/** Error of a language key outside the allowed set (unknown code, or a language this value may not carry). */
export const unknownLocaleError = (iss: { code?: string }) => (iss.code === "unrecognized_keys" ? "errors.locale.unknown" : undefined);

export const localizedValue = (max: number) => z.partialRecord(localeKey, z.string().trim().max(max), { error: unknownLocaleError });

/** How a field uses an asset: the asset plus per-use alt text, crop and focal point. */
export interface AssetUsage {
  assetId: string;
  /** Per-use alt text; falls back to the default-language alt when a language has none. */
  alt?: LocalizedText | undefined;
  /** Crop rectangle as fractions of the original (0–1). */
  crop?: { x: number; y: number; width: number; height: number } | undefined;
  /** Focal point as fractions (0–1), kept in view when the image is cropped responsively. */
  focal?: { x: number; y: number } | undefined;
  /** Purely decorative: rendered with empty alt text. */
  decorative?: boolean | undefined;
}

const fraction = z.number().min(0).max(1);

export const assetUsageSchema = z
  .object({
    assetId: z.uuid(),
    alt: localizedValue(300).optional(),
    crop: z
      .object({ x: fraction, y: fraction, width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) })
      .refine((c) => c.x + c.width <= 1.0001 && c.y + c.height <= 1.0001, "errors.content.invalid_crop")
      .optional(),
    focal: z.object({ x: fraction, y: fraction }).optional(),
    decorative: z.boolean().optional(),
  }) satisfies z.ZodType<AssetUsage>;

export interface MoneyValue {
  /** Minor units (kuruş). */
  amountMinor: number;
  currency: string;
}

export const moneyValueSchema = z.object({
  amountMinor: z.number().int().refine(Number.isSafeInteger, "errors.content.invalid_amount"),
  currency: z.string().regex(/^[A-Z]{3}$/, "errors.content.invalid_currency"),
}) satisfies z.ZodType<MoneyValue>;

export interface DateRangeValue {
  from: string;
  to: string;
}

export const dateRangeValueSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, "errors.content.invalid_date_range") satisfies z.ZodType<DateRangeValue>;

export interface VideoValue {
  provider: "youtube" | "vimeo";
  id: string;
  title?: LocalizedText | undefined;
  /** WebVTT captions uploaded as an asset. */
  captionsAssetId?: string | null | undefined;
  transcript?: LocalizedText | undefined;
}

export const videoValueSchema = z
  .object({
    provider: z.enum(["youtube", "vimeo"]),
    id: z.string().trim(),
    title: localizedValue(200).optional(),
    captionsAssetId: z.uuid().nullable().optional(),
    transcript: localizedValue(50_000).optional(),
  })
  .refine((v) => (v.provider === "youtube" ? /^[A-Za-z0-9_-]{11}$/ : /^\d{6,12}$/).test(v.id), { path: ["id"], message: "errors.content.invalid_embed_id" }) satisfies z.ZodType<VideoValue>;

export interface LinkValue {
  target: LinkTarget;
  label?: LocalizedText | undefined;
  openInNewTab?: boolean | undefined;
}

export const linkValueSchema = z.object({
  target: linkTargetSchema,
  label: localizedValue(120).optional(),
  openInNewTab: z.boolean().optional(),
}) satisfies z.ZodType<LinkValue>;

export interface PhoneValue {
  /** E.164. */
  number: string;
  /** The number is reachable on WhatsApp. */
  whatsapp?: boolean | undefined;
}

export const phoneValueSchema = z.object({ number: e164Phone, whatsapp: z.boolean().optional() }) satisfies z.ZodType<PhoneValue>;

export const addressValueSchema = z.object({
  street: z.string().trim().min(1).max(300),
  mahalle: z.string().trim().max(120).nullable().optional(),
  ilce: z.string().trim().max(120).nullable().optional(),
  il: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,12}$/, "errors.content.invalid_postal_code").nullable().optional(),
  country: z.string().regex(/^[A-Z]{2}$/, "errors.content.invalid_country").default("TR"),
}) satisfies z.ZodType<SiteAddress, unknown>;

export const geoPointValueSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  approximate: z.boolean().default(false),
}) satisfies z.ZodType<GeoPoint, unknown>;

const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "errors.content.invalid_time");
const weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export const openingHoursValueSchema = z.object({
  weekly: z
    .array(
      z.object({
        days: z.array(weekday).min(1).max(7).refine((d) => new Set(d).size === d.length, "errors.content.duplicate_day"),
        opens: hhmm,
        closes: hhmm,
      }),
    )
    .max(21)
    .default([]),
  specialDays: z
    .array(
      z
        .object({
          from: z.iso.date(),
          to: z.iso.date(),
          closed: z.boolean(),
          hours: z.array(z.object({ opens: hhmm, closes: hhmm })).max(4).default([]),
          label: localizedValue(120).optional(),
        })
        .refine((d) => d.from <= d.to, "errors.content.invalid_date_range")
        .refine((d) => !d.closed || d.hours.length === 0, "errors.content.closed_day_has_hours"),
    )
    .max(120)
    .default([]),
  byAppointment: z.boolean().default(false),
  note: localizedValue(300).optional(),
}) satisfies z.ZodType<OpeningHours, unknown>;

export interface KeyFact {
  label: string;
  value: string;
}

/** Short label/value facts ("Kuruluş: 1998"). Localized as a whole list per language. */
export const keyFactSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) }) satisfies z.ZodType<KeyFact>;

export interface SourceCitation {
  title: string;
  url?: string | undefined;
  publisher?: string | undefined;
  /** YYYY, YYYY-MM or YYYY-MM-DD. */
  date?: string | undefined;
  /** Mevzuat or court decision reference ("6698 s. KVKK m.10", "Yargıtay 9. HD 2023/1234"). */
  reference?: string | undefined;
}

export const sourceCitationSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: httpsUrl.optional(),
  publisher: z.string().trim().max(200).optional(),
  date: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/, "errors.content.invalid_date").optional(),
  reference: z.string().trim().max(200).optional(),
}) satisfies z.ZodType<SourceCitation>;

export interface Credential {
  kind: "licence" | "certificate" | "membership" | "award";
  name: LocalizedText;
  issuer: string;
  number?: string | undefined;
  url?: string | undefined;
  validFrom?: string | undefined;
  validUntil?: string | undefined;
  /** Set only by the site owner; AI actions and imports can never set it. */
  verified: boolean;
}

export const credentialSchema = z
  .object({
    kind: z.enum(["licence", "certificate", "membership", "award"]),
    name: localizedValue(200).refine((v) => Object.values(v).some((s) => (s ?? "").length > 0), "errors.content.field_required"),
    issuer: z.string().trim().min(1).max(200),
    number: z.string().trim().max(100).optional(),
    url: httpsUrl.optional(),
    validFrom: z.iso.date().optional(),
    validUntil: z.iso.date().optional(),
    verified: z.boolean().default(false),
  })
  .refine((c) => !c.validFrom || !c.validUntil || c.validFrom <= c.validUntil, "errors.content.invalid_date_range") satisfies z.ZodType<Credential, unknown>;
