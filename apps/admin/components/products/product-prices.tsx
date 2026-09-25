"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { Money } from "@/components/data/money";
import { Bps } from "@/components/data/percent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { PriceList, ProductDetail, ResolvedPrice } from "@/lib/commerce/types";
import { variantTitle, type ProductDraft } from "./product-draft";

/**
 * Prices per currency and price list. The table shows what shoppers pay today in every enabled
 * currency (resolved by the API, with the list that won); the form writes a variant price into a
 * chosen list. The API has no endpoint that lists a price list's entries, so a list's saved
 * prices are prefilled only where that list currently wins, and it cannot remove a variant's
 * price from a list: a blank row is left out of the request and the stored price, if any, stays.
 * The copy says both plainly instead of suggesting that a blank field means "no price".
 */
export function PriceListsCard({ product, draft, priceLists, resolved }: { product: ProductDetail; draft: ProductDraft; priceLists: PriceList[]; resolved: Record<string, ResolvedPrice[]> }) {
  const { t, describeError } = useI18n();
  const { store, apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const canWrite = can("pricing:write");
  const currencies = store.supportedCurrencies;
  const listById = new Map(priceLists.map((l) => [l.id, l]));
  const editable = priceLists.filter((l) => !(l.kind === "base" && l.currency === store.defaultCurrency));
  const [listId, setListId] = useState<string>(editable[0]?.id ?? "");
  const list = listById.get(listId);

  const prefill = useMemo(() => {
    const out: Record<string, { amount: string | null; compareAt: string | null }> = {};
    for (const v of product.variants) {
      const r = list ? resolved[list.currency]?.find((x) => x.variantId === v.id) : undefined;
      out[v.id] = r?.price && r.price.priceListId === listId ? { amount: r.price.amount, compareAt: r.price.compareAtAmount } : { amount: null, compareAt: null };
    }
    return out;
  }, [product.variants, list, resolved, listId]);

  const [values, setValues] = useState(prefill);
  const [prevList, setPrevList] = useState(listId);
  if (prevList !== listId) {
    setPrevList(listId);
    setValues(prefill);
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const title = (variantId: string) => {
    const i = product.variants.findIndex((v) => v.id === variantId);
    const d = draft.variants.find((v) => v.id === variantId) ?? draft.variants[i];
    return (d ? variantTitle(draft, d, store.defaultLocale) : "") || t("products.variants.default");
  };

  const entries = Object.entries(values).filter(([, v]) => v.amount !== null);

  const save = async () => {
    if (!list) return;
    setPending(true);
    setError(null);
    try {
      await bff(`${apiBase}/price-lists/${list.id}/prices`, {
        method: "PUT",
        body: { entries: entries.map(([variantId, v]) => ({ variantId, amount: v.amount, compareAtAmount: v.compareAt, minQuantity: 1 })) },
      });
      toast({ tone: "success", title: t("products.priceLists.saved", { list: list.name }) });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      title={t("products.priceLists.title")}
      description={t("products.priceLists.description")}
      actions={canWrite ? <Link href={`${basePath}/products/price-lists`} className="text-sm">{t("products.priceLists.manage")}</Link> : null}
    >
      <div className="flex flex-col gap-5">
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{t("products.priceLists.resolvedCaption")}</caption>
            <thead className="bg-surface-muted">
              <tr className="border-b border-border text-xs text-fg-muted">
                <th scope="col" className="h-9 px-3 text-start font-medium">
                  {t("products.variants.variant")}
                </th>
                {currencies.map((c) => (
                  <th key={c} scope="col" className="h-9 px-3 text-end font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-start font-normal">
                    {title(v.id)}
                  </th>
                  {currencies.map((c) => {
                    const r = resolved[c]?.find((x) => x.variantId === v.id);
                    const winner = r?.price ? listById.get(r.price.priceListId) : undefined;
                    return (
                      <td key={c} className="px-3 py-2 text-end align-top">
                        {r?.price ? (
                          <span className="flex flex-col items-end gap-0.5">
                            <Money amount={r.price.amount} currency={c} compareAt={r.price.compareAtAmount} />
                            <span className="text-xs text-fg-subtle">{winner?.name ?? t(`products.priceLists.kinds.${r.price.priceListKind}`)}</span>
                            {r.marginBps !== null ? (
                              <span className="text-xs text-fg-subtle">
                                {t("products.pricing.margin")}: <Bps value={r.marginBps} />
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-sm text-fg-subtle">{t("products.priceLists.noPrice")}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canWrite ? (
          editable.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("products.priceLists.noLists")}</p>
          ) : (
            <section aria-labelledby="price-list-editor" className="flex flex-col gap-3">
              <h3 id="price-list-editor" className="text-base font-semibold text-fg">
                {t("products.priceLists.editTitle")}
              </h3>
              {error ? (
                <FormAlert tone="danger" focusKey={error}>
                  {describeError(error).message}
                </FormAlert>
              ) : null}
              <Field label={t("products.priceLists.list")}>
                <Select
                  value={listId}
                  onValueChange={setListId}
                  options={editable.map((l) => ({ value: l.id, label: `${l.name} · ${l.currency} · ${t(`products.priceLists.kinds.${l.kind}`)}${l.isActive ? "" : ` (${t("products.priceLists.inactive")})`}` }))}
                />
              </Field>
              {list ? (
                <>
                  <p className="text-sm text-fg-muted">{t("products.priceLists.prefillNote")}</p>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {product.variants.map((v) => (
                      <li key={v.id} className="grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-end">
                        <span className="flex items-center gap-2 text-base text-fg sm:pb-1.5">
                          {title(v.id)}
                          {prefill[v.id]?.amount ? <Badge tone="success">{t("products.priceLists.active")}</Badge> : null}
                        </span>
                        <Field label={t("products.pricing.price")} description={prefill[v.id]?.amount && !values[v.id]?.amount ? t("products.priceLists.clearedKept") : undefined}>
                          <MoneyInput currency={list.currency} placeholder={t("products.priceLists.unchanged")} value={values[v.id]?.amount ?? null} onChange={(a) => setValues((m) => ({ ...m, [v.id]: { amount: a, compareAt: m[v.id]?.compareAt ?? null } }))} />
                        </Field>
                        <Field label={t("products.pricing.compareAt")} optional>
                          <MoneyInput currency={list.currency} value={values[v.id]?.compareAt ?? null} onChange={(c) => setValues((m) => ({ ...m, [v.id]: { amount: m[v.id]?.amount ?? null, compareAt: c } }))} />
                        </Field>
                      </li>
                    ))}
                  </ul>
                  <Button variant="primary" className="self-end" loading={pending} disabled={entries.length === 0} onClick={save}>
                    {t("products.priceLists.save", { count: entries.length })}
                  </Button>
                </>
              ) : null}
            </section>
          )
        ) : null}
      </div>
    </Card>
  );
}
