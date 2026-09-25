"use client";

import { CircleAlert, CircleCheck, FileUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import { parseRedirectLines, type ParsedRedirect } from "@/lib/storefront/redirects";
import type { Redirect } from "@/lib/storefront/types";
import { useRedirectProblemText } from "./redirect-dialog";

const MAX_ROWS = 500;
const CONCURRENCY = 4;

type RowResult = { status: "ok" } | { status: "failed"; message: string };

/**
 * Bulk import of redirects from CSV text (old path, new path, optional 301/302). There is no bulk
 * endpoint, so each valid row is sent as its own create request (which updates a redirect that
 * already starts at the same path) with per-row results.
 */
export function ImportRedirectsDialog({ open, onOpenChange, existing, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; existing: readonly Redirect[]; onDone: () => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const { toast } = useToast();
  const problemText = useRedirectProblemText();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Map<number, RowResult>>(new Map());
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setResults(new Map());
    setDone(false);
    setOverwrite(false);
  }, [open]);

  const rows = useMemo(() => parseRedirectLines(text), [text]);
  const existingFrom = useMemo(() => new Set(existing.map((r) => r.fromPath)), [existing]);
  const valid = rows.filter((r) => !r.problem && (overwrite || !existingFrom.has(r.fromPath.trim())));
  const skippedExisting = rows.filter((r) => !r.problem && !overwrite && existingFrom.has(r.fromPath.trim())).length;
  const invalid = rows.filter((r) => r.problem).length;
  const tooMany = valid.length > MAX_ROWS;
  const finished = [...results.values()];
  const failedCount = finished.filter((r) => r.status === "failed").length;

  const run = async () => {
    setRunning(true);
    setDone(false);
    const queue: ParsedRedirect[] = [...valid];
    const next = new Map<number, RowResult>();
    setResults(new Map());
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          await bff(`${apiBase}/storefront/redirects`, { method: "POST", body: { fromPath: row.fromPath.trim(), toPath: row.toPath.trim(), statusCode: row.statusCode } });
          next.set(row.line, { status: "ok" });
        } catch (err) {
          next.set(row.line, { status: "failed", message: err instanceof ApiError ? describeError(err.toInfo()).message : t("states.networkBody") });
        }
        setResults(new Map(next));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
    setDone(true);
    const ok = [...next.values()].filter((r) => r.status === "ok").length;
    toast({ tone: ok === next.size ? "success" : "info", title: t("storefront.redirects.importDone", { ok, total: next.size }) });
    onDone();
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setResults(new Map());
    setDone(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !running && onOpenChange(o)}
      size="lg"
      modalLock={running || Boolean(text)}
      title={t("storefront.redirects.importTitle")}
      description={t("storefront.redirects.importDescription")}
      footer={
        done ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)} disabled={running}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={running} disabled={valid.length === 0 || tooMany} onClick={() => void run()}>
              {t("storefront.redirects.importRun", { count: valid.length })}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} id={fileId} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} onChange={(e) => void readFile(e.target.files?.[0])} />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={running}>
            <FileUp aria-hidden="true" />
            {t("storefront.redirects.importChooseFile")}
          </Button>
          <span className="text-sm text-fg-muted">{t("storefront.redirects.importOrPaste")}</span>
        </div>
        <Field label={t("storefront.redirects.importText")} description={t("storefront.redirects.importFormat")}>
          <Textarea value={text} rows={6} maxRows={10} disabled={running} className="font-mono text-sm" placeholder={"/eski-urun,/products/yeni-urun,301\n/kampanya,/pages/yaz-indirimi,302"} onChange={(e) => {
            setText(e.target.value);
            setResults(new Map());
            setDone(false);
          }} />
        </Field>
        <Switch label={t("storefront.redirects.importOverwrite")} description={t("storefront.redirects.importOverwriteHint")} checked={overwrite} disabled={running} onCheckedChange={setOverwrite} />
        {rows.length > 0 ? (
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t("storefront.redirects.importSummary", { valid: valid.length, invalid, skipped: skippedExisting })}
          </p>
        ) : null}
        {tooMany ? <InlineAlert tone="warning">{t("storefront.redirects.importTooMany", { max: MAX_ROWS })}</InlineAlert> : null}
        {running || done ? <Progress value={valid.length ? Math.round((finished.length / valid.length) * 100) : 100} aria-label={t("storefront.redirects.importProgress", { done: finished.length, total: valid.length })} /> : null}
        {done && failedCount > 0 ? <InlineAlert tone="warning">{t("storefront.redirects.importFailedRows", { count: failedCount })}</InlineAlert> : null}
        {rows.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("storefront.redirects.importPreview")}</caption>
              <thead className="sticky top-0 bg-surface-muted text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("storefront.redirects.importLine")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("storefront.redirects.columns.from")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("storefront.redirects.columns.to")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">
                    {t("storefront.redirects.importResult")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 1000).map((r) => {
                  const result = results.get(r.line);
                  const skipped = !r.problem && !overwrite && existingFrom.has(r.fromPath.trim());
                  return (
                    <tr key={r.line} className="border-t border-border">
                      <td className="px-2 py-1 text-fg-subtle tabular">{r.line}</td>
                      <td className="break-all px-2 py-1 font-mono">{r.fromPath}</td>
                      <td className="break-all px-2 py-1 font-mono">
                        {r.toPath} <span className="text-fg-subtle">({r.statusCode})</span>
                      </td>
                      <td className="px-2 py-1">
                        {result?.status === "ok" ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CircleCheck aria-hidden="true" className="size-3.5" />
                            {t("storefront.redirects.importRowOk")}
                          </span>
                        ) : result?.status === "failed" ? (
                          <span className="inline-flex items-start gap-1 text-danger">
                            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {result.message}
                          </span>
                        ) : r.problem ? (
                          <span className="text-danger">{problemText(r.problem)}</span>
                        ) : skipped ? (
                          <span className="text-fg-muted">{t("storefront.redirects.importRowExists")}</span>
                        ) : (
                          <span className="text-fg-muted">{t("storefront.redirects.importRowReady")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
