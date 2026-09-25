"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { localeLabel } from "@/lib/locales";
import { slugify } from "@/lib/slug";
import type { StorefrontPage } from "@/lib/storefront/types";

const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Creates a page or landing page (never live until published) and opens it in the editor. */
export function NewPageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale: ui, describeError } = useI18n();
  const { apiBase, basePath, store } = useStore();
  const router = useRouter();
  const [type, setType] = useState<"page" | "landing">("page");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setType("page");
    setTitle("");
    setHandle("");
    setHandleTouched(false);
    setError(null);
  }, [open]);

  const effectiveHandle = handleTouched ? handle : slugify(title, 80);
  const described = error ? describeError(error, { "errors.page.handle_taken": "handle", "errors.page.invalid_handle": "handle", "errors.page.title_required": "title" }) : null;
  const handleError = effectiveHandle && !HANDLE.test(effectiveHandle) ? t("editor.page.handleInvalid") : (described?.fields.handle ?? null);
  const titleError = described?.fields.title ?? described?.fields[`title.${store.defaultLocale}`] ?? null;

  const submit = async () => {
    if (!title.trim() || handleError) return;
    setPending(true);
    setError(null);
    try {
      const created = await bff<StorefrontPage>(`${apiBase}/storefront/pages`, {
        method: "POST",
        body: { type, title: { [store.defaultLocale]: title.trim() }, ...(effectiveHandle ? { handle: effectiveHandle } : {}) },
      });
      onOpenChange(false);
      router.push(`${basePath}/storefront/editor?page=${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const formLevel = described && !described.fields.handle && !described.fields.title ? described.message : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      modalLock={Boolean(title)}
      title={t("storefront.pages.newTitle")}
      description={t("storefront.pages.newDescription")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={pending} disabled={!title.trim() || Boolean(handleError)} onClick={() => void submit()}>
            {t("storefront.pages.createAndEdit")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
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
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("storefront.pages.type")}</legend>
          <RadioGroup
            name="page-type"
            value={type}
            onValueChange={(v) => setType(v as "page" | "landing")}
            options={[
              { value: "page", label: t("editor.pageTypes.page"), description: t("storefront.pages.typePageHint") },
              { value: "landing", label: t("editor.pageTypes.landing"), description: t("storefront.pages.typeLandingHint") },
            ]}
          />
        </fieldset>
        <Field label={`${t("editor.page.title")} (${localeLabel(store.defaultLocale, ui)})`} required error={titleError}>
          <Input value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("editor.page.handle")} description={t("storefront.pages.handlePreview", { path: `/pages/${effectiveHandle || "…"}` })} error={handleError}>
          <Input
            prefix="/pages/"
            value={effectiveHandle}
            maxLength={120}
            onChange={(e) => {
              setHandleTouched(true);
              setHandle(e.target.value.toLowerCase().replace(/\s+/g, "-"));
            }}
          />
        </Field>
        <p className="text-sm text-fg-muted">{t("storefront.pages.otherLanguagesHint")}</p>
      </form>
    </Dialog>
  );
}
