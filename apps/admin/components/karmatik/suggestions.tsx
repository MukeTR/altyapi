"use client";

import { Check, Search, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { OffsetPagination } from "@/components/data/pagination";
import { Bps } from "@/components/data/percent";
import { PeerListError, VariantCell, WMoney } from "@/components/ekosistem/peer-status";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { MoneyInput } from "@/components/ui/money-input";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { OffsetPage } from "@/lib/api/types";
import type { ApplySuggestionResult, ProfitCheckResult, Suggestion } from "@/lib/ekosistem/types";
import { ProfitCheckLines } from "./profit-check-lines";

function DecisionCell({ s }: { s: Suggestion }) {
  const { t } = useI18n();
  if (!s.decision) return <StatusPill domain="suggestion" value={s.status} />;
  const delivery = s.decision.delivery;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <StatusPill domain="suggestion" value={s.status} />
      {s.decision.appliedPrice ? (
        <span className="text-xs text-fg-muted">
          {t("karmatik.suggestions.appliedAt")} <WMoney value={s.decision.appliedPrice} />
        </span>
      ) : null}
      <span className={delivery === "failed" ? "text-xs text-danger" : "text-xs text-fg-muted"}>{t.maybe(`karmatik.suggestions.delivery.${delivery}`) ?? delivery}</span>
    </span>
  );
}

/**
 * Applying a suggestion: optional own price, the profit guard's verdict for that price (checked
 * first), then the ownership-aware price write. With policy "block" a below-floor price needs a
 * justification from a user who may approve campaigns; an unavailable check needs confirmation.
 */
