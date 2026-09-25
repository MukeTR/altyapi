"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SiteAddress } from "@/lib/site/types";
import { isValidTrPostalCode } from "@/lib/site/validators";

export function emptyAddress(country = "TR"): SiteAddress {
  return { street: "", mahalle: "", ilce: "", il: "", postalCode: "", country };
}

/** An address as the API takes it: trimmed, blank optional parts left out. */
export function cleanAddress(a: SiteAddress): SiteAddress {
  const opt = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  return { street: a.street.trim(), mahalle: opt(a.mahalle), ilce: opt(a.ilce), il: a.il.trim(), postalCode: opt(a.postalCode)?.toUpperCase() ?? null, country: a.country.trim().toUpperCase() };
}

export function isAddressBlank(a: SiteAddress): boolean {
  return ![a.street, a.mahalle, a.ilce, a.il, a.postalCode].some((v) => v?.trim());
}

/** Local checks the API repeats (required parts, Turkish postal code). */
export function addressProblems(a: SiteAddress): Partial<Record<keyof SiteAddress, "required" | "postalCode" | "country">> {
  const out: Partial<Record<keyof SiteAddress, "required" | "postalCode" | "country">> = {};
  if (!a.street.trim()) out.street = "required";
  if (!a.il.trim()) out.il = "required";
  if (!/^[A-Za-z]{2}$/.test(a.country.trim())) out.country = "country";
  const pc = a.postalCode?.trim() ?? "";
  if (pc && a.country.trim().toUpperCase() === "TR" && !isValidTrPostalCode(pc)) out.postalCode = "postalCode";
  return out;
}

/**
 * Postal address in Turkish terms (mahalle, ilçe, il); for addresses abroad the province field
 * holds the city. `errorAt` returns the API's message for a sub-path ("street", "postalCode").
 */
export function AddressFields({ value, onChange, idPrefix, errorAt, disabled, showLocalErrors }: { value: SiteAddress; onChange: (a: SiteAddress) => void; idPrefix: string; errorAt: (key: keyof SiteAddress) => string | undefined; disabled?: boolean; showLocalErrors: boolean }) {
  const { t } = useI18n();
  const local = showLocalErrors ? addressProblems(value) : {};
  const msg = (key: keyof SiteAddress) => {
    const p = local[key];
    if (p === "required") return t("site.address.required");
    if (p === "postalCode") return t("site.address.postalCodeInvalid");
    if (p === "country") return t("site.address.countryInvalid");
    return errorAt(key) ?? null;
  };
  const set = (patch: Partial<SiteAddress>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <Field id={`${idPrefix}-street`} label={t("site.address.street")} description={t("site.address.streetHint")} required error={msg("street")} className="sm:col-span-6">
        <Input value={value.street} maxLength={250} disabled={disabled} autoComplete="street-address" onChange={(e) => set({ street: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-mahalle`} label={t("site.address.mahalle")} optional error={msg("mahalle")} className="sm:col-span-3">
        <Input value={value.mahalle ?? ""} maxLength={120} disabled={disabled} onChange={(e) => set({ mahalle: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-ilce`} label={t("site.address.ilce")} optional error={msg("ilce")} className="sm:col-span-3">
        <Input value={value.ilce ?? ""} maxLength={120} disabled={disabled} autoComplete="address-level2" onChange={(e) => set({ ilce: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-il`} label={t("site.address.il")} required error={msg("il")} className="sm:col-span-2">
        <Input value={value.il} maxLength={120} disabled={disabled} autoComplete="address-level1" onChange={(e) => set({ il: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-postalCode`} label={t("site.address.postalCode")} optional error={msg("postalCode")} className="sm:col-span-2">
        <Input value={value.postalCode ?? ""} maxLength={12} disabled={disabled} inputMode="numeric" autoComplete="postal-code" onChange={(e) => set({ postalCode: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-country`} label={t("site.address.country")} description={t("site.address.countryHint")} required error={msg("country")} className="sm:col-span-2">
        <Input value={value.country} maxLength={2} disabled={disabled} autoComplete="country" className="uppercase" onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
      </Field>
    </div>
  );
}
