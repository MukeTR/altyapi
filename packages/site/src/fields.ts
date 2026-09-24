import { z } from "zod";
import { LOCALE_CODES } from "@altyapi/commerce-core";

/**
 * Field schemas shared by the site profile, business identity and location inputs. Optional
 * text fields follow patch semantics: undefined keeps the stored value, null (or an empty
 * string) clears it.
 */

/** Treats "" and whitespace-only strings as "no value" so clearing a form field clears the column. */
export const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** Optional, clearable trimmed text. */
export const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();

/** Localized short text keyed by locale code; locales outside the store's languages are refused by the services. */
export const localizedText = (max: number) => z.partialRecord(z.enum(LOCALE_CODES), z.string().trim().max(max));

/** Absolute https URL (profiles, rules pages). */
export const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain, error: "errors.site.invalid_https_url" }));

/** Removes separators people type in phone numbers and turns the 00 international prefix into +. */
export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().\-/]/g, "");
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
}

/**
 * E.164: "+", a country code and the subscriber number, 8 to 15 digits in total. Turkish
 * numbers (+90) always carry a 10-digit national number.
 */
export function isE164(value: string): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return false;
  if (value.startsWith("+90")) return value.length === 13;
  return true;
}

export const phoneNumber = z
  .string()
  .transform(normalizePhone)
  .refine(isE164, { error: "errors.site.invalid_phone" });

export const optionalPhone = z.preprocess(blankToNull, phoneNumber.nullable()).optional();

export const emailAddress = z.string().trim().toLowerCase().pipe(z.email({ error: "errors.site.invalid_email" }));

export const optionalEmail = z.preprocess(blankToNull, emailAddress.nullable()).optional();

/** ISO 3166-1 alpha-2 country code, upper-cased. */
export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: "errors.site.address.invalid_country" });

/** Postal address (Turkish terms; for foreign addresses il is the city). */
export const siteAddressSchema = z
  .strictObject({
    street: z.string().trim().min(1).max(250),
    mahalle: optionalText(120),
    ilce: optionalText(120),
    il: z.string().trim().min(1).max(120),
    postalCode: z
      .preprocess(blankToNull, z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{1,10}$/, { error: "errors.site.address.invalid_postal_code" }).nullable())
      .optional(),
    country: countryCode,
  })
  .superRefine((address, ctx) => {
    // Turkish postal codes are five digits, the first two being the province plate code.
    if (address.country === "TR" && address.postalCode && !/^(0[1-9]|[1-7]\d|8[01])\d{3}$/.test(address.postalCode)) {
      ctx.addIssue({ code: "custom", path: ["postalCode"], message: "errors.site.address.invalid_postal_code" });
    }
  });
