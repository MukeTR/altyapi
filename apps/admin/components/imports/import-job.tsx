"use client";

import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { Stat } from "@/components/data/stat";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { IMPORT_TERMINAL, type ImportJob } from "@/lib/commerce/types";
import { formatNumber } from "@/lib/format";
import { localeLabel } from "@/lib/locales";

const WORKING = new Set(["uploaded", "analyzing", "previewing", "processing"]);
/** The fields a mapping must cover; the API also accepts updates matched by SKU without a title. */
const REQUIRED = new Set(["title", "price"]);

function stepOf(status: string): number {
  if (status === "uploaded" || status === "analyzing") return 1;
  if (status === "awaiting_mapping") return 2;
  if (status === "previewing" || status === "ready") return 3;
  if (status === "processing") return 4;
  return 5;
}

interface RowErrorLike {
  field?: string;
  message?: string;
}

export function ImportJobView({ initialJob, fields }: { initialJob: ImportJob; fields: string[] }) {
  const { t, locale, catalog, describeError } = useI18n();
  const { apiBase, basePath, store, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [job, setJob] = useState(initialJob);
  const [pollError, setPollError] = useState<ApiErrorInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const canWrite = can("catalog:write");
  const working = WORKING.has(job.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await bff<ImportJob>(`${apiBase}/imports/${job.id}`);
      setJob(next);
      setPollError(null);
      return next;
    } catch (err) {
      if (err instanceof ApiError) setPollError(err.toInfo());
      else throw err;
      return null;
    }
  }, [apiBase, job.id]);

  // Poll while the worker analyses, previews or runs the job (2 s, slowing to 5 s).
  useEffect(() => {
    if (!working) return;
    let delay = 2000;
    let alive = true;
    const tick = async () => {
      const next = await refresh();
      if (!alive) return;
      if (next && !WORKING.has(next.status)) {
        if ((IMPORT_TERMINAL as readonly string[]).includes(next.status)) router.refresh();
        return;
      }
      delay = Math.min(delay * 1.25, 5000);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [working, refresh, router]);

  const errorText = (e: RowErrorLike) => (e.message ? (catalog.apiErrors[e.message] ?? e.message) : "");

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <PageHeader
        title={t("imports.job.title")}
        breadcrumbs={[
          { label: t("products.title"), href: `${basePath}/products` },
          { label: t("imports.title"), href: `${basePath}/products/imports` },
        ]}
        status={<StatusPill domain="import" value={job.status} />}
        meta={
          <span>
            <Badge className="me-2 uppercase">{job.format}</Badge>
            <DateTime value={job.createdAt} />
          </span>
        }
      />
      <Stepper
        current={stepOf(job.status)}
        steps={[
          { id: "file", label: t("imports.steps.file") },
          { id: "analyze", label: t("imports.steps.analyze") },
          { id: "mapping", label: t("imports.steps.mapping") },
          { id: "preview", label: t("imports.steps.preview") },
          { id: "run", label: t("imports.steps.run") },
          { id: "done", label: t("imports.steps.done") },
        ]}
      />
      {pollError ? <InlineAlert tone="warning">{describeError(pollError).message}</InlineAlert> : null}

      {job.status === "uploaded" || job.status === "analyzing" || job.status === "previewing" ? (
        <Card>
          <p role="status" className="flex items-center gap-2 text-base text-fg-muted">
            <Spinner />
            {job.status === "previewing" ? t("imports.job.previewing") : t("imports.job.analyzing")}
          </p>
        </Card>
      ) : null}

      {job.status === "awaiting_mapping" || (editing && job.status === "ready") ? (
        <MappingCard
          job={job}
          fields={fields}
          disabled={!canWrite}
          onSaved={(next) => {
            setJob(next);
            setEditing(false);
          }}
        />
      ) : null}

      {job.status === "ready" && !editing ? (
        <PreviewCard job={job} canWrite={canWrite} errorText={errorText} onEdit={() => setEditing(true)} onStarted={setJob} />
      ) : null}

      {job.status === "processing" ? (
        <Card title={t("imports.job.runningTitle")}>
          <div className="flex flex-col gap-3">
            <Progress
              value={job.totalRows ? (job.processedRows ?? 0) : null}
              max={job.totalRows ?? 100}
              aria-label={t("imports.job.progress")}
              valueText={t("ui.progress.rows", { done: formatNumber(job.processedRows ?? 0, locale), total: formatNumber(job.totalRows ?? 0, locale) })}
            />
            <p className="text-sm text-fg-muted" aria-live="polite">
              {job.totalRows
                ? t("ui.progress.rows", { done: formatNumber(job.processedRows ?? 0, locale), total: formatNumber(job.totalRows, locale) })
                : t("imports.job.counting")}
            </p>
            <Counts job={job} />
            {canWrite ? <CancelButton job={job} onCancelled={setJob} /> : null}
          </div>
        </Card>
      ) : null}

      {(IMPORT_TERMINAL as readonly string[]).includes(job.status) ? (
        <Card title={t(`imports.job.result.${job.status as (typeof IMPORT_TERMINAL)[number]}`)}>
          <div className="flex flex-col gap-4">
            {job.failureReason ? <InlineAlert tone="danger">{catalog.apiErrors[job.failureReason] ?? job.failureReason}</InlineAlert> : null}
            <Counts job={job} />
            {job.finishedAt ? (
              <p className="text-sm text-fg-muted">
                {t("imports.job.finishedAt")} <DateTime value={job.finishedAt} />
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`${basePath}/products`} variant="primary">
                {t("imports.job.viewProducts")}
              </ButtonLink>
              {job.errorReportAssetId ? <ErrorReportButton assetId={job.errorReportAssetId} /> : null}
              <ButtonLink href={`${basePath}/products/imports/new`}>{t("imports.actions.new")}</ButtonLink>
            </div>
          </div>
        </Card>
      ) : null}

      {job.errorsPreview && job.errorsPreview.length > 0 ? (
        <Card title={t("imports.job.rowErrors", { count: job.errorsPreview.length })} flush>
          <div className="max-h-96 overflow-auto border-t border-border">
            <table className="w-full border-collapse text-base">
              <caption className="sr-only">{t("imports.job.rowErrorsCaption")}</caption>
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border text-xs text-fg-muted">
                  <th scope="col" className="h-9 w-24 px-3 text-end font-medium">
                    {t("imports.job.row")}
                  </th>
                  <th scope="col" className="h-9 px-3 text-start font-medium">
                    {t("imports.job.problem")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {job.errorsPreview.map((e) => (
                  <tr key={e.rowNumber} className="border-b border-border align-top last:border-b-0">
                    <td className="px-3 py-1.5 text-end tabular">{formatNumber(e.rowNumber, locale)}</td>
                    <td className="px-3 py-1.5">
                      <ul className="flex flex-col gap-0.5">
                        {(Array.isArray(e.errors) ? (e.errors as RowErrorLike[]) : []).map((x, i) => (
                          <li key={i}>
                            {x.field && x.field !== "*" ? <span className="me-1 font-medium text-fg">{t.maybe(`imports.fields.${x.field}`) ?? x.field}:</span> : null}
                            {errorText(x)}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <p className="text-xs text-fg-subtle">{t("imports.job.locale", { locale: localeLabel(job.options?.locale ?? store.defaultLocale, locale), currency: job.options?.currency ?? store.defaultCurrency })}</p>
    </div>
  );
}

function Counts({ job }: { job: ImportJob }) {
  const { t, locale } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label={t("imports.columns.rows")} value={job.totalRows !== null ? formatNumber(job.totalRows, locale) : t("common.none")} />
      <Stat label={t("imports.columns.created")} value={formatNumber(job.createdCount ?? 0, locale)} />
      <Stat label={t("imports.columns.updated")} value={formatNumber(job.updatedCount ?? 0, locale)} />
      <Stat label={t("imports.columns.failed")} value={<span className={(job.failedCount ?? 0) > 0 ? "text-danger" : undefined}>{formatNumber(job.failedCount ?? 0, locale)}</span>} />
    </div>
  );
}

function MappingCard({ job, fields, disabled, onSaved }: { job: ImportJob; fields: string[]; disabled: boolean; onSaved: (job: ImportJob) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const columns = job.detectedColumns ?? [];
  const [mapping, setMapping] = useState<Record<string, string>>(() => ({ ...(job.mapping ?? {}) }));
  const [profileName, setProfileName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const sample = (job.sampleRows ?? []).slice(0, 5);
  const used = new Set(Object.values(mapping));
  const missing = [...REQUIRED].filter((f) => !mapping[f]);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, c]) => c));
      const next = await bff<ImportJob>(`${apiBase}/imports/${job.id}/mapping`, { method: "PUT", body: { mapping: clean, ...(profileName.trim() ? { saveProfileName: profileName.trim() } : {}) } });
      onSaved(next);
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Card title={t("imports.mapping.title")} description={t("imports.mapping.description", { count: columns.length })} padding="form">
      <div className="flex flex-col gap-5">
        {error ? (
          <FormAlert tone="danger" focusKey={error}>
            {describeError(error).message}
          </FormAlert>
        ) : null}
        {sample.length > 0 ? (
          <div className="relative overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("imports.mapping.sampleCaption")}</caption>
              <thead className="bg-surface-muted">
                <tr className="border-b border-border text-xs text-fg-muted">
                  {columns.map((c) => (
                    <th key={c} scope="col" className="h-8 whitespace-nowrap px-2 text-start font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    {columns.map((c) => (
                      <td key={c} className="max-w-48 truncate whitespace-nowrap px-2 py-1 text-fg-muted">
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <fieldset disabled={disabled || pending} className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{t("imports.mapping.title")}</legend>
          {fields.map((f) => (
            <Field key={f} label={t.maybe(`imports.fields.${f}`) ?? f} required={REQUIRED.has(f)} description={<code className="font-mono text-xs">{f}</code>}>
              <Select
                size="sm"
                value={mapping[f] ?? "__none"}
                onValueChange={(v) => setMapping((m) => ({ ...m, [f]: v === "__none" ? "" : v }))}
                options={[{ value: "__none", label: t("imports.mapping.skip") }, ...columns.map((c) => ({ value: c, label: used.has(c) && mapping[f] !== c ? `${c} ${t("imports.mapping.alsoUsed")}` : c }))]}
              />
            </Field>
          ))}
        </fieldset>
        <Field label={t("imports.mapping.saveProfile")} optional description={t("imports.mapping.saveProfileHint")}>
          <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} maxLength={80} disabled={disabled} />
        </Field>
        {missing.length > 0 ? <p className="text-sm text-warning">{t("imports.mapping.missing", { fields: missing.map((f) => t.maybe(`imports.fields.${f}`) ?? f).join(", ") })}</p> : null}
        {!disabled ? (
          <Button variant="primary" className="self-end" loading={pending} onClick={save}>
            {t("imports.mapping.submit")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function PreviewCard({ job, canWrite, errorText, onEdit, onStarted }: { job: ImportJob; canWrite: boolean; errorText: (e: RowErrorLike) => string; onEdit: () => void; onStarted: (job: ImportJob) => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const preview = job.preview ?? [];
  const currency = job.options?.currency ?? store.defaultCurrency;
  const problems = useMemo(() => preview.reduce((n, g) => n + (Array.isArray(g.errors) ? g.errors.length : 0), 0), [preview]);

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      onStarted(await bff<ImportJob>(`${apiBase}/imports/${job.id}/start`, { method: "POST" }));
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      title={t("imports.preview.title")}
      description={t("imports.preview.description", { count: preview.length })}
      padding="form"
      footer={
        canWrite ? (
          <>
            <Button onClick={onEdit} disabled={pending}>
              {t("imports.preview.editMapping")}
            </Button>
            <Button variant="primary" loading={pending} onClick={start}>
              {t("imports.preview.start")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <FormAlert tone="danger" focusKey={error}>
            {describeError(error).message}
          </FormAlert>
        ) : null}
        {problems > 0 ? <InlineAlert tone="warning">{t("imports.preview.problems", { count: problems })}</InlineAlert> : null}
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {preview.map((g, i) => (
            <li key={i} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-fg">{g.title ?? t("products.untitled")}</span>
                <span className="text-sm text-fg-muted">
                  {t("imports.preview.rows", { rows: g.rows.join(", ") })} · {t("imports.preview.variants", { count: g.variants.length })} · {t("imports.preview.images", { count: g.images })}
                </span>
              </div>
              {g.handle ? <span className="font-mono text-xs text-fg-subtle">/products/{g.handle}</span> : null}
              <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-fg-muted">
                {g.variants.slice(0, 6).map((v, vi) => (
                  <li key={vi}>
                    {[v.optionValues.join(" / "), v.sku].filter(Boolean).join(" · ") || t("products.variants.default")}: <Money amount={/^\d+$/.test(v.price) ? v.price : null} currency={currency} />
                    {v.stock !== null ? ` · ${t("imports.preview.stock", { count: formatNumber(v.stock, locale) })}` : ""}
                  </li>
                ))}
              </ul>
              {Array.isArray(g.errors) && g.errors.length > 0 ? (
                <ul className="text-sm text-danger">
                  {(g.errors as RowErrorLike[]).map((e, ei) => (
                    <li key={ei}>{errorText(e)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-subtle">{t("imports.preview.sampleNote")}</p>
      </div>
    </Card>
  );
}

function CancelButton({ job, onCancelled }: { job: ImportJob; onCancelled: (job: ImportJob) => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const { toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        {t("imports.job.cancel")}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title={t("imports.job.cancelTitle")}
        description={t("imports.job.cancelBody")}
        confirmLabel={t("imports.job.cancel")}
        pending={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            onCancelled(await bff<ImportJob>(`${apiBase}/imports/${job.id}/cancel`, { method: "POST" }));
            setOpen(false);
          } catch (err) {
            if (err instanceof ApiError) toastError(err.toInfo());
            else throw err;
          } finally {
            setPending(false);
          }
        }}
      />
    </>
  );
}

function ErrorReportButton({ assetId }: { assetId: string }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const { toastError } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      loading={pending}
      onClick={async () => {
        setPending(true);
        try {
          const { url } = await bff<{ url: string }>(`${apiBase}/assets/${assetId}/download`);
          window.location.assign(url);
        } catch (err) {
          if (err instanceof ApiError) toastError(err.toInfo());
          else throw err;
        } finally {
          setPending(false);
        }
      }}
    >
      <Download aria-hidden="true" />
      {t("imports.job.errorReport")}
    </Button>
  );
}
