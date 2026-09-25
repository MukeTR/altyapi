"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ItemList } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { IN_PROGRESS, normalizeHostnameInput, type Domain } from "@/lib/domains/types";
import { DnsRecords } from "./dns-records";
import { useFailureReason } from "./failure-reason";

const POLL_MS = 10_000;

/** Stages the platform goes through for a custom domain, in order. */
const STAGES = ["pending", "awaiting_dns", "validating", "certificate_pending", "active"] as const;

function StatusTimeline({ domain }: { domain: Domain }) {
  const { t } = useI18n();
  const failed = domain.status === "failed";
  // A reason on a domain that hasn't failed means the platform is waiting (e.g. edge not
  // configured); no progress happens until that is resolved, so the step doesn't spin.
  const waiting = !failed && Boolean(domain.failureReason);
  const current = STAGES.indexOf(domain.status as (typeof STAGES)[number]);
  return (
    <ol aria-label={t("domains.wizard.timeline", { hostname: domain.hostname })} className="flex flex-col gap-2">
      {STAGES.map((stage, i) => {
        const done = current > i || domain.status === "active";
        const active = current === i && domain.status !== "active";
        return (
          <li key={stage} aria-current={active ? "step" : undefined} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                done ? "border-success bg-success-bg text-success" : active ? "border-accent text-accent-subtle-fg" : "border-border-control text-fg-subtle",
              )}
            >
              {done ? <Check aria-hidden="true" className="size-3" /> : active ? (
                waiting ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : <Loader2 aria-hidden="true" className="size-3 animate-spin-slow" />
              ) : null}
            </span>
            <span className={cn(active ? "font-medium text-fg" : done ? "text-fg" : "text-fg-muted")}>
              {t(`domains.stages.${stage}`)}
              {done ? <span className="sr-only"> ({t("ui.stepper.completed")})</span> : null}
            </span>
          </li>
        );
      })}
      {failed ? (
        <li className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="size-4" />
          {t("domains.stages.failed")}
        </li>
      ) : null}
    </ol>
  );
}

/**
 * Custom domain wizard: 1) the hostname, 2) the DNS records to add at the DNS provider, 3) the
 * verification and certificate progress (polled). Closing the dialog does not stop anything;
 * the platform keeps checking in the background.
 */
export function AddDomainDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const failureText = useFailureReason();
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Domain[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setInput("");
    setRows([]);
    setError(null);
  }, [open]);

  const hostname = normalizeHostnameInput(input);
  const routing = rows.find((r) => !r.redirectToHostname) ?? rows[0];

  const refresh = useCallback(async () => {
    if (!rows.length) return;
    try {
      const all = await bff<ItemList<Domain>>(`${apiBase}/domains`);
      const ids = new Set(rows.map((r) => r.id));
      const next = all.items.filter((d) => ids.has(d.id));
      if (next.length) setRows(next);
    } catch {
      // The next poll tries again; errors of explicit actions are shown inline.
    }
  }, [apiBase, rows]);

  useEffect(() => {
    if (!open || step !== 2 || !rows.some((r) => IN_PROGRESS.includes(r.status))) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, step, rows, refresh]);

  const add = async () => {
    if (!hostname) return;
    setPending(true);
    setError(null);
    try {
      const res = await bff<ItemList<Domain>>(`${apiBase}/domains`, { method: "POST", body: { hostname } });
      setRows(res.items);
      setStep(1);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const check = async () => {
    if (!routing) return;
    setPending(true);
    setError(null);
    try {
      await Promise.all(rows.map((r) => bff<Domain>(`${apiBase}/domains/${r.id}/retry`, { method: "POST" })));
      await refresh();
      setStep(2);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const described = error ? describeError(error, { "errors.domain.invalid": "hostname", "errors.domain.already_registered": "hostname", "errors.domain.platform_hostname": "hostname", "errors.domain.ip_not_allowed": "hostname", "errors.domain.empty": "hostname" }) : null;
  const notConfigured = rows.some((r) => r.failureReason === "cloudflare_not_configured");

  const footer =
    step === 0 ? (
      <>
        <Button onClick={() => onOpenChange(false)} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" loading={pending} disabled={!hostname} onClick={() => void add()}>
          {t("domains.wizard.add")}
        </Button>
      </>
    ) : step === 1 ? (
      <>
        <Button onClick={() => onOpenChange(false)}>{t("domains.wizard.later")}</Button>
        <Button variant="primary" loading={pending} onClick={() => void check()}>
          {t("domains.wizard.checkNow")}
        </Button>
      </>
    ) : (
      <>
        <Button onClick={() => void refresh()}>{t("domains.wizard.refresh")}</Button>
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" modalLock={step > 0} title={t("domains.wizard.title")} description={t("domains.wizard.description")} footer={footer}>
      <div className="flex flex-col gap-5">
        <Stepper
          current={step}
          steps={[
            { id: "hostname", label: t("domains.wizard.stepHostname") },
            { id: "dns", label: t("domains.wizard.stepDns") },
            { id: "verify", label: t("domains.wizard.stepVerify") },
          ]}
        />
        {described && !described.fields.hostname ? (
          <FormAlert tone="danger" title={described.message} focusKey={error}>
            {described.correlationId ? (
              <span className="text-sm text-fg-muted">
                {t("common.supportCode")}: <code className="font-mono">{described.correlationId}</code>
              </span>
            ) : null}
          </FormAlert>
        ) : null}

        {step === 0 ? (
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Field label={t("domains.wizard.hostname")} description={t("domains.wizard.hostnameHint")} error={described?.fields.hostname ?? null} required>
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="www.ornekmagaza.com" autoFocus autoComplete="off" spellCheck={false} inputMode="url" className="font-mono" />
            </Field>
            {hostname && hostname !== input.trim() ? <p className="text-sm text-fg-muted">{t("domains.wizard.normalized", { hostname })}</p> : null}
            <InlineAlert tone="info">{t("domains.wizard.apexNote")}</InlineAlert>
          </form>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-fg">{t("domains.wizard.dnsIntro")}</p>
            {notConfigured ? <InlineAlert tone="warning" title={t("domains.wizard.notConfiguredTitle")}>{t("domains.failure.cloudflare_not_configured")}</InlineAlert> : null}
            {rows.map((r) => (
              <section key={r.id} aria-labelledby={`dns-${r.id}`} className="flex flex-col gap-2">
                <h3 id={`dns-${r.id}`} className="font-mono text-base font-medium text-fg">
                  {r.hostname}
                  {r.redirectToHostname ? <span className="ms-2 font-sans text-sm font-normal text-fg-muted">{t("domains.redirectsTo", { hostname: r.redirectToHostname })}</span> : null}
                </h3>
                <DnsRecords records={r.dnsInstructions} hostname={r.hostname} />
              </section>
            ))}
            <p className="text-sm text-fg-muted">{t("domains.wizard.dnsPropagation")}</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            {rows.map((r) => (
              <section key={r.id} aria-labelledby={`st-${r.id}`} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`st-${r.id}`} className="font-mono text-base font-medium text-fg">
                    {r.hostname}
                  </h3>
                  <StatusPill domain="domain" value={r.status} />
                </div>
                <StatusTimeline domain={r} />
                {r.failureReason ? <InlineAlert tone={r.status === "failed" ? "danger" : "warning"}>{failureText(r.failureReason)}</InlineAlert> : null}
              </section>
            ))}
            {rows.some((r) => IN_PROGRESS.includes(r.status)) ? (
              <p role="status" className="text-sm text-fg-muted">
                {t("domains.wizard.polling")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
