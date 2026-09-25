"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { labelText, slugify } from "@/lib/content/fields";
import type { OpeningHours, ServiceArea, SiteAddress, SiteLocation } from "@/lib/site/types";
import { isE164, isValidEmail, normalizePhone } from "@/lib/site/validators";
import { AddressFields, addressProblems, cleanAddress, emptyAddress } from "./address-fields";
import { OpeningHoursEditor, cleanOpeningHours, emptyOpeningHours } from "./opening-hours-editor";

interface Draft {
  name: Record<string, string>;
  slug: string;
  status: "active" | "hidden";
  isPrimary: boolean;
  hasAddress: boolean;
  address: SiteAddress;
  lat: string;
  lng: string;
  approximate: boolean;
  phone: string;
  whatsapp: string;
  email: string;
  openingHours: OpeningHours;
  hasServiceArea: boolean;
  places: { il: string; ilce: string }[];
  radiusKm: string;
  countries: string;
}

function toDraft(l: SiteLocation | null, country: string): Draft {
  return {
    name: { ...(l?.name ?? {}) },
    slug: l?.slug ?? "",
    status: l?.status ?? "active",
    isPrimary: l?.isPrimary ?? false,
    hasAddress: l ? l.address !== null : true,
    address: l?.address ? { ...emptyAddress(country), ...l.address } : emptyAddress(country),
    lat: l?.geo ? String(l.geo.lat) : "",
    lng: l?.geo ? String(l.geo.lng) : "",
    approximate: l?.geo?.approximate ?? false,
    phone: l?.phone ?? "",
    whatsapp: l?.whatsapp ?? "",
    email: l?.email ?? "",
    openingHours: l?.openingHours ? { ...emptyOpeningHours(), ...l.openingHours } : emptyOpeningHours(),
    hasServiceArea: Boolean(l?.serviceArea),
    places: (l?.serviceArea?.places ?? []).map((p) => ({ il: p.il, ilce: p.ilce ?? "" })),
    radiusKm: l?.serviceArea?.radiusKm ? String(l.serviceArea.radiusKm) : "",
    countries: (l?.serviceArea?.countries ?? []).join(", "),
  };
}

