"use client";

import { useEffect, useState } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { redirectProblem, type RedirectProblem } from "@/lib/storefront/redirects";
import type { Redirect } from "@/lib/storefront/types";

export function useRedirectProblemText() {
  const { t } = useI18n();
  return (p: RedirectProblem | "status_invalid" | "columns") => t(`storefront.redirects.problems.${p}`);
}

/**
 * Creates a redirect, or changes one (the API upserts by source path, so the source of an
 * existing redirect is fixed here).
 */
export function RedirectDialog({ open, onOpenChange, existing, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; existing: Redirect | null; onSaved: () => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const { toast } = useToast();
  const problemText = useRedirectProblemText();
  const [fromPath, setFrom] = useState(existing?.fromPath ?? "");
  const [toPath, setTo] = useState(existing?.toPath ?? "");
  const [statusCode, setStatus] = useState(String(existing?.statusCode ?? 301));
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(existing?.fromPath ?? "");
    setTo(existing?.toPath ?? "");
    setStatus(String(existing?.statusCode ?? 301));
    setSubmitted(false);
    setError(null);
  }, [open, existing]);

  const problem = fromPath || toPath ? redirectProblem(fromPath, toPath) : "from_invalid";
  const described = error
    ? describeError(error, { "errors.redirect.reserved_path": "fromPath", "errors.redirect.invalid_path": "fromPath", "errors.redirect.loop": "toPath" })
    : null;
  const fromError = (submitted && (problem === "from_invalid" || problem === "from_reserved") ? problemText(problem) : null) ?? described?.fields.fromPath ?? null;
  const toError = (submitted && (problem === "to_invalid" || problem === "loop") ? problemText(problem) : null) ?? described?.fields.toPath ?? null;

  const submit = async () => {
    setSubmitted(true);
    if (problem) return;
    setPending(true);
    setError(null);
    try {
      await bff(`${apiBase}/storefront/redirects`, { method: "POST", body: { fromPath: fromPath.trim(), toPath: toPath.trim(), statusCode: Number(statusCode) } });
      toast({ tone: "success", title: existing ? t("storefront.redirects.updated") : t("storefront.redirects.created") });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const formLevel = described && !described.fields.fromPath && !described.fields.toPath ? described.message : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? t("storefront.redirects.editTitle") : t("storefront.redirects.newTitle")}
      description={t("storefront.redirects.dialogDescription")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {formLevel ? (
          <FormAlert tone="danger" title={formLevel} focusKey={error}>
            {described?.correlationId ? (
              <span className="text-sm text-fg-muted">
                {t("common.supportCode")}: <code className="font-mono">{described.correlationId}</code>
              </span>
            ) : null}
          </FormAlert>
        ) : null}
        <Field label={t("storefront.redirects.fromLabel")} description={t("storefront.redirects.fromHint")} required error={fromError}>
          <Input value={fromPath} disabled={Boolean(existing)} className="font-mono" placeholder="/eski-sayfa" maxLength={1000} autoFocus={!existing} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("storefront.redirects.toLabel")} description={t("storefront.redirects.toHint")} required error={toError}>
          <Input value={toPath} className="font-mono" placeholder="/yeni-sayfa" maxLength={2000} autoFocus={Boolean(existing)} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("storefront.redirects.typeLabel")}</legend>
          <RadioGroup
            name="redirect-status"
            value={statusCode}
            onValueChange={setStatus}
            options={[
              { value: "301", label: t("storefront.redirects.permanent"), description: t("storefront.redirects.permanentHint") },
              { value: "302", label: t("storefront.redirects.temporary"), description: t("storefront.redirects.temporaryHint") },
            ]}
          />
        </fieldset>
      </form>
    </Dialog>
  );
}
