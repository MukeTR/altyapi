import { z } from "zod";
import { blankToNull, emailAddress, httpsUrl, localizedText, optionalEmail, optionalPhone, optionalText, siteAddressSchema } from "./fields";
import { BUSINESS_LEGAL_FORMS, type BusinessLegalForm } from "./types";

/**
 * Business identity validation (K3; 6563 m.3 imprint, VUK/TTK identifiers). Pure functions
 * so the admin app can run the same checks while the merchant types.
 */

/** Removes the spaces, dots and dashes people type in registry numbers. */
const stripSeparators = (value: string) => value.replace(/[\s.\-]/g, "");

/**
 * Vergi Kimlik Numarası (10 digits) with the Revenue Administration check digit: for each of
 * the first nine digits t = (d + 9 - i) mod 10 and v = t·2^(9-i) mod 9 (9 when t ≠ 0 and the
 * product is a multiple of 9); the tenth digit is (10 - Σv mod 10) mod 10.
 */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(value[i]) + 9 - i) % 10;
    let v = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && v === 0) v = 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

/**
 * T.C. Kimlik Numarası (11 digits, first non-zero): the tenth digit is
 * ((d1+d3+d5+d7+d9)·7 − (d2+d4+d6+d8)) mod 10 and the eleventh is (d1+…+d10) mod 10.
 */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

/** "vkn" for a valid 10-digit tax number, "tckn" for a valid 11-digit citizen number, else null. */
export function taxNumberKind(value: string): "vkn" | "tckn" | null {
  if (isValidVkn(value)) return "vkn";
  if (isValidTckn(value)) return "tckn";
  return null;
}

/** MERSİS (Central Registry System) number: 16 digits. */
export function isValidMersisNo(value: string): boolean {
  return /^\d{16}$/.test(value);
}

/** Kayıtlı Elektronik Posta address: an e-mail address on a kep.tr provider domain (e.g. firma@hs01.kep.tr). */
export function isValidKepAddress(value: string): boolean {
  return z.email().safeParse(value).success && /@(?:[a-z0-9-]+\.)*kep\.tr$/i.test(value);
}

/** GS1 Global Location Number: 13 digits with the GS1 mod-10 check digit. */
export function isValidGln(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/** Legal Entity Identifier (ISO 17442): 18 alphanumerics and two ISO 7064 MOD 97-10 check digits. */
export function isValidLei(value: string): boolean {
  if (!/^[A-Z0-9]{18}\d{2}$/.test(value)) return false;
  let remainder = 0;
  for (const c of value) {
    const n = c >= "A" ? c.charCodeAt(0) - 55 : Number(c);
    remainder = (remainder * (n >= 10 ? 100 : 10) + n) % 97;
  }
  return remainder === 1;
}

const digitsField = (pattern: RegExp, error: string, check?: (v: string) => boolean) =>
  z
    .preprocess(
      blankToNull,
      z
        .string()
        .transform(stripSeparators)
        .refine((v) => pattern.test(v) && (!check || check(v)), { error })
        .nullable(),
    )
    .optional();

const upperCode = (pattern: RegExp, error: string, check?: (v: string) => boolean) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => pattern.test(v) && (!check || check(v)), { error });

export const businessIdentifiersSchema = z.strictObject({
  /** NACE Rev.2 codes ("47.91", Turkish six-digit "47.91.01"), primary first. */
  nace: z
    .array(z.string().trim().regex(/^\d{2}(?:\.\d{1,2}(?:\.\d{2})?)?$/, { error: "errors.site.identity.invalid_nace" }))
    .max(10)
    .transform((codes) => [...new Set(codes)])
    .optional(),
  duns: upperCode(/^\d{9}$/, "errors.site.identity.invalid_duns").optional(),
  gln: upperCode(/^\d{13}$/, "errors.site.identity.invalid_gln", isValidGln).optional(),
  lei: upperCode(/^[A-Z0-9]{20}$/, "errors.site.identity.invalid_lei", isValidLei).optional(),
  vatId: upperCode(/^[A-Z]{2}[A-Z0-9]{2,13}$/, "errors.site.identity.invalid_vat_id").optional(),
  eori: upperCode(/^[A-Z]{2}[A-Z0-9]{1,15}$/, "errors.site.identity.invalid_eori").optional(),
});