function toBody(d: Draft): Record<string, unknown> {
  const text = (v: string) => (v.trim() ? v.trim() : null);
  const geo = d.lat.trim() && d.lng.trim() ? { lat: Number(d.lat), lng: Number(d.lng), approximate: d.approximate } : null;
  const serviceArea: ServiceArea | null = d.hasServiceArea
    ? {
        places: d.places.filter((p) => p.il.trim()).map((p) => ({ il: p.il.trim(), ilce: p.ilce.trim() || null })),
        radiusKm: d.radiusKm.trim() ? Number(d.radiusKm) : null,
        countries: d.countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
      }
    : null;
  return {
    name: Object.fromEntries(Object.entries(d.name).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
    ...(d.slug.trim() ? { slug: d.slug.trim() } : {}),
    status: d.status,
    address: d.hasAddress ? cleanAddress(d.address) : null,
    geo,
    phone: text(d.phone),
    whatsapp: text(d.whatsapp),
    email: text(d.email),
    openingHours: cleanOpeningHours(d.openingHours),
    serviceArea,
  };
}

/** Domain error keys that concern one field. */
const FIELD_FOR_KEY: Record<string, string> = {
  "errors.site.location.address_or_service_area_required": "address",
  "errors.site.location.radius_requires_geo": "serviceArea.radiusKm",
  "errors.site.location.empty_service_area": "serviceArea",
  "errors.site.location.primary_hidden": "isPrimary",
  "errors.site.location.primary_required": "isPrimary",
  "errors.site.location.name_required": "name",
  "errors.site.location.slug_taken": "slug",
  "errors.site.location.invalid_slug": "slug",
};

/**
 * Site › location: name, URL segment, address or service area, map point, phone, WhatsApp and
 * e-mail, opening hours with special days, primary flag and visibility.
 */
export function LocationForm({ initial }: { initial: SiteLocation | null }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, basePath, store, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial, store.countryCode || "TR"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [tried, setTried] = useState(false);
  const canEdit = can("site:write");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(toBody(draft)) !== JSON.stringify(toBody(toDraft(saved, store.countryCode || "TR"))) || draft.isPrimary !== (saved?.isPrimary ?? false);

  const local: Record<string, string> = {};
  if (!draft.name[store.defaultLocale]?.trim()) local.name = t("site.locations.errors.nameRequired");
  if (draft.hasAddress && Object.keys(addressProblems(draft.address)).length) local.address = t("site.identity.errors.addressIncomplete");
  if (!draft.hasAddress && !draft.hasServiceArea) local.address = t("site.locations.errors.addressOrArea");
  for (const k of ["phone", "whatsapp"] as const) if (draft[k].trim() && !isE164(normalizePhone(draft[k]))) local[k] = t("site.identity.errors.phoneInvalid");
  if (draft.email.trim() && !isValidEmail(draft.email)) local.email = t("site.identity.errors.emailInvalid");
  if ((draft.lat.trim() || draft.lng.trim()) && (!draft.lat.trim() || !draft.lng.trim() || Math.abs(Number(draft.lat)) > 90 || Math.abs(Number(draft.lng)) > 180)) local.geo = t("site.locations.errors.geoInvalid");
  if (draft.hasServiceArea && !draft.places.some((p) => p.il.trim()) && !draft.radiusKm.trim() && !draft.countries.trim()) local.serviceArea = t("site.locations.errors.areaEmpty");
  if (draft.hasServiceArea && draft.radiusKm.trim() && !(draft.lat.trim() && draft.lng.trim())) local["serviceArea.radiusKm"] = t("site.locations.errors.radiusNeedsGeo");
  if (draft.isPrimary && draft.status !== "active") local.isPrimary = t("site.locations.errors.primaryHidden");

  const described = error ? describeError(error, FIELD_FOR_KEY) : null;
  const msg = (key: string) => (tried ? local[key] : undefined) ?? described?.fields[key] ?? Object.entries(described?.fields ?? {}).find(([p]) => p.startsWith(`${key}.`))?.[1] ?? null;
  const subError = (prefix: string) => (p: string) => described?.fields[`${prefix}.${p}`];
  const summary = described ? Object.entries(described.fields).map(([p, m]) => ({ fieldId: `loc-${p.split(".")[0]}`, message: m, label: t.maybe(`site.locations.fields.${p.split(".")[0]}`) ?? p })) : [];

  const save = async () => {
    setTried(true);
    if (Object.keys(local).length) return;
    setPending(true);
    setError(null);
    try {
      const body = toBody(draft);
      let next: SiteLocation;
      if (saved) {
        const before = toBody(toDraft(saved, store.countryCode || "TR"));
        const patch: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
        if (draft.isPrimary !== saved.isPrimary) patch.isPrimary = draft.isPrimary;
        next = Object.keys(patch).length ? await bff<SiteLocation>(`${apiBase}/site/locations/${saved.id}`, { method: "PATCH", body: patch }) : saved;
      } else {
        next = await bff<SiteLocation>(`${apiBase}/site/locations`, { method: "POST", body: { ...body, ...(draft.isPrimary ? { isPrimary: true } : {}) } });
        toast({ tone: "success", title: t("site.locations.created") });
        router.replace(`${basePath}/site/locations/${next.id}`);
      }
      setSaved(next);
      setDraft(toDraft(next, store.countryCode || "TR"));
      setTried(false);
      if (initial) toast({ tone: "success", title: t("site.locations.saved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const localItems = tried ? Object.entries(local).map(([k, m]) => ({ fieldId: `loc-${k.split(".")[0]}`, message: m, label: t.maybe(`site.locations.fields.${k.split(".")[0]}`) ?? k })) : [];
  const title = saved ? labelText(saved.name, locale, saved.slug) : t("site.locations.new");

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
        title={title}
        breadcrumbs={[{ label: t("site.locations.title"), href: `${basePath}/site/locations` }]}
        actions={
          canEdit ? (
            <>
              <Button disabled={!dirty || pending} onClick={() => { setDraft(toDraft(saved, store.countryCode || "TR")); setError(null); setTried(false); }}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={pending} disabled={!dirty && Boolean(saved)}>
                {saved ? t("common.save") : t("site.locations.create")}
              </Button>
            </>
          ) : null
        }
      />
      {!canEdit ? <InlineAlert tone="info">{t("site.readOnly", { permission: "site:write" })}</InlineAlert> : null}
      {localItems.length ? <ErrorSummary message={t("site.identity.localErrors", { count: localItems.length })} items={localItems} /> : null}
      {described ? <ErrorSummary message={summary.length ? undefined : described.message} items={summary} /> : null}

      <Card title={t("site.locations.basicsTitle")} padding="form">
        <div className="flex flex-col gap-4">
          <div id="loc-name">
            <LocalizedTextField
              label={t("site.locations.fields.name")}
              description={t("site.locations.nameHint")}
              locales={store.supportedLocales}
              defaultLocale={store.defaultLocale}
              value={draft.name}
              maxLength={120}
              required
              disabled={!canEdit}
              errors={msg("name") ? { [store.defaultLocale]: msg("name")! } : {}}
              onChange={(name) => set("name", name)}
            />
          </div>
          <Field id="loc-slug" label={t("site.locations.fields.slug")} description={t("site.locations.slugHint", { slug: draft.slug || slugify(draft.name[store.defaultLocale] ?? "") || "…" })} optional error={msg("slug")}>
            <Input value={draft.slug} maxLength={63} className="font-mono" disabled={!canEdit} placeholder={slugify(draft.name[store.defaultLocale] ?? "")} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium text-fg">{t("site.locations.fields.status")}</legend>
            <RadioGroup
              value={draft.status}
              disabled={!canEdit}
              aria-label={t("site.locations.fields.status")}
              onValueChange={(v) => setDraft((d) => ({ ...d, status: v as Draft["status"], ...(v === "hidden" ? { isPrimary: false } : {}) }))}
              options={[
                { value: "active", label: t("statuses.siteLocation.active"), description: t("site.locations.activeHint") },
                { value: "hidden", label: t("statuses.siteLocation.hidden"), description: t("site.locations.hiddenHint") },
              ]}
            />
          </fieldset>
          <div id="loc-isPrimary">
            <Switch
              checked={draft.isPrimary}
              disabled={!canEdit || draft.status !== "active" || Boolean(saved?.isPrimary)}
              onCheckedChange={(c) => set("isPrimary", c)}
              label={t("site.locations.fields.isPrimary")}
              description={saved?.isPrimary ? t("site.locations.primaryLocked") : t("site.locations.primaryHint")}
            />
            {msg("isPrimary") ? <p className="mt-1 text-sm text-danger">{msg("isPrimary")}</p> : null}
          </div>
        </div>
      </Card>

      <Card title={t("site.locations.addressTitle")} description={t("site.locations.addressDescription")} padding="form">
        <div id="loc-address" className="flex flex-col gap-4">
          <Checkbox checked={draft.hasAddress} disabled={!canEdit} onCheckedChange={(c) => set("hasAddress", c)} label={t("site.locations.publishAddress")} description={t("site.locations.publishAddressHint")} />
          {draft.hasAddress ? <AddressFields value={draft.address} idPrefix="loc-addr" disabled={!canEdit} showLocalErrors={tried} errorAt={subError("address")} onChange={(a) => set("address", a)} /> : null}
          {msg("address") ? <p className="text-sm text-danger">{msg("address")}</p> : null}
          <fieldset id="loc-geo" className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium text-fg">{t("site.locations.fields.geo")}</legend>
            <p className="-mt-1 text-sm text-fg-muted">{t("site.locations.geoHint")}</p>
            <div className="flex flex-wrap gap-3">
              <Field label={t("content.fields.lat")} className="w-44">
                <Input type="number" step="any" min={-90} max={90} value={draft.lat} disabled={!canEdit} onChange={(e) => set("lat", e.target.value)} />
              </Field>
              <Field label={t("content.fields.lng")} className="w-44">
                <Input type="number" step="any" min={-180} max={180} value={draft.lng} disabled={!canEdit} onChange={(e) => set("lng", e.target.value)} />
              </Field>
            </div>
            <Checkbox checked={draft.approximate} disabled={!canEdit} onCheckedChange={(c) => set("approximate", c)} label={t("content.fields.approximate")} description={t("content.fields.approximateHint")} />
            {msg("geo") ? <p className="text-sm text-danger">{msg("geo")}</p> : null}
          </fieldset>
          <fieldset id="loc-serviceArea" className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium text-fg">{t("site.locations.fields.serviceArea")}</legend>
            <Checkbox checked={draft.hasServiceArea} disabled={!canEdit} onCheckedChange={(c) => set("hasServiceArea", c)} label={t("site.locations.serviceAreaToggle")} description={t("site.locations.serviceAreaHint")} />
            {draft.hasServiceArea ? (
              <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                {draft.places.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Field label={t("site.address.il")} className="w-48">
                      <Input value={p.il} maxLength={120} disabled={!canEdit} onChange={(e) => set("places", draft.places.map((x, j) => (j === i ? { ...x, il: e.target.value } : x)))} />
                    </Field>
                    <Field label={t("site.address.ilce")} optional className="w-48">
                      <Input value={p.ilce} maxLength={120} disabled={!canEdit} onChange={(e) => set("places", draft.places.map((x, j) => (j === i ? { ...x, ilce: e.target.value } : x)))} />
                    </Field>
                    <Button size="icon-md" variant="ghost" disabled={!canEdit} aria-label={t("site.locations.removePlace", { n: i + 1 })} onClick={() => set("places", draft.places.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" className="self-start" disabled={!canEdit || draft.places.length >= 100} onClick={() => set("places", [...draft.places, { il: "", ilce: "" }])}>
                  <Plus aria-hidden="true" />
                  {t("site.locations.addPlace")}
                </Button>
                <div className="flex flex-wrap gap-3">
                  <Field label={t("site.locations.radiusKm")} optional className="w-40" error={msg("serviceArea.radiusKm")}>
                    <Input type="number" min={0} max={1000} value={draft.radiusKm} suffix="km" disabled={!canEdit} onChange={(e) => set("radiusKm", e.target.value)} />
                  </Field>
                  <Field label={t("site.locations.countries")} description={t("site.locations.countriesHint")} optional className="w-64">
                    <Input value={draft.countries} maxLength={200} className="uppercase" disabled={!canEdit} onChange={(e) => set("countries", e.target.value)} />
                  </Field>
                </div>
                {msg("serviceArea") ? <p className="text-sm text-danger">{msg("serviceArea")}</p> : null}
              </div>
            ) : null}
          </fieldset>
        </div>
      </Card>

      <Card title={t("site.locations.contactTitle")} padding="form">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="loc-phone" label={t("site.locations.fields.phone")} optional error={msg("phone")}>
            <Input type="tel" value={draft.phone} placeholder="+90 212 000 00 00" disabled={!canEdit} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="loc-whatsapp" label={t("site.locations.fields.whatsapp")} description={t("site.locations.whatsappHint")} optional error={msg("whatsapp")}>
            <Input type="tel" value={draft.whatsapp} placeholder="+90 5xx xxx xx xx" disabled={!canEdit} onChange={(e) => set("whatsapp", e.target.value)} />
          </Field>
          <Field id="loc-email" label={t("site.locations.fields.email")} optional error={msg("email")}>
            <Input type="email" value={draft.email} maxLength={254} disabled={!canEdit} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={t("site.locations.hoursTitle")} description={t("site.locations.hoursDescription")} padding="form">
        <div id="loc-openingHours">
          <OpeningHoursEditor
            idPrefix="loc-oh"
            value={draft.openingHours}
            onChange={(h) => set("openingHours", h)}
            locales={store.supportedLocales}
            defaultLocale={store.defaultLocale}
            errorAt={subError("openingHours")}
            disabled={!canEdit}
          />
        </div>
      </Card>
    </form>
  );
}
