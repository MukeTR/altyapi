"use client";

import { Calculator, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useProductSearch } from "@/components/commerce/use-product-search";
import { QuantityInput } from "@/components/commerce/quantity-input";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { ErrorSummary, FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { MoneyInput } from "@/components/ui/money-input";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ProductDetail } from "@/lib/commerce/types";
import { PROFIT_GUARD_POLICIES, type EkosistemSettings, type ProfitCheckResult, type ProfitGuardPolicy } from "@/lib/ekosistem/types";
import { ProfitCheckLines } from "./profit-check-lines";

interface Line {
  key: number;
  productId: string | null;
  product: ProductDetail | null;
  variantId: string | null;
  quantity: number;
  price: string | null;
}

function variantLabel(product: ProductDetail, variantId: string, locale: string): string {
  const v = product.variants.find((x) => x.id === variantId);
  if (!v) return variantId;
  const values = v.optionValueIds.flatMap((id) => product.options.flatMap((o) => o.values.filter((val) => val.id === id).map((val) => val.value[locale] ?? Object.values(val.value)[0] ?? "")));
  return [values.filter(Boolean).join(" / "), v.sku].filter(Boolean).join(" · ") || v.id.slice(0, 8);
}

function CheckLine({ line, onChange, onRemove, removable, index }: { line: Line; onChange: (patch: Partial<Line>) => void; onRemove: () => void; removable: boolean; index: number }) {
  const { t, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const search = useProductSearch(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const pick = async (productId: string | null) => {
    onChange({ productId, product: null, variantId: null, price: null });
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const product = await bff<ProductDetail>(`${apiBase}/products/${productId}`);
      const first = product.variants[0];
      onChange({ productId, product, variantId: first?.id ?? null, price: first?.price?.amount ?? null });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setLoading(false);
    }
  };

  const productOptions = search.items.map((p) => ({ value: p.id, label: p.title || p.handle, description: p.skus[0] ?? "" }));
  if (line.product && !productOptions.some((o) => o.value === line.productId)) {
    const title = line.product.translations[store.defaultLocale]?.title ?? Object.values(line.product.translations)[0]?.title ?? line.product.id;
    productOptions.unshift({ value: line.product.id, label: title, description: "" });
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{t("karmatik.check.lineN", { n: index + 1 })}</span>
        {removable ? (
          <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={t("karmatik.check.removeLine", { n: index + 1 })}>
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("karmatik.check.product")}>
          <Combobox
            options={productOptions}
            value={line.productId}
            onChange={(v) => void pick(v)}
            onSearch={search.search}
            loading={search.loading}
            error={search.error ? describeError(search.error.toInfo()).message : null}
            onRetry={search.retry}
            placeholder={t("karmatik.check.pickProduct")}
          />
        </Field>
        <Field label={t("karmatik.check.variant")} error={error ? describeError(error).message : null}>
          <Select
            value={line.variantId ?? ""}
            disabled={!line.product || loading}
            // Radix reports "" when options and value arrive in the same render; that is not a choice.
            onValueChange={(variantId) => variantId && onChange({ variantId, price: line.product?.variants.find((v) => v.id === variantId)?.price?.amount ?? line.price })}
            options={(line.product?.variants ?? []).map((v) => ({ value: v.id, label: variantLabel(line.product!, v.id, store.defaultLocale) }))}
            placeholder={loading ? t("common.loading") : t("karmatik.check.pickVariant")}
          />
        </Field>
        <Field label={t("karmatik.check.proposedPrice")} description={t("karmatik.check.proposedHelp")}>
          <MoneyInput value={line.price} onChange={(price) => onChange({ price })} currency={store.defaultCurrency} />
        </Field>
        <Field label={t("karmatik.check.quantity")}>
          <QuantityInput value={line.quantity} onChange={(quantity) => onChange({ quantity })} min={1} max={10000} label={t("karmatik.check.quantity")} />
        </Field>
      </div>
    </li>
  );
}

/** Try a price against the profit guard without saving anything (POST …/karmatik/profit-check). */
function ProfitCheckTool() {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: null, product: null, variantId: null, quantity: 1, price: null }]);
  const [action, setAction] = useState("price_change");
  const [result, setResult] = useState<ProfitCheckResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const ready = lines.every((l) => l.variantId && l.price);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      setResult(
        await bff<ProfitCheckResult>(`${apiBase}/ekosistem/karmatik/profit-check`, {
          method: "POST",
          body: { action, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: l.price })) },
        }),
      );
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  if (!can("catalog:read")) return null;
  return (
    <Card padding="form" title={t("karmatik.check.title")} description={t("karmatik.check.description")}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error ? <ErrorSummary message={describeError(error).message} items={[]} /> : null}
        <Field label={t("karmatik.check.action")}>
          <Select
            value={action}
            onValueChange={setAction}
            className="sm:w-72"
            options={(["price_change", "discount", "campaign"] as const).map((a) => ({ value: a, label: t(`karmatik.check.actions.${a}`) }))}
          />
        </Field>
        <ul className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <CheckLine
              key={l.key}
              index={i}
              line={l}
              removable={lines.length > 1}
              onRemove={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
              onChange={(patch) => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))}
            />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" disabled={lines.length >= 20} onClick={() => setLines((cur) => [...cur, { key: Date.now(), productId: null, product: null, variantId: null, quantity: 1, price: null }])}>
            <Plus aria-hidden="true" />
            {t("karmatik.check.addLine")}
          </Button>
          <Button type="submit" variant="primary" loading={pending} disabled={!ready}>
            <Calculator aria-hidden="true" />
            {t("karmatik.check.run")}
          </Button>
        </div>
        <div aria-live="polite">{result ? <ProfitCheckLines result={result} /> : null}</div>
      </form>
    </Card>
  );
}

