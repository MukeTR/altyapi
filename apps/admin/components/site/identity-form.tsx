"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { TagInput } from "@/components/commerce/tag-input";
import { DateTime } from "@/components/data/date-time";
import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { LEGAL_FORMS, type BusinessIdentity, type LegalForm, type SiteAddress } from "@/lib/site/types";
import { isE164, isHttpsUrl, isValidEmail, isValidKepAddress, isValidMersisNo, normalizePhone, stripSeparators, taxNumberKind } from "@/lib/site/validators";
import { AddressFields, addressProblems, cleanAddress, emptyAddress, isAddressBlank } from "./address-fields";

interface Draft {
  legalName: string;
  tradeName: string;
  legalForm: LegalForm | "";
  foundingDate: string;
  taxOffice: string;
  taxNumber: string;
  taxNumberPublic: boolean;
  mersisNo: string;
  tradeRegistryNo: string;
  kepAddress: string;
  chamber: string;
  chamberRulesUrl: string;
  phone: string;
  email: string;
  address: SiteAddress | null;
  logoAssetId: string | null;
  description: Record<string, string>;
  sameAs: string[];
  nace: string[];
  duns: string;
  gln: string;
  lei: string;
  vatId: string;
  eori: string;
}

function toDraft(i: BusinessIdentity): Draft {
  return {
    legalName: i.legalName ?? "",
    tradeName: i.tradeName ?? "",
    legalForm: i.legalForm ?? "",
    foundingDate: i.foundingDate ?? "",
    taxOffice: i.taxOffice ?? "",
    taxNumber: i.taxNumber ?? "",
    taxNumberPublic: i.taxNumberPublic,
    mersisNo: i.mersisNo ?? "",
    tradeRegistryNo: i.tradeRegistryNo ?? "",
    kepAddress: i.kepAddress ?? "",
    chamber: i.chamber ?? "",
    chamberRulesUrl: i.chamberRulesUrl ?? "",
    phone: i.phone ?? "",
    email: i.email ?? "",
    address: i.address ? { ...emptyAddress(), ...i.address } : null,
    logoAssetId: i.logoAssetId,
    description: { ...i.description },
    sameAs: [...i.sameAs],
    nace: [...(i.identifiers.nace ?? [])],
    duns: i.identifiers.duns ?? "",
    gln: i.identifiers.gln ?? "",
    lei: i.identifiers.lei ?? "",
    vatId: i.identifiers.vatId ?? "",
    eori: i.identifiers.eori ?? "",
  };
}

/** Every field in the shape the API stores it (blank text is null). */
function fullBody(d: Draft): Record<string, unknown> {
  const text = (v: string) => (v.trim() ? v.trim() : null);
  return {
    legalName: text(d.legalName),
    tradeName: text(d.tradeName),
    legalForm: d.legalForm || null,
    foundingDate: text(d.foundingDate),
    taxOffice: text(d.taxOffice),
    taxNumber: text(d.taxNumber),
    taxNumberPublic: d.taxNumberPublic,
    mersisNo: text(d.mersisNo),
    tradeRegistryNo: text(d.tradeRegistryNo),
    kepAddress: text(d.kepAddress),
    chamber: text(d.chamber),
    chamberRulesUrl: text(d.chamberRulesUrl),
    phone: text(d.phone),
    email: text(d.email),
    address: d.address && !isAddressBlank(d.address) ? cleanAddress(d.address) : null,
    logoAssetId: d.logoAssetId,
    description: Object.fromEntries(Object.entries(d.description).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
    sameAs: d.sameAs,
    identifiers: Object.fromEntries(
      Object.entries({ nace: d.nace.length ? d.nace : undefined, duns: text(d.duns), gln: text(d.gln), lei: text(d.lei), vatId: text(d.vatId), eori: text(d.eori) }).filter(([, v]) => v !== null && v !== undefined),
    ),
  };
}

/** The save body: only changed fields (patch semantics: omitted keep their value, null clears). */
function toBody(d: Draft, before: Draft, masked: boolean): Record<string, unknown> {
  const next = fullBody(d);
  const prev = fullBody(before);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(prev[k])) out[k] = v;
  // A masked citizen number is never sent back (it would overwrite the real one with stars).
  if (masked) delete out.taxNumber;
  return out;
}

/** Domain error keys that concern one field (shown on it). */
const FIELD_FOR_KEY: Record<string, string> = {
  "errors.site.identity.tckn_requires_sole_proprietor": "taxNumber",
  "errors.site.identity.public_tax_number_missing": "taxNumberPublic",
  "errors.site.identity.mersis_tax_number_mismatch": "mersisNo",
  "errors.site.identity.logo_invalid": "logoAssetId",
};