function ApplyDialog({ suggestion, onClose, onApplied }: { suggestion: Suggestion | null; onClose: () => void; onApplied: (r: ApplySuggestionResult) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const currency = suggestion?.suggestedPrice?.currency ?? store.defaultCurrency;
  const [price, setPrice] = useState<string | null>(suggestion?.suggestedPrice?.amount ?? null);
  const [check, setCheck] = useState<ProfitCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<ApiErrorInfo | null>(null);
  const [justification, setJustification] = useState("");
  const [confirmUnchecked, setConfirmUnchecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [advice, setAdvice] = useState<ApplySuggestionResult | null>(null);
  const variantId = suggestion?.variant?.variantId ?? null;

  // Re-check the profit guard whenever the price changes (debounced).
  useEffect(() => {
    if (!variantId || !price) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      setCheckError(null);
      bff<ProfitCheckResult>(`${apiBase}/ekosistem/karmatik/profit-check`, {
        method: "POST",
        body: { action: "price_change", lines: [{ variantId, quantity: 1, unitPrice: price }] },
        signal: controller.signal,
      })
        .then((r) => setCheck(r))
        .catch((err: unknown) => {
          if ((err as { name?: string }).name === "AbortError") return;
          if (err instanceof ApiError) setCheckError(err.toInfo());
          else throw err;
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiBase, variantId, price]);

  if (!suggestion) return null;
  const blocked = check?.decision === "block" || error?.messageKey === "errors.ekosistem.profit_guard_blocked";
  const needsConfirm = Boolean(check?.requiresConfirmation) || error?.messageKey === "errors.ekosistem.profit_guard_confirmation_required";
  const canOverride = check?.canOverride ?? (error?.details as { canOverride?: boolean } | undefined)?.canOverride ?? false;
  const justificationOk = justification.trim().length >= 10;

  const apply = async () => {
    if (!price) return;
    setPending(true);
    setError(null);
    setAdvice(null);
    try {
      const res = await bff<ApplySuggestionResult>(`${apiBase}/ekosistem/karmatik/suggestions/${encodeURIComponent(suggestion.ref)}/apply`, {
        method: "POST",
        body: {
          ...(price !== suggestion.suggestedPrice?.amount ? { price } : {}),
          ...(blocked && justificationOk ? { justification: justification.trim() } : {}),
          ...(needsConfirm ? { confirmUnchecked } : {}),
        },
      });
      if (res.applied) onApplied(res);
      else setAdvice(res);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const disabled = pending || !price || (blocked && (!canOverride || !justificationOk)) || (needsConfirm && !confirmUnchecked);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      modalLock
      title={t("karmatik.suggestions.applyTitle")}
      description={suggestion.variant?.productTitle ?? suggestion.variant?.sku ?? suggestion.ref}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void apply()} loading={pending} disabled={disabled}>
            <Check aria-hidden="true" />
            {t("karmatik.suggestions.applyConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && error.messageKey !== "errors.ekosistem.profit_guard_blocked" && error.messageKey !== "errors.ekosistem.profit_guard_confirmation_required" ? (
          <ErrorSummary message={describeError(error).message} items={[]} />
        ) : null}
        {advice ? (
          <InlineAlert tone="warning" title={t("karmatik.suggestions.notApplied")} live="alert">
            <span lang="tr">{advice.write.message ?? t("karmatik.suggestions.notAppliedBody")}</span>
          </InlineAlert>
        ) : null}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-sm text-fg-muted">{t("karmatik.suggestions.columns.current")}</dt>
            <dd className="text-md">
              <WMoney value={suggestion.currentPrice} />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-fg-muted">{t("karmatik.suggestions.columns.suggested")}</dt>
            <dd className="text-md font-medium">
              <WMoney value={suggestion.suggestedPrice} />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-fg-muted">{t("karmatik.suggestions.columns.competitorMin")}</dt>
            <dd className="text-md">
              <WMoney value={suggestion.competitorMinPrice} />
            </dd>
          </div>
        </dl>
        <Field label={t("karmatik.suggestions.priceToApply")} description={t("karmatik.suggestions.priceToApplyHelp")}>
          <MoneyInput value={price} onChange={setPrice} currency={currency} />
        </Field>
        <section aria-live="polite" aria-busy={checking} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-base font-medium text-fg">
            <ShieldAlert aria-hidden="true" className="size-4 text-fg-muted" />
            {t("karmatik.guard.checkTitle")}
            {checking ? <Spinner /> : null}
          </h3>
          {checkError ? <InlineAlert tone="danger">{describeError(checkError).message}</InlineAlert> : null}
          {check ? <ProfitCheckLines result={check} /> : null}
        </section>
        {blocked ? (
          canOverride ? (
            <Field label={t("karmatik.guard.justification")} description={t("karmatik.guard.justificationHelp")} required>
              <Textarea rows={3} maxLength={1000} showCount value={justification} onChange={(e) => setJustification(e.target.value)} />
            </Field>
          ) : (
            <InlineAlert tone="danger">{t("karmatik.guard.cannotOverride")}</InlineAlert>
          )
        ) : null}
        {needsConfirm ? <Checkbox checked={confirmUnchecked} onCheckedChange={setConfirmUnchecked} label={t("karmatik.guard.confirmUnchecked")} /> : null}
        <p className="text-sm text-fg-muted">{t("karmatik.suggestions.writeNote")}</p>
      </div>
    </Dialog>
  );
}

/** "any" in the URL is the API's status=all (FilterTabs keys the "no filter" tab as "all"). */
const STATUS_TABS = ["applied", "dismissed", "any"] as const;

/** Kârmatik › Price suggestions: apply (profit guard, ownership-aware write) or dismiss; decisions go back to Kârmatik. */
export function Suggestions({ result, filtered }: { result: ApiResult<OffsetPage<Suggestion>>; filtered: boolean }) {
  const { t } = useI18n();
  const { apiBase, can } = useStore();
  const router = useRouter();
  const { clearHref } = useUrlFilters();
  const { toast, toastError } = useToast();
  const [, startRefresh] = useTransition();
  const [applying, setApplying] = useState<Suggestion | null>(null);
  const [dismissing, setDismissing] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const canDecide = can("pricing:write");

  const dismiss = async () => {
    if (!dismissing) return;
    setBusy(true);
    try {
      await bff(`${apiBase}/ekosistem/karmatik/suggestions/${encodeURIComponent(dismissing.ref)}/dismiss`, { method: "POST" });
      toast({ tone: "success", title: t("karmatik.suggestions.dismissedToast") });
      setDismissing(null);
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(false);
    }
  };

  const reasonOf = (s: Suggestion) => (s.channel !== "web" ? t("karmatik.suggestions.notWeb") : !s.variant ? t("karmatik.suggestions.unmatchedReason") : !canDecide ? t("karmatik.suggestions.needPricing") : null);

  const columns: Column<Suggestion>[] = [
    { id: "product", header: t("karmatik.columns.product"), cell: (s) => <VariantCell variant={s.variant} fallback={[s.barcode, s.sourceRef]} /> },
    { id: "channel", header: t("karmatik.columns.channel"), cell: (s) => t.maybe(`karmatik.channels.${s.channel}`) ?? s.channel },
    { id: "current", header: t("karmatik.suggestions.columns.current"), align: "end", cell: (s) => <WMoney value={s.currentPrice} /> },
    { id: "suggested", header: t("karmatik.suggestions.columns.suggested"), align: "end", cell: (s) => <WMoney value={s.suggestedPrice} className="tabular font-medium text-fg" /> },
    { id: "competitor", header: t("karmatik.suggestions.columns.competitorMin"), align: "end", cell: (s) => <WMoney value={s.competitorMinPrice} /> },
    {
      id: "reason",
      header: t("karmatik.suggestions.columns.reason"),
      cell: (s) => (
        <span className="flex flex-col">
          <span>{s.reason ? (t.maybe(`karmatik.suggestions.reasons.${s.reason}`) ?? s.reason) : t("common.none")}</span>
          {s.confidenceBps !== null ? (
            <span className="text-xs text-fg-muted">
              {t("karmatik.suggestions.confidence")} <Bps value={s.confidenceBps} />
            </span>
          ) : null}
        </span>
      ),
    },
    { id: "status", header: t("karmatik.suggestions.columns.status"), cell: (s) => <DecisionCell s={s} /> },
    { id: "updated", header: t("karmatik.columns.updated"), cell: (s) => <DateTime value={s.updatedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (s) => {
        if (s.status !== "new") return null;
        const reason = s.actionable ? (canDecide ? null : t("karmatik.suggestions.needPricing")) : reasonOf(s);
        const buttons = (
          <span className="inline-flex gap-1.5">
            <Button size="sm" variant="primary" disabled={reason !== null} onClick={() => setApplying(s)} aria-label={t("karmatik.suggestions.applyFor", { name: s.variant?.productTitle ?? s.ref })}>
              {t("karmatik.suggestions.apply")}
            </Button>
            <Button size="sm" disabled={reason !== null} onClick={() => setDismissing(s)} aria-label={t("karmatik.suggestions.dismissFor", { name: s.variant?.productTitle ?? s.ref })}>
              <X aria-hidden="true" />
            </Button>
          </span>
        );
        return reason ? (
          <Tooltip content={reason}>
            <span tabIndex={0} className="inline-flex">
              {buttons}
            </span>
          </Tooltip>
        ) : (
          buttons
        );
      },
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("karmatik.suggestions.title")} meta={t("karmatik.suggestions.meta")} breadcrumbs={[{ label: t("karmatik.title") }]} />
      {!result.ok ? (
        <PeerListError peer="karmatik" error={result.error} />
      ) : (
        <section aria-label={t("karmatik.suggestions.title")} className="min-w-0 rounded-lg border border-border bg-surface">
          <FilterTabs
            param="status"
            aria-label={t("karmatik.suggestions.statusLabel")}
            tabs={[{ value: null, label: t("karmatik.suggestions.status.new") }, ...STATUS_TABS.map((s) => ({ value: s, label: t(`karmatik.suggestions.status.${s === "any" ? "all" : s}`) }))]}
          />
          {!canDecide ? <p className="border-b border-border px-4 py-2 text-sm text-fg-muted">{t("karmatik.suggestions.needPricing")}</p> : null}
          <DataTable
            caption={t("karmatik.suggestions.title")}
            columns={columns}
            rows={result.data.items}
            rowKey={(s) => s.ref}
            empty={
              filtered ? (
                <EmptyState icon={Search} title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<ButtonLink href={clearHref}>{t("states.clearFilters")}</ButtonLink>} />
              ) : (
                <EmptyState title={t("karmatik.suggestions.emptyTitle")} description={t("karmatik.suggestions.emptyBody")} />
              )
            }
            footer={result.data.total > 0 ? <OffsetPagination offset={result.data.offset} limit={result.data.limit} total={result.data.total} /> : null}
          />
        </section>
      )}
      {applying ? (
        <ApplyDialog
          key={applying.ref}
          suggestion={applying}
          onClose={() => setApplying(null)}
          onApplied={(r) => {
            setApplying(null);
            toast({ tone: "success", title: t("karmatik.suggestions.appliedToast"), ...(r.write.mode === "owner" && r.write.owner ? { description: t("karmatik.suggestions.viaOwner", { name: r.write.owner.name }) } : {}) });
            startRefresh(() => router.refresh());
          }}
        />
      ) : null}
      <AlertDialog
        open={dismissing !== null}
        onOpenChange={(o) => !o && setDismissing(null)}
        title={t("karmatik.suggestions.dismissTitle")}
        description={t("karmatik.suggestions.dismissBody")}
        confirmLabel={t("karmatik.suggestions.dismiss")}
        tone="primary"
        pending={busy}
        onConfirm={() => void dismiss()}
      >
        {dismissing ? (
          <p className="text-sm text-fg-muted">
            <Badge>{dismissing.variant?.productTitle ?? dismissing.ref}</Badge>
          </p>
        ) : null}
      </AlertDialog>
    </div>
  );
}