/**
 * Save input for the business identity. Patch semantics: omitted fields keep their stored
 * value, null clears them, so the onboarding wizard can save step by step. Cross-field rules
 * that need the stored row (e.g. TCKN only for a sole proprietor) are checked on the merged
 * result by identityProblems.
 */
export const businessIdentityInputSchema = z.strictObject({
  /** Registered name (ticaret unvanı) or, for a sole proprietor, the owner's full name. */
  legalName: optionalText(250),
  /** Name the business trades under (brand, signboard). */
  tradeName: optionalText(250),
  legalForm: z.enum(BUSINESS_LEGAL_FORMS).nullable().optional(),
  mersisNo: digitsField(/^\d{16}$/, "errors.site.identity.invalid_mersis"),
  tradeRegistryNo: z
    .preprocess(blankToNull, z.string().trim().max(40).regex(/^[0-9A-Za-zÇĞİÖŞÜçğıöşü/\-. ]+$/, { error: "errors.site.identity.invalid_trade_registry_no" }).nullable())
    .optional(),
  taxOffice: optionalText(120),
  /** VKN (10 digits) or, for a sole proprietor, TCKN (11 digits); both checksum-validated. */
  taxNumber: digitsField(/^\d{10,11}$/, "errors.site.identity.invalid_tax_number", (v) => taxNumberKind(v) !== null),
  taxNumberPublic: z.boolean().optional(),
  kepAddress: z
    .preprocess(blankToNull, emailAddress.refine(isValidKepAddress, { error: "errors.site.identity.invalid_kep" }).nullable())
    .optional(),
  chamber: optionalText(200),
  chamberRulesUrl: z.preprocess(blankToNull, httpsUrl.nullable()).optional(),
  phone: optionalPhone,
  email: optionalEmail,
  address: siteAddressSchema.nullable().optional(),
  foundingDate: z
    .preprocess(
      blankToNull,
      z.iso
        .date({ error: "errors.site.identity.invalid_founding_date" })
        .refine((d) => d >= "1800-01-01" && d <= new Date().toISOString().slice(0, 10), { error: "errors.site.identity.invalid_founding_date" })
        .nullable(),
    )
    .optional(),
  logoAssetId: z.uuid().nullable().optional(),
  description: localizedText(1000).optional(),
  /** Official profile URLs (social, directories, Wikidata) for schema.org sameAs. */
  sameAs: z
    .array(httpsUrl)
    .max(20)
    .transform((urls) => [...new Set(urls)])
    .optional(),
  identifiers: businessIdentifiersSchema.optional(),
});

export type BusinessIdentityInput = z.input<typeof businessIdentityInputSchema>;

/** The identity fields cross-field rules look at, after merging the input into the stored row. */
export interface IdentityCrossFields {
  legalForm: BusinessLegalForm | null;
  taxNumber: string | null;
  taxNumberPublic: boolean;
  mersisNo: string | null;
}

/**
 * Cross-field rules on the merged identity; returns error keys (empty when consistent).
 * - A TCKN identifies a natural person: only a sole proprietor (or an identity whose legal
 *   form is not chosen yet) may use one as tax number.
 * - A tax number can only be published once there is one.
 * - The MERSİS number embeds the VKN (0 + VKN + sequence): when both are known they must agree.
 */
export function identityProblems(identity: IdentityCrossFields): string[] {
  const problems: string[] = [];
  const kind = identity.taxNumber ? taxNumberKind(identity.taxNumber) : null;
  if (kind === "tckn" && identity.legalForm !== null && identity.legalForm !== "sahis") {
    problems.push("errors.site.identity.tckn_requires_sole_proprietor");
  }
  if (identity.taxNumberPublic && !identity.taxNumber) problems.push("errors.site.identity.public_tax_number_missing");
  if (kind === "vkn" && identity.mersisNo && identity.mersisNo.slice(1, 11) !== identity.taxNumber) {
    problems.push("errors.site.identity.mersis_tax_number_mismatch");
  }
  return problems;
}
