"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { ErrorSummary, FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { Store } from "@/lib/api/types";
import { intlLocale } from "@/lib/i18n/config";
import { currencyOptions, timeZoneOptions } from "@/lib/intl-options";
import { LOCALE_REGISTRY, localeLabel } from "@/lib/locales";

type Patch = Partial<Pick<Store, "name" | "defaultLocale" | "supportedLocales" | "supportedCurrencies" | "timezone">> & { status?: "setup" | "active" | "paused" };

const FIELD_FOR_KEY: Record<string, string> = {
  "errors.store.default_locale_not_supported": "defaultLocale",
  "errors.store.default_currency_required": "supportedCurrencies",
  "errors.store.invalid_timezone": "timezone",
};

/** One independently saved section: PATCH with only its own fields, then reload the store context. */
function useSectionSave() {
  const { apiBase } = useStore();
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [, startRefresh] = useTransition();

  const save = async (patch: Patch): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await bff<Store>(apiBase, { method: "PATCH", body: patch });
      toast({ tone: "success", title: t("settings.general.saved") });
      startRefresh(() => router.refresh());
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, save, clearError: () => setError(null) };
}

function SectionError({ error, fieldIds }: { error: ApiErrorInfo | null; fieldIds: Record<string, { id: string; label: string }> }) {
  const { describeError } = useI18n();
  if (!error) return null;
  const d = describeError(error, FIELD_FOR_KEY);
  const items = Object.entries(d.fields).flatMap(([name, message]) => {
    const f = fieldIds[name];
    return f ? [{ fieldId: f.id, message, label: f.label }] : [];
  });
  return <ErrorSummary message={items.length ? undefined : d.message} items={items} />;
}

function NameSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { t, describeError } = useI18n();
  const [name, setName] = useState(store.name);
  const { pending, error, save, clearError } = useSectionSave();
  const fieldError = error ? (describeError(error).fields.name ?? null) : null;
  return (
    <FormSection
      title={t("settings.general.identity.title")}
      description={t("settings.general.identity.description")}
      canEdit={canEdit}
      pending={pending}
      dirty={name.trim() !== store.name}
      onCancel={() => {
        setName(store.name);
        clearError();
      }}
      onSubmit={() => void save({ name: name.trim() })}
      error={<SectionError error={error} fieldIds={{ name: { id: "store-name", label: t("settings.general.identity.name") } }} />}
    >
      <Field id="store-name" label={t("settings.general.identity.name")} required error={fieldError}>
        <Input value={name} maxLength={120} autoComplete="organization" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("settings.general.identity.slug")} description={t("settings.general.identity.slugHelp")}>
        <Input value={store.slug} readOnly disabled className="font-mono" />
      </Field>
    </FormSection>
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function LanguagesSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { t, locale, describeError } = useI18n();
  const [supported, setSupported] = useState<string[]>(store.supportedLocales);
  const [defaultLocale, setDefaultLocale] = useState(store.defaultLocale);
  const { pending, error, save, clearError } = useSectionSave();

  const dirty = !sameSet(supported, store.supportedLocales) || defaultLocale !== store.defaultLocale;
  const fields = error ? describeError(error, FIELD_FOR_KEY).fields : {};
  const toggle = (code: string, on: boolean) => {
    setSupported((cur) => (on ? LOCALE_REGISTRY.map((l) => l.code).filter((c) => c === code || cur.includes(c)) : cur.filter((c) => c !== code)));
  };

  return (
    <FormSection
      title={t("settings.general.languages.title")}
      description={t("settings.general.languages.description")}
      canEdit={canEdit}
      pending={pending}
      dirty={dirty}
      onCancel={() => {
        setSupported(store.supportedLocales);
        setDefaultLocale(store.defaultLocale);
        clearError();
      }}
      onSubmit={() => void save({ supportedLocales: supported, defaultLocale })}
      error={
        <SectionError
          error={error}
          fieldIds={{
            defaultLocale: { id: "store-default-locale", label: t("settings.general.languages.default") },
            supportedLocales: { id: "store-locales", label: t("settings.general.languages.supported") },
          }}
        />
      }
    >
      <fieldset id="store-locales" tabIndex={-1} className="flex flex-col gap-2 outline-none" aria-describedby="store-locales-help">
        <legend className="mb-1 text-base font-medium text-fg">{t("settings.general.languages.supported")}</legend>
        <p id="store-locales-help" className="-mt-1 mb-1 text-sm text-fg-muted">
          {t("settings.general.languages.supportedHelp")}
        </p>
        <ul className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
          {LOCALE_REGISTRY.map((l) => {
            const isDefault = l.code === defaultLocale;
            return (
              <li key={l.code} className="flex items-start gap-2">
                <Checkbox
                  checked={supported.includes(l.code)}
                  disabled={isDefault}
                  onCheckedChange={(on) => toggle(l.code, on)}
                  label={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>{localeLabel(l.code, locale)}</span>
                      {l.name !== localeLabel(l.code, locale) ? (
                        <span lang={l.htmlLang} dir={l.dir} className="text-sm text-fg-muted">
                          {l.name}
                        </span>
                      ) : null}
                      <code className="font-mono text-xs text-fg-subtle">{l.code}</code>
                      {l.dir === "rtl" ? <Badge tone="info">{t("settings.general.languages.rtl")}</Badge> : null}
                      {isDefault ? <Badge tone="accent">{t("common.default")}</Badge> : null}
                    </span>
                  }
                  {...(isDefault ? { description: t("settings.general.languages.defaultLocked") } : {})}
                />
              </li>
            );
          })}
        </ul>
        {fields.supportedLocales ? <p className="text-sm text-danger">{fields.supportedLocales}</p> : null}
      </fieldset>
      <Field id="store-default-locale" label={t("settings.general.languages.default")} description={t("settings.general.languages.defaultHelp")} error={fields.defaultLocale ?? null}>
        <Select
          value={defaultLocale}
          onValueChange={setDefaultLocale}
          options={supported.map((c) => ({ value: c, label: localeLabel(c, locale) }))}
          className="sm:w-72"
        />
      </Field>
      {supported.some((c) => LOCALE_REGISTRY.find((l) => l.code === c)?.dir === "rtl") ? (
        <InlineAlert tone="info">{t("settings.general.languages.rtlNote")}</InlineAlert>
      ) : null}
    </FormSection>
  );
}

function CurrenciesSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { t, locale, describeError } = useI18n();
  const [currencies, setCurrencies] = useState<string[]>(store.supportedCurrencies);
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const { pending, error, save, clearError } = useSectionSave();
  useEffect(() => setOptions(currencyOptions(locale)), [locale]);
  const names = useMemo(() => new Intl.DisplayNames([intlLocale(locale)], { type: "currency" }), [locale]);
  const fields = error ? describeError(error, FIELD_FOR_KEY).fields : {};
  // The default currency is always accepted; the combobox cannot remove it.
  const onChange = (next: string[]) => setCurrencies(next.includes(store.defaultCurrency) ? next : [store.defaultCurrency, ...next]);

  return (
    <FormSection
      title={t("settings.general.currencies.title")}
      description={t("settings.general.currencies.description")}
      canEdit={canEdit}
      pending={pending}
      dirty={!sameSet(currencies, store.supportedCurrencies)}
      onCancel={() => {
        setCurrencies(store.supportedCurrencies);
        clearError();
      }}
      onSubmit={() => void save({ supportedCurrencies: currencies })}
      error={<SectionError error={error} fieldIds={{ supportedCurrencies: { id: "store-currencies", label: t("settings.general.currencies.supported") } }} />}
    >
      <Field label={t("settings.general.currencies.default")} description={t("settings.general.currencies.defaultHelp")}>
        <Input value={`${names.of(store.defaultCurrency) ?? store.defaultCurrency} (${store.defaultCurrency})`} readOnly disabled />
      </Field>
      <Field id="store-currencies" label={t("settings.general.currencies.supported")} description={t("settings.general.currencies.supportedHelp")} error={fields.supportedCurrencies ?? null}>
        <Combobox multiple options={options} value={currencies} onChange={onChange} searchPlaceholder={t("settings.general.currencies.search")} />
      </Field>
    </FormSection>
  );
}

function RegionSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { t, locale, describeError } = useI18n();
  const [timezone, setTimezone] = useState<string | null>(store.timezone);
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const { pending, error, save, clearError } = useSectionSave();
  useEffect(() => setOptions(timeZoneOptions()), []);
  const regions = useMemo(() => new Intl.DisplayNames([intlLocale(locale)], { type: "region" }), [locale]);
  const fields = error ? describeError(error, FIELD_FOR_KEY).fields : {};
  return (
    <FormSection
      title={t("settings.general.region.title")}
      description={t("settings.general.region.description")}
      canEdit={canEdit}
      pending={pending}
      dirty={Boolean(timezone) && timezone !== store.timezone}
      onCancel={() => {
        setTimezone(store.timezone);
        clearError();
      }}
      onSubmit={() => timezone && void save({ timezone })}
      error={<SectionError error={error} fieldIds={{ timezone: { id: "store-timezone", label: t("settings.general.region.timezone") } }} />}
    >
      <Field id="store-timezone" label={t("settings.general.region.timezone")} description={t("settings.general.region.timezoneHelp")} error={fields.timezone ?? null}>
        <Combobox options={options} value={timezone} onChange={setTimezone} searchPlaceholder={t("settings.general.region.searchTimezone")} />
      </Field>
      <Field label={t("settings.general.region.country")} description={t("settings.general.region.countryHelp")}>
        <Input value={`${regions.of(store.countryCode) ?? store.countryCode} (${store.countryCode})`} readOnly disabled />
      </Field>
    </FormSection>
  );
}

const STATUSES = ["setup", "active", "paused"] as const;

function StatusSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { t } = useI18n();
  const current = (STATUSES as readonly string[]).includes(store.status) ? (store.status as (typeof STATUSES)[number]) : null;
  const [status, setStatus] = useState<string>(current ?? "");
  const { pending, error, save, clearError } = useSectionSave();
  if (!current) {
    return (
      <FormSection title={t("settings.general.status.title")} canEdit={false} onSubmit={() => undefined}>
        <InlineAlert tone="warning">{t("settings.general.status.closed")}</InlineAlert>
      </FormSection>
    );
  }
  return (
    <FormSection
      title={t("settings.general.status.title")}
      description={t("settings.general.status.description")}
      canEdit={canEdit}
      pending={pending}
      dirty={status !== current}
      onCancel={() => {
        setStatus(current);
        clearError();
      }}
      onSubmit={() => void save({ status: status as (typeof STATUSES)[number] })}
      error={<SectionError error={error} fieldIds={{}} />}
    >
      <RadioGroup
        name="store-status"
        aria-label={t("settings.general.status.title")}
        value={status}
        onValueChange={setStatus}
        options={STATUSES.map((s) => ({ value: s, label: t(`statuses.store.${s}`), description: t(`settings.general.status.help.${s}`) }))}
      />
    </FormSection>
  );
}

/** Settings › General: store name, content languages, currencies, time zone and store status. */
export function GeneralSettings() {
  const { t } = useI18n();
  const { store, can } = useStore();
  const canEdit = can("settings:write");
  const readOnlyNote: ReactNode = canEdit ? null : (
    <InlineAlert tone="info" title={t("settings.readOnlyTitle")}>
      <span className="inline-flex items-center gap-1.5">
        <Lock aria-hidden="true" className="size-3.5" />
        {t("settings.readOnlyBody", { permission: "settings:write" })}
      </span>
    </InlineAlert>
  );
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader title={t("settings.general.title")} meta={t("settings.general.meta")} />
      {readOnlyNote}
      {/* Each section is keyed by its saved values: it starts over only when they change on the server. */}
      <NameSection key={`name:${store.name}`} store={store} canEdit={canEdit} />
      <LanguagesSection key={`locales:${store.defaultLocale}:${store.supportedLocales.join(",")}`} store={store} canEdit={canEdit} />
      <CurrenciesSection key={`currencies:${store.supportedCurrencies.join(",")}`} store={store} canEdit={canEdit} />
      <RegionSection key={`tz:${store.timezone}`} store={store} canEdit={canEdit} />
      <StatusSection key={`status:${store.status}`} store={store} canEdit={canEdit} />
    </div>
  );
}
