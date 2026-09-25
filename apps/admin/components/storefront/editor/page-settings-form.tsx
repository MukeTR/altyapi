"use client";

import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { PageSeo, StorefrontPage } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";
import { LocalizedTextField } from "./localized-fields";
import { useIssueMessage } from "./schema-fields";

const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Title, address and search-engine settings of the page being edited. */
export function PageSettingsForm({ page, onChange, error }: { page: StorefrontPage; onChange: (next: StorefrontPage, opts?: { immediate?: boolean }) => void; error: ApiErrorInfo | null }) {
  const { t, describeError } = useI18n();
  const { canEdit, issues } = useEditorContext();
  const issueText = useIssueMessage();
  const routable = page.type === "page" || page.type === "landing";
  const seo: PageSeo = page.draftSeo ?? {};
  const setSeo = (patch: Partial<PageSeo>, immediate = false) => onChange({ ...page, draftSeo: { ...seo, ...patch } }, { immediate });
  const issue = (path: string) => {
    const hit = issues.find((i) => i.path === path || i.path.startsWith(`${path}.`));
    return hit ? issueText(hit.message) : undefined;
  };
  const handleError =
    error && ["errors.page.handle_taken", "errors.page.invalid_handle"].includes(error.messageKey)
      ? describeError(error).message
      : page.handle && !HANDLE.test(page.handle)
        ? t("editor.page.handleInvalid")
        : issue("handle");

  return (
    <div className="flex flex-col gap-5">
      <LocalizedTextField label={t("editor.page.title")} value={page.title} maxLength={200} multiline={false} required error={issue("title")} onChange={(m) => onChange({ ...page, title: m as Record<string, string> })} />
      {routable ? (
        <Field label={t("editor.page.handle")} description={t("editor.page.handleHint", { path: `/pages/${page.handle || "…"}` })} error={handleError ?? null}>
          <Input
            value={page.handle}
            disabled={!canEdit}
            prefix="/pages/"
            maxLength={120}
            onChange={(e) => onChange({ ...page, handle: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
          />
        </Field>
      ) : (
        <p className="text-sm text-fg-muted">{t("editor.page.templateNote")}</p>
      )}
      <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
        <legend className="mb-1 text-md font-semibold text-fg">{t("editor.page.seo")}</legend>
        <p className="-mt-2 text-sm text-fg-muted">{t("editor.page.seoHint")}</p>
        <LocalizedTextField label={t("editor.page.seoTitle")} value={seo.title ?? {}} maxLength={70} multiline={false} error={issue("seo.title")} onChange={(m) => setSeo({ title: m as Record<string, string> })} />
        <LocalizedTextField label={t("editor.page.seoDescription")} value={seo.description ?? {}} maxLength={320} multiline error={issue("seo.description")} onChange={(m) => setSeo({ description: m as Record<string, string> })} />
        <AssetField label={t("editor.page.seoImage")} description={t("editor.page.seoImageHint")} value={seo.imageAssetId ?? null} disabled={!canEdit} onChange={(v) => setSeo({ imageAssetId: v }, true)} />
        <Switch label={t("editor.page.noindex")} description={t("editor.page.noindexHint")} checked={Boolean(seo.noindex)} disabled={!canEdit} onCheckedChange={(c) => setSeo({ noindex: c }, true)} />
        <Field label={t("editor.page.canonical")} description={t("editor.page.canonicalHint")} optional error={seo.canonicalPath && !seo.canonicalPath.startsWith("/") ? t("editor.page.canonicalInvalid") : (issue("seo.canonicalPath") ?? null)}>
          <Input value={seo.canonicalPath ?? ""} disabled={!canEdit} maxLength={500} placeholder="/pages/…" onChange={(e) => setSeo({ canonicalPath: e.target.value.trim() === "" ? null : e.target.value.trim() })} />
        </Field>
      </fieldset>
    </div>
  );
}
