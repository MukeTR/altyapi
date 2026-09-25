"use client";

import Link from "next/link";
import { Plus, Settings2, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Money } from "@/components/data/money";
import { Bps } from "@/components/data/percent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { controlClasses } from "@/components/ui/input-styles";
import { MoneyInput } from "@/components/ui/money-input";
import { ScrollX } from "@/components/ui/scroll-x";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Location, TaxClass } from "@/lib/commerce/types";
import { marginBps, profit, vatBreakdown } from "@/lib/commerce/money-math";
import { formatBps, formatMoney, formatNumber } from "@/lib/format";
import { localeDir, localeHtmlLang, localeLabel } from "@/lib/locales";
import { MAX_OPTIONS, combinationCount, labelIn, newKey, variantTitle, type OptionDraft, type ProductDraft, type VariantDraft } from "./product-draft";

export type FieldErrors = Record<string, string>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function OptionsEditor({
  options,
  locale,
  defaultLocale,
  disabled,
  errors,
  onChange,
}: {
  options: OptionDraft[];
  locale: string;
  defaultLocale: string;
  disabled: boolean;
  errors: FieldErrors;
  onChange: (next: OptionDraft[]) => void;
}) {
  const { t, locale: ui } = useI18n();
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const isDefault = locale === defaultLocale;
  const lang = { lang: localeHtmlLang(locale), dir: localeDir(locale) } as const;

  const update = (key: string, fn: (o: OptionDraft) => OptionDraft) => onChange(options.map((o) => (o.key === key ? fn(o) : o)));

  const addValue = (o: OptionDraft) => {
    const text = (newValues[o.key] ?? "").trim();
    if (!text) return;
    const exists = o.values.some((v) => labelIn(v.value, defaultLocale).toLocaleLowerCase("tr") === text.toLocaleLowerCase("tr"));
    if (!exists && o.values.length < 100) {
      update(o.key, (x) => ({ ...x, values: [...x.values, { key: newKey("ov"), value: { [defaultLocale]: text }, swatchColor: null, swatchAssetId: null }] }));
    }
    setNewValues((m) => ({ ...m, [o.key]: "" }));
  };

  return (
    <div className="flex flex-col gap-3">
      {options.map((o, oi) => {
        const nameError = errors[`options.${oi}.name`];
        return (
          <fieldset key={o.key} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <legend className="sr-only">{t("products.options.optionN", { n: oi + 1 })}</legend>
            <div className="flex items-end gap-2">
              <Field label={t("products.options.name")} error={nameError ?? null} className="flex-1" required={isDefault}>
                <Input
                  {...lang}
                  value={o.name[locale] ?? ""}
                  placeholder={isDefault ? t("products.options.namePlaceholder") : labelIn(o.name, defaultLocale)}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(e) => update(o.key, (x) => ({ ...x, name: { ...x.name, [locale]: e.target.value } }))}
                />
              </Field>
              <Button
                variant="ghost"
                size="icon-md"
                disabled={disabled}
                aria-label={t("products.options.remove", { name: labelIn(o.name, defaultLocale) || t("products.options.optionN", { n: oi + 1 }) })}
                onClick={() => onChange(options.filter((x) => x.key !== o.key))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{t("products.options.values")}</span>
              {o.values.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {o.values.map((v, vi) => {
                    const valueError = errors[`options.${oi}.values.${vi}`];
                    return (
                      <li key={v.key} className="flex items-center gap-1">
                        <input
                          {...lang}
                          value={v.value[locale] ?? ""}
                          placeholder={labelIn(v.value, defaultLocale)}
                          maxLength={120}
                          disabled={disabled}
                          aria-label={t("products.options.valueLabel", { option: labelIn(o.name, defaultLocale), n: vi + 1 })}
                          aria-invalid={valueError ? true : undefined}
                          onChange={(e) =>
                            update(o.key, (x) => ({ ...x, values: x.values.map((y) => (y.key === v.key ? { ...y, value: { ...y.value, [locale]: e.target.value } } : y)) }))
                          }
                          className={controlClasses({ size: "sm", invalid: Boolean(valueError), className: "w-32" })}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled || !isDefault}
                          aria-label={t("products.options.removeValue", { value: labelIn(v.value, defaultLocale) })}
                          onClick={() => update(o.key, (x) => ({ ...x, values: x.values.filter((y) => y.key !== v.key) }))}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {isDefault ? (
                <div className="flex items-center gap-2">
                  <input
                    {...lang}
                    value={newValues[o.key] ?? ""}
                    placeholder={t("products.options.addValuePlaceholder")}
                    aria-label={t("products.options.addValueLabel", { option: labelIn(o.name, defaultLocale) || t("products.options.optionN", { n: oi + 1 }) })}
                    maxLength={120}
                    disabled={disabled}
                    onChange={(e) => setNewValues((m) => ({ ...m, [o.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addValue(o);
                      }
                    }}
                    className={controlClasses({ size: "sm", className: "w-56" })}
                  />
                  <Button size="sm" disabled={disabled || !(newValues[o.key] ?? "").trim()} onClick={() => addValue(o)}>
                    {t("products.options.addValue")}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-fg-subtle">{t("products.options.translateHint", { locale: localeLabel(defaultLocale, ui) })}</p>
              )}
            </div>
          </fieldset>
        );
      })}
      {options.length < MAX_OPTIONS ? (
        <Button
          className="self-start"
          disabled={disabled || !isDefault}
          onClick={() => onChange([...options, { key: newKey("o"), name: {}, values: [] }])}
        >
          <Plus aria-hidden="true" />
          {options.length === 0 ? t("products.options.addFirst") : t("products.options.add")}
        </Button>
      ) : null}
      {combinationCount(options) > 250 ? <p className="text-sm text-danger">{t("products.options.tooMany")}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant fields
// ---------------------------------------------------------------------------

/** The tax class that applies to a variant: its own, the product's, else the store default. */
export function effectiveTaxClass(variant: VariantDraft, productTaxClassId: string | null, taxClasses: TaxClass[] | null): TaxClass | null {
  if (!taxClasses) return null;
  const id = variant.taxClassId ?? productTaxClassId;
  return (id ? taxClasses.find((c) => c.id === id) : undefined) ?? taxClasses.find((c) => c.isDefault) ?? null;
}

function PriceInsights({ variant, currency, taxClass }: { variant: VariantDraft; currency: string; taxClass: TaxClass | null }) {
  const { t, locale } = useI18n();
  if (variant.price === null) return null;
  const vat = taxClass ? vatBreakdown(variant.price, taxClass.rateBps, taxClass.pricesIncludeTax) : null;
  const margin = marginBps(variant.price, variant.cost);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-surface-muted px-3 py-2 text-sm" aria-live="polite">
      {vat && taxClass ? (
        <>
          <dt className="text-fg-muted">{t("products.pricing.net", { rate: formatBps(taxClass.rateBps, locale) })}</dt>
          <dd className="text-end tabular">
            <Money amount={vat.net} currency={currency} />
          </dd>
          <dt className="text-fg-muted">{taxClass.pricesIncludeTax ? t("products.pricing.vatIncluded") : t("products.pricing.vatAdded")}</dt>
          <dd className="text-end tabular">
            <Money amount={vat.vat} currency={currency} />
          </dd>
        </>
      ) : null}
      <dt className="text-fg-muted">{t("products.pricing.profit")}</dt>
      <dd className="text-end tabular">
        <Money amount={profit(variant.price, variant.cost)} currency={currency} />
      </dd>
      <dt className="text-fg-muted">{t("products.pricing.margin")}</dt>
      <dd className="text-end">
        <Bps value={margin} />
      </dd>
    </dl>
  );
}

export interface VariantFieldsProps {
  variant: VariantDraft;
  index: number;
  currency: string;
  productTaxClassId: string | null;
  taxClasses: TaxClass[] | null;
  locations: Location[];
  isNewProduct: boolean;
  disabled: boolean;
  errors: FieldErrors;
  onChange: (next: VariantDraft) => void;
}

/** Every field of one variant: pricing with VAT and margin hints, identifiers, stock and shipping. */
export function VariantFields({ variant, index, currency, productTaxClassId, taxClasses, locations, disabled, errors, onChange }: VariantFieldsProps) {
  const { t, locale } = useI18n();
  const { basePath } = useStore();
  const set = <K extends keyof VariantDraft>(key: K, value: VariantDraft[K]) => onChange({ ...variant, [key]: value });
  const e = (field: string) => errors[`variants.${index}.${field}`] ?? null;
  const taxClass = effectiveTaxClass(variant, productTaxClassId, taxClasses);
  const headingId = useId();

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-labelledby={`${headingId}-pricing`} className="flex flex-col gap-3">
        <h3 id={`${headingId}-pricing`} className="text-base font-semibold text-fg">
          {t("products.pricing.title")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("products.pricing.price")} required error={e("price")}>
            <MoneyInput currency={currency} value={variant.price} onChange={(v) => set("price", v)} disabled={disabled} />
          </Field>
          <Field label={t("products.pricing.compareAt")} optional error={e("compareAtPrice")} description={t("products.pricing.compareAtHint")}>
            <MoneyInput currency={currency} value={variant.compareAtPrice} onChange={(v) => set("compareAtPrice", v)} disabled={disabled} />
          </Field>
          <Field label={t("products.pricing.cost")} optional error={e("cost")} description={t("products.pricing.costHint")}>
            <MoneyInput currency={currency} value={variant.cost} onChange={(v) => set("cost", v)} disabled={disabled} />
          </Field>
        </div>
        <PriceInsights variant={variant} currency={currency} taxClass={taxClass} />
        {taxClasses ? (
          <Field label={t("products.tax.variantOverride")} optional description={t("products.tax.variantOverrideHint")}>
            <Select
              value={variant.taxClassId ?? "inherit"}
              onValueChange={(v) => set("taxClassId", v === "inherit" ? null : v)}
              disabled={disabled}
              options={[{ value: "inherit", label: t("products.tax.inherit") }, ...taxClasses.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </Field>
        ) : null}
      </div>

      <div role="group" aria-labelledby={`${headingId}-inventory`} className="flex flex-col gap-3">
        <h3 id={`${headingId}-inventory`} className="text-base font-semibold text-fg">
          {t("products.inventory.title")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("products.inventory.sku")} optional error={e("sku")}>
            <Input value={variant.sku} onChange={(ev) => set("sku", ev.target.value)} maxLength={100} disabled={disabled} className="font-mono" autoComplete="off" />
          </Field>
          <Field label={t("products.inventory.barcode")} optional error={e("barcode")} description={t("products.inventory.barcodeHint")}>
            <Input value={variant.barcode} onChange={(ev) => set("barcode", ev.target.value)} maxLength={64} disabled={disabled} className="font-mono" autoComplete="off" />
          </Field>
        </div>
        <Switch checked={variant.trackInventory} onCheckedChange={(v) => set("trackInventory", v)} disabled={disabled} label={t("products.inventory.track")} description={t("products.inventory.trackHint")} />
        {variant.trackInventory ? (
          <>
            <Switch checked={variant.allowBackorder} onCheckedChange={(v) => set("allowBackorder", v)} disabled={disabled} label={t("products.inventory.backorder")} description={t("products.inventory.backorderHint")} />
            {variant.id ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">{t("products.inventory.byLocation")}</span>
                {variant.inventory && variant.inventory.byLocation.length > 0 ? (
                  <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
                    {variant.inventory.byLocation.map((b) => (
                      <li key={b.locationId} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span>{locations.find((l) => l.id === b.locationId)?.name ?? t("products.inventory.unknownLocation")}</span>
                        <span className="tabular text-fg-muted">
                          {t("products.inventory.levels", { available: formatNumber(b.available, locale), onHand: formatNumber(b.onHand, locale), reserved: formatNumber(b.reserved, locale) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">{t("products.inventory.noStock")}</p>
                )}
                <Link href={`${basePath}/inventory?q=${encodeURIComponent(variant.sku || "")}`} className="self-start text-sm">
                  {t("products.inventory.adjust")}
                </Link>
              </div>
            ) : (
              <Field label={t("products.inventory.initial")} optional description={t("products.inventory.initialHint")} error={e("initialStock")}>
                <Input type="number" inputMode="numeric" min={0} max={10_000_000} value={variant.initialStock} onChange={(ev) => set("initialStock", ev.target.value)} disabled={disabled} className="w-40 tabular" />
              </Field>
            )}
          </>
        ) : null}
      </div>

      <div role="group" aria-labelledby={`${headingId}-shipping`} className="flex flex-col gap-3">
        <h3 id={`${headingId}-shipping`} className="text-base font-semibold text-fg">
          {t("products.shipping.variantTitle")}
        </h3>
        <Switch checked={variant.requiresShipping} onCheckedChange={(v) => set("requiresShipping", v)} disabled={disabled} label={t("products.shipping.requires")} />
        {variant.requiresShipping ? (
          <Field label={t("products.shipping.weight")} optional description={t("products.shipping.weightVariantHint")} error={e("weightGrams")}>
            <Input type="number" inputMode="numeric" min={0} max={1_000_000} value={variant.weightGrams} onChange={(ev) => set("weightGrams", ev.target.value)} disabled={disabled} suffix="g" className="w-40 tabular" />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant table
// ---------------------------------------------------------------------------

export function VariantsTable({
  draft,
  currency,
  taxClasses,
  locations,
  isNewProduct,
  disabled,
  errors,
  onChange,
}: {
  draft: ProductDraft;
  currency: string;
  taxClasses: TaxClass[] | null;
  locations: Location[];
  isNewProduct: boolean;
  disabled: boolean;
  errors: FieldErrors;
  onChange: (index: number, next: VariantDraft) => void;
}) {
  const { t, locale } = useI18n();
  const { store } = useStore();
  const [editing, setEditing] = useState<number | null>(null);
  const editingVariant = editing !== null ? draft.variants[editing] : undefined;
  const title = (v: VariantDraft) => variantTitle(draft, v, store.defaultLocale) || t("products.variants.default");

  return (
    <>
      <ScrollX className="rounded-lg border border-border" label={t("products.variants.caption")}>
        <table className="w-full min-w-[560px] border-collapse text-base">
          <caption className="sr-only">{t("products.variants.caption")}</caption>
          <thead className="bg-surface-muted">
            <tr className="border-b border-border text-xs text-fg-muted">
              <th scope="col" className="h-9 px-3 text-start font-medium">
                {t("products.variants.variant")}
              </th>
              <th scope="col" className="h-9 px-2 text-start font-medium">
                {t("products.variants.inCurrency", { label: t("products.pricing.price"), currency })}
              </th>
              <th scope="col" className="h-9 px-2 text-start font-medium">
                {t("products.inventory.sku")}
              </th>
              <th scope="col" className="h-9 px-2 text-end font-medium">
                {t("products.variants.stock")}
              </th>
              <th scope="col" className="h-9 px-2">
                <span className="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.variants.map((v, i) => {
              const name = title(v);
              const rowErrors = ["price", "compareAtPrice", "cost", "sku", "barcode"].filter((f) => errors[`variants.${i}.${f}`]);
              const extras = [
                v.compareAtPrice ? t("products.variants.compareAtShort", { amount: formatMoney(v.compareAtPrice, currency, locale) }) : null,
                v.cost ? t("products.variants.costShort", { amount: formatMoney(v.cost, currency, locale) }) : null,
              ].filter((x): x is string => x !== null);
              return (
                <tr key={v.key} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-start font-normal">
                    <span className="flex min-h-7 flex-col justify-center gap-1">
                      <span className="whitespace-nowrap font-medium text-fg">{name}</span>
                      {extras.length > 0 ? <span className="text-xs text-fg-muted tabular">{extras.join(" · ")}</span> : null}
                      {rowErrors.length > 0 ? (
                        <span className="text-xs text-danger">{rowErrors.map((f) => errors[`variants.${i}.${f}`]).join(" ")}</span>
                      ) : null}
                      {!v.id ? <Badge tone="accent" className="self-start">{t("products.variants.new")}</Badge> : null}
                    </span>
                  </th>
                  <td className="w-36 px-1.5 py-2">
                    <CellMoney label={t("products.variants.cellLabel", { field: t("products.pricing.price"), variant: name })} currency={currency} value={v.price} invalid={Boolean(errors[`variants.${i}.price`])} disabled={disabled} onChange={(x) => onChange(i, { ...v, price: x })} />
                  </td>
                  <td className="w-40 px-1.5 py-2">
                    <input
                      value={v.sku}
                      maxLength={100}
                      disabled={disabled}
                      aria-label={t("products.variants.cellLabel", { field: t("products.inventory.sku"), variant: name })}
                      aria-invalid={errors[`variants.${i}.sku`] ? true : undefined}
                      onChange={(e) => onChange(i, { ...v, sku: e.target.value })}
                      className={controlClasses({ size: "sm", invalid: Boolean(errors[`variants.${i}.sku`]), className: "font-mono" })}
                    />
                  </td>
                  <td className="w-24 px-1.5 py-2 text-end">
                    {!v.trackInventory ? (
                      <span className="inline-flex h-7 items-center text-sm text-fg-subtle">{t("products.variants.untracked")}</span>
                    ) : v.id ? (
                      <span className="inline-flex h-7 items-center tabular">{formatNumber(v.inventory?.available ?? 0, locale)}</span>
                    ) : (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={v.initialStock}
                        disabled={disabled}
                        aria-label={t("products.variants.cellLabel", { field: t("products.inventory.initial"), variant: name })}
                        onChange={(e) => onChange(i, { ...v, initialStock: e.target.value })}
                        className={controlClasses({ size: "sm", className: "w-20 text-end tabular" })}
                      />
                    )}
                  </td>
                  <td className="w-10 px-2 py-2">
                    <Button size="icon-sm" variant="ghost" aria-label={t("products.variants.edit", { name })} onClick={() => setEditing(i)}>
                      <Settings2 aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      {editing !== null && editingVariant ? (
        <Drawer open onOpenChange={(o) => !o && setEditing(null)} title={title(editingVariant)} description={t("products.variants.drawerDescription")} width={640}>
          <div className="px-5 py-4">
            <VariantFields
              variant={editingVariant}
              index={editing}
              currency={currency}
              productTaxClassId={draft.taxClassId}
              taxClasses={taxClasses}
              locations={locations}
              isNewProduct={isNewProduct}
              disabled={disabled}
              errors={errors}
              onChange={(next) => onChange(editing, next)}
            />
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

/** Compact money cell (MoneyInput without the field wrapper, labelled for screen readers). */
function CellMoney({ label, currency, value, invalid, disabled, onChange }: { label: string; currency: string; value: string | null; invalid?: boolean; disabled: boolean; onChange: (v: string | null) => void }) {
  return (
    <Field label={label} hideLabel error={null}>
      <div className={invalid ? "[&_input]:border-danger" : undefined}>
        <MoneyInput currency={currency} value={value} onChange={onChange} disabled={disabled} hideCurrency />
      </div>
    </Field>
  );
}