/** Kârmatik › Profit guard: the store policy for admin price actions, and a profit check tool. */
export function ProfitGuardSettings({ initial }: { initial: EkosistemSettings }) {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const { toast } = useToast();
  const [saved, setSaved] = useState<ProfitGuardPolicy>(initial.profitGuard);
  const [policy, setPolicy] = useState<ProfitGuardPolicy>(initial.profitGuard);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const canEdit = can("settings:write");
  useEffect(() => setPolicy(saved), [saved]);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await bff<EkosistemSettings>(`${apiBase}/ekosistem/settings`, { method: "PUT", body: { profitGuard: policy } });
      setSaved(res.profitGuard);
      toast({ tone: "success", title: t("karmatik.guard.saved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader title={t("karmatik.guard.title")} meta={t("karmatik.guard.meta")} breadcrumbs={[{ label: t("karmatik.title") }]} />
      {!canEdit ? <InlineAlert tone="info">{t("settings.readOnlyBody", { permission: "settings:write" })}</InlineAlert> : null}
      <FormSection
        title={t("karmatik.guard.policyTitle")}
        description={t("karmatik.guard.policyDescription")}
        canEdit={canEdit}
        pending={pending}
        dirty={policy !== saved}
        onCancel={() => {
          setPolicy(saved);
          setError(null);
        }}
        onSubmit={() => void save()}
        error={error ? <ErrorSummary message={describeError(error).message} items={[]} /> : null}
      >
        <RadioGroup
          name="profit-guard"
          aria-label={t("karmatik.guard.policyTitle")}
          value={policy}
          onValueChange={(v) => setPolicy(v as ProfitGuardPolicy)}
          disabled={!canEdit}
          options={PROFIT_GUARD_POLICIES.map((p) => ({ value: p, label: t(`karmatik.guard.policies.${p}.title`), description: t(`karmatik.guard.policies.${p}.description`) }))}
        />
        <p className="text-sm text-fg-muted">{t("karmatik.guard.neverCustomers")}</p>
      </FormSection>
      {can("karmatik:read") ? <ProfitCheckTool /> : null}
    </div>
  );
}
