"use client";

import { useActionState, useEffect, useState } from "react";
import { createStoreAction, type CreateStoreState } from "@/app/actions/tenancy";
import { FormAlert } from "@/components/auth/form-alert";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import type { OrganizationSummary } from "@/lib/api/types";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/lib/intl-options";
import { LOCALE_REGISTRY, localeLabel } from "@/lib/locales";
import { SITE_KINDS } from "@/lib/site/types";
import { slugify } from "@/lib/slug";

const INITIAL: CreateStoreState = { error: null, values: {} };
const FIELD_FOR_KEY = {
  "errors.store.slug_taken": "slug",
  "errors.store.slug_reserved": "slug",
  "errors.store.invalid_slug": "slug",
  "errors.store.invalid_timezone": "timezone",
};

export interface CreateStoreFormProps {
  organization: OrganizationSummary;
  /** Platform root domain for the address preview ("altyapi.store"). */
  rootDomain: string;
  onCancel?: () => void;
}

/** POST /v1/organizations/:id/stores; on success the new store opens. */
export function CreateStoreForm({ organization, rootDomain, onCancel }: CreateStoreFormProps) {
  const { t, locale, describeError } = useI18n();
  const [state, action, pending] = useActionState(createStoreAction, INITIAL);
  const error = state.error ? describeError(state.error, FIELD_FOR_KEY) : null;
  const [name, setName] = useState(state.values.name ?? "");
  const [slug, setSlug] = useState(state.values.slug ?? "");
  const [currency, setCurrency] = useState<string | null>(state.values.defaultCurrency || "TRY");
  const [timezone, setTimezone] = useState<string | null>(state.values.timezone || "Europe/Istanbul");
  const [country, setCountry] = useState<string | null>(state.values.countryCode || "TR");
  const [options, setOptions] = useState<{ tz: ComboboxOption[]; currency: ComboboxOption[]; country: ComboboxOption[] }>({ tz: [], currency: [], country: [] });

  useEffect(() => {
    setOptions({ tz: timeZoneOptions(), currency: currencyOptions(locale), country: countryOptions(locale) });
  }, [locale]);

  const previewSlug = slug.trim() ? slug.trim().toLowerCase() : slugify(name);
  const localeOptions = LOCALE_REGISTRY.map((l) => ({ value: l.code, label: localeLabel(l.code, locale) }));

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organization.id} />
      <input type="hidden" name="organizationSlug" value={organization.slug} />
      {error ? (
        <FormAlert tone="danger" focusKey={state}>
          {error.message}
        </FormAlert>
      ) : null}
      <Field label={t("onboarding.store.name")} error={error?.fields.name ?? null} required>
        <Input name="name" maxLength={120} autoComplete="organization" placeholder={t("onboarding.store.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field
        label={t("onboarding.store.slug")}
        optional
        description={previewSlug.length >= 3 ? t("onboarding.store.slugHint", { host: `${previewSlug}.${rootDomain}` }) : t("onboarding.store.slugHintEmpty")}
        error={error?.fields.slug ?? null}
      >
        <Input name="slug" maxLength={63} autoCapitalize="none" spellCheck={false} placeholder={slugify(name) || undefined} value={slug} onChange={(e) => setSlug(e.target.value)} suffix={`.${rootDomain}`} className="font-mono" />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium text-fg">{t("onboarding.store.siteKind")}</legend>
        <p className="-mt-1 text-sm text-fg-muted">{t("onboarding.store.siteKindHint")}</p>
        <RadioGroup
          name="siteKind"
          idPrefix="site-kind"
          aria-label={t("onboarding.store.siteKind")}
          defaultValue={state.values.siteKind || "ecommerce"}
          options={SITE_KINDS.map((k) => ({ value: k, label: t(`site.kinds.${k}`), description: t(`site.kindHints.${k}`) }))}
        />
        {error?.fields.siteKind ? <p className="text-sm text-danger">{error.fields.siteKind}</p> : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onboarding.store.defaultLocale")} description={t("onboarding.store.defaultLocaleHint")} error={error?.fields.defaultLocale ?? null}>
          <Select name="defaultLocale" defaultValue={state.values.defaultLocale || "tr"} options={localeOptions} />
        </Field>
        <Field label={t("onboarding.store.currency")} error={error?.fields.defaultCurrency ?? null}>
          <Combobox name="defaultCurrency" options={options.currency} value={currency} onChange={setCurrency} />
        </Field>
        <Field label={t("onboarding.store.timezone")} description={t("onboarding.store.timezoneHint")} error={error?.fields.timezone ?? null}>
          <Combobox name="timezone" options={options.tz} value={timezone} onChange={setTimezone} />
        </Field>
        <Field label={t("onboarding.store.country")} error={error?.fields.countryCode ?? null}>
          <Combobox name="countryCode" options={options.country} value={country} onChange={setCountry} />
        </Field>
      </div>
      <Field label={t("onboarding.store.contactEmail")} optional description={t("onboarding.store.contactEmailHint")} error={error?.fields.contactEmail ?? null}>
        <Input name="contactEmail" type="email" autoComplete="email" defaultValue={state.values.contactEmail ?? ""} />
      </Field>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          {t("onboarding.store.submit")}
        </Button>
      </div>
    </form>
  );
}