/**
 * Site › business identity (künye, 6563 m.3): legal name and form, tax office and number
 * (VKN checked with its check digit; a sole proprietor's TCKN is personal data and shown masked
 * to readers), MERSİS, trade registry, KEP, chamber, contact, address, logo and registry
 * identifiers. The storefront imprint and the organization JSON-LD read it.
 */
export function IdentityForm({ initial }: { initial: BusinessIdentity }) {
  const { t, describeError } = useI18n();
  const { apiBase, store, can } = useStore();
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [tried, setTried] = useState(false);
  const canEdit = can("site:write");
  const masked = saved.taxNumberMasked;
  const base = toDraft(saved);
  const body = toBody(draft, base, masked);
  const dirty = Object.keys(body).length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Checks the API repeats, run while the merchant types.
  const taxDigits = stripSeparators(draft.taxNumber);
  const taxKind = taxDigits ? taxNumberKind(taxDigits) : null;
  const local: Record<string, string> = {};
  if (taxDigits && !masked && !taxKind) local.taxNumber = /^\d{11}$/.test(taxDigits) ? t("site.identity.errors.tcknInvalid") : /^\d{10}$/.test(taxDigits) ? t("site.identity.errors.vknInvalid") : t("site.identity.errors.taxNumberFormat");
  if (taxKind === "tckn" && draft.legalForm && draft.legalForm !== "sahis") local.taxNumber = t("site.identity.errors.tcknSoleProprietor");
  const mersis = stripSeparators(draft.mersisNo);
  if (mersis && !isValidMersisNo(mersis)) local.mersisNo = t("site.identity.errors.mersisFormat");
  else if (mersis && taxKind === "vkn" && mersis.slice(1, 11) !== taxDigits) local.mersisNo = t("site.identity.errors.mersisMismatch");
  if (draft.kepAddress.trim() && !isValidKepAddress(draft.kepAddress.trim())) local.kepAddress = t("site.identity.errors.kepInvalid");
  if (draft.taxNumberPublic && !draft.taxNumber.trim()) local.taxNumberPublic = t("site.identity.errors.publicWithoutNumber");
  if (draft.phone.trim() && !isE164(normalizePhone(draft.phone))) local.phone = t("site.identity.errors.phoneInvalid");
  if (draft.email.trim() && !isValidEmail(draft.email)) local.email = t("site.identity.errors.emailInvalid");
  if (draft.chamberRulesUrl.trim() && !isHttpsUrl(draft.chamberRulesUrl)) local.chamberRulesUrl = t("site.identity.errors.httpsOnly");
  if (draft.sameAs.some((u) => !isHttpsUrl(u))) local.sameAs = t("site.identity.errors.httpsOnly");
  if (draft.address && !isAddressBlank(draft.address) && Object.keys(addressProblems(draft.address)).length) local.address = t("site.identity.errors.addressIncomplete");

  const described = error ? describeError(error, FIELD_FOR_KEY) : null;
  const msg = (key: string) => (tried || draft[key as keyof Draft] !== base[key as keyof Draft] ? local[key] : undefined) ?? described?.fields[key] ?? Object.entries(described?.fields ?? {}).find(([p]) => p.startsWith(`${key}.`))?.[1] ?? null;
  const labelOf: Record<string, string> = {
    legalName: t("site.identity.legalName"),
    tradeName: t("site.identity.tradeName"),
    taxNumber: t("site.identity.taxNumber"),
    taxNumberPublic: t("site.identity.taxNumberPublic"),
    mersisNo: t("site.identity.mersisNo"),
    kepAddress: t("site.identity.kepAddress"),
    phone: t("site.identity.phone"),
    email: t("site.identity.email"),
    chamberRulesUrl: t("site.identity.chamberRulesUrl"),
    sameAs: t("site.identity.sameAs"),
    address: t("site.identity.address"),
    logoAssetId: t("site.identity.logo"),
  };
  const summary = described
    ? Object.entries(described.fields).map(([p, m]) => ({ fieldId: `id-${p.split(".")[0]}`, message: m, label: labelOf[p.split(".")[0]!] ?? p }))
    : [];

  const save = async () => {
    setTried(true);
    if (Object.keys(local).length) return;
    setPending(true);
    setError(null);
    try {
      const next = await bff<BusinessIdentity>(`${apiBase}/site/identity`, { method: "PUT", body });
      setSaved(next);
      setDraft(toDraft(next));
      setTried(false);
      toast({ tone: "success", title: t("site.identity.saved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const localCount = tried ? Object.keys(local).length : 0;

  return (
    <form
      className="mx-auto flex max-w-[960px] flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageHeader
        title={t("site.identity.title")}
        meta={saved.updatedAt ? <span>{t("site.identity.updated")} <DateTime value={saved.updatedAt} format="relative" /></span> : t("site.identity.meta")}
        actions={
          canEdit ? (
            <>
              <Button disabled={!dirty || pending} onClick={() => { setDraft(toDraft(saved)); setError(null); setTried(false); }}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
                {t("common.save")}
              </Button>
            </>
          ) : null
        }
      />
      <InlineAlert tone="info">{t("site.identity.intro")}</InlineAlert>
      {!canEdit ? <InlineAlert tone="info">{t("site.readOnly", { permission: "site:write" })}</InlineAlert> : null}
      {localCount ? <ErrorSummary message={t("site.identity.localErrors", { count: localCount })} items={Object.entries(local).map(([k, m]) => ({ fieldId: `id-${k}`, message: m, label: labelOf[k] ?? k }))} /> : null}
      {described ? <ErrorSummary message={summary.length ? undefined : described.message} items={summary} /> : null}

      <Card title={t("site.identity.legalTitle")} description={t("site.identity.legalDescription")} padding="form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="id-legalName" label={t("site.identity.legalName")} description={t("site.identity.legalNameHint")} error={msg("legalName")} className="sm:col-span-2">
            <Input value={draft.legalName} maxLength={250} disabled={!canEdit} autoComplete="organization" onChange={(e) => set("legalName", e.target.value)} />
          </Field>
          <Field id="id-tradeName" label={t("site.identity.tradeName")} description={t("site.identity.tradeNameHint")} optional error={msg("tradeName")}>
            <Input value={draft.tradeName} maxLength={250} disabled={!canEdit} onChange={(e) => set("tradeName", e.target.value)} />
          </Field>
          <Field id="id-legalForm" label={t("site.identity.legalForm")} optional error={msg("legalForm")}>
            <Select value={draft.legalForm || "__none"} disabled={!canEdit} onValueChange={(v) => set("legalForm", v === "__none" ? "" : (v as LegalForm))} options={[{ value: "__none", label: t("site.identity.legalFormNone") }, ...LEGAL_FORMS.map((f) => ({ value: f, label: t(`site.identity.legalForms.${f}`) }))]} />
          </Field>
          <Field id="id-foundingDate" label={t("site.identity.foundingDate")} optional error={msg("foundingDate")}>
            <Input type="date" value={draft.foundingDate} max={new Date().toISOString().slice(0, 10)} disabled={!canEdit} onChange={(e) => set("foundingDate", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={t("site.identity.taxTitle")} description={t("site.identity.taxDescription")} padding="form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="id-taxOffice" label={t("site.identity.taxOffice")} optional error={msg("taxOffice")}>
            <Input value={draft.taxOffice} maxLength={120} disabled={!canEdit} onChange={(e) => set("taxOffice", e.target.value)} />
          </Field>
          <Field
            id="id-taxNumber"
            label={t("site.identity.taxNumber")}
            description={masked ? t("site.identity.taxNumberMaskedHint") : taxKind === "vkn" ? t("site.identity.vknValid") : taxKind === "tckn" ? t("site.identity.tcknValid") : t("site.identity.taxNumberHint")}
            optional
            error={msg("taxNumber")}
          >
            <Input value={draft.taxNumber} inputMode="numeric" maxLength={14} className="font-mono" disabled={!canEdit || masked} autoComplete="off" onChange={(e) => set("taxNumber", e.target.value)} suffix={taxKind ? <ShieldCheck aria-hidden="true" className="size-4 text-success" /> : undefined} />
          </Field>
          {taxKind === "tckn" ? <InlineAlert tone="warning" className="sm:col-span-2">{t("site.identity.tcknPrivacy")}</InlineAlert> : null}
          <div id="id-taxNumberPublic" className="sm:col-span-2">
            <Switch
              checked={draft.taxNumberPublic}
              disabled={!canEdit || (!draft.taxNumber.trim() && !draft.taxNumberPublic)}
              onCheckedChange={(c) => set("taxNumberPublic", c)}
              label={t("site.identity.taxNumberPublic")}
              description={taxKind === "tckn" ? t("site.identity.taxNumberPublicTcknHint") : t("site.identity.taxNumberPublicHint")}
            />
            {msg("taxNumberPublic") ? <p className="mt-1 text-sm text-danger">{msg("taxNumberPublic")}</p> : null}
          </div>
          <Field id="id-mersisNo" label={t("site.identity.mersisNo")} description={t("site.identity.mersisHint")} optional error={msg("mersisNo")}>
            <Input value={draft.mersisNo} inputMode="numeric" maxLength={22} className="font-mono" disabled={!canEdit} onChange={(e) => set("mersisNo", e.target.value)} />
          </Field>
          <Field id="id-tradeRegistryNo" label={t("site.identity.tradeRegistryNo")} optional error={msg("tradeRegistryNo")}>
            <Input value={draft.tradeRegistryNo} maxLength={40} disabled={!canEdit} onChange={(e) => set("tradeRegistryNo", e.target.value)} />
          </Field>
          <Field id="id-kepAddress" label={t("site.identity.kepAddress")} description={t("site.identity.kepHint")} optional error={msg("kepAddress")}>
            <Input type="email" value={draft.kepAddress} maxLength={254} placeholder="firma@hs01.kep.tr" disabled={!canEdit} onChange={(e) => set("kepAddress", e.target.value)} />
          </Field>
          <Field id="id-chamber" label={t("site.identity.chamber")} description={t("site.identity.chamberHint")} optional error={msg("chamber")}>
            <Input value={draft.chamber} maxLength={200} disabled={!canEdit} onChange={(e) => set("chamber", e.target.value)} />
          </Field>
          <Field id="id-chamberRulesUrl" label={t("site.identity.chamberRulesUrl")} optional error={msg("chamberRulesUrl")} className="sm:col-span-2">
            <Input type="url" value={draft.chamberRulesUrl} placeholder="https://" disabled={!canEdit} onChange={(e) => set("chamberRulesUrl", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={t("site.identity.contactTitle")} description={t("site.identity.contactDescription")} padding="form">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="id-phone" label={t("site.identity.phone")} description={t("site.identity.phoneHint")} optional error={msg("phone")}>
              <Input type="tel" value={draft.phone} placeholder="+90 212 000 00 00" disabled={!canEdit} autoComplete="tel" onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field id="id-email" label={t("site.identity.email")} optional error={msg("email")}>
              <Input type="email" value={draft.email} maxLength={254} disabled={!canEdit} autoComplete="email" onChange={(e) => set("email", e.target.value)} />
            </Field>
          </div>
          <fieldset id="id-address" className="flex flex-col gap-3">
            <legend className="mb-1 text-base font-medium text-fg">{t("site.identity.address")}</legend>
            {draft.address ? (
              <>
                <AddressFields value={draft.address} idPrefix="id-addr" disabled={!canEdit} showLocalErrors={tried} errorAt={(k) => described?.fields[`address.${k}`]} onChange={(a) => set("address", a)} />
                <Button size="sm" variant="ghost" className="self-start" disabled={!canEdit} onClick={() => set("address", null)}>
                  {t("site.identity.removeAddress")}
                </Button>
              </>
            ) : (
              <Button size="sm" className="self-start" disabled={!canEdit} onClick={() => set("address", emptyAddress(store.countryCode || "TR"))}>
                {t("site.identity.addAddress")}
              </Button>
            )}
          </fieldset>
          <div id="id-logoAssetId">
            <AssetField label={t("site.identity.logo")} description={t("site.identity.logoHint")} value={draft.logoAssetId} disabled={!canEdit} error={msg("logoAssetId")} onChange={(id) => set("logoAssetId", id)} />
          </div>
          <LocalizedTextField label={t("site.identity.description")} description={t("site.identity.descriptionHint")} locales={store.supportedLocales} defaultLocale={store.defaultLocale} value={draft.description} maxLength={1000} multiline disabled={!canEdit} onChange={(v) => set("description", v)} />
          <Field id="id-sameAs" label={t("site.identity.sameAs")} description={t("site.identity.sameAsHint")} optional error={msg("sameAs")}>
            <TagInput value={draft.sameAs} onChange={(v) => set("sameAs", v)} maxTags={20} maxLength={2000} disabled={!canEdit} placeholder="https://www.linkedin.com/company/…" />
          </Field>
        </div>
      </Card>

      <Card title={t("site.identity.identifiersTitle")} description={t("site.identity.identifiersDescription")} padding="form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="id-nace" label={t("site.identity.nace")} description={t("site.identity.naceHint")} optional error={msg("identifiers.nace")} className="sm:col-span-2">
            <TagInput value={draft.nace} onChange={(v) => set("nace", v)} maxTags={10} maxLength={8} disabled={!canEdit} placeholder="47.91" />
          </Field>
          {(["duns", "gln", "lei", "vatId", "eori"] as const).map((k) => (
            <Field key={k} id={`id-${k}`} label={t(`site.identity.identifiers.${k}`)} optional error={msg(`identifiers.${k}`)}>
              <Input value={draft[k]} maxLength={30} className="font-mono uppercase" disabled={!canEdit} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
      </Card>
    </form>
  );
}
