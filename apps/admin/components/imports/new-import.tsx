"use client";

import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { useUploader } from "@/components/media/use-uploader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FileDropzone, type UploadTask } from "@/components/ui/file-dropzone";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ImportJob, ImportProfile } from "@/lib/commerce/types";
import { localeLabel } from "@/lib/locales";

const TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
};

type Format = "csv" | "xlsx" | "xml";

function formatOf(name: string): Format | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "csv" || ext === "xlsx" || ext === "xml" ? ext : null;
}

/** Step 1 of an import: upload the file and choose how rows become products. */
export function NewImport({ profiles }: { profiles: ImportProfile[] }) {
  const { t, locale: ui, describeError } = useI18n();
  const { store, apiBase, basePath, can } = useStore();
  const router = useRouter();
  const upload = useUploader();
  const [file, setFile] = useState<{ assetId: string; name: string; format: Format } | null>(null);
  const [profileId, setProfileId] = useState("none");
  const [delimiter, setDelimiter] = useState("auto");
  const [xmlItemPath, setXmlItemPath] = useState("");
  const [xmlVariantPath, setXmlVariantPath] = useState("");
  const [matchBy, setMatchBy] = useState("sku");
  const [groupBy, setGroupBy] = useState("handle");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [publishImported, setPublishImported] = useState(false);
  const [locale, setLocale] = useState(store.defaultLocale);
  const [currency, setCurrency] = useState(store.defaultCurrency);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const onUpload = useCallback(
    async ({ file: raw, sha256, onProgress, signal }: UploadTask) => {
      const format = formatOf(raw.name);
      if (!format) throw new Error(t("imports.new.unsupported"));
      // Some systems label CSV as application/vnd.ms-excel; the API needs the real type.
      const typed = raw.type === TYPES[format] ? raw : new File([raw], raw.name, { type: TYPES[format] });
      const asset = await upload({ file: typed, sha256, purpose: "import", onProgress, signal });
      if (asset.status !== "ready") throw new Error(t("imports.new.notReady"));
      setFile({ assetId: asset.id, name: raw.name, format });
    },
    [upload, t],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const options = {
        matchBy,
        groupBy,
        updateExisting,
        publishImported,
        locale,
        currency,
        ...(file.format === "csv" && delimiter !== "auto" ? { csvDelimiter: delimiter === "tab" ? "\t" : delimiter } : {}),
        ...(file.format === "xml" && xmlItemPath.trim() ? { xmlItemPath: xmlItemPath.trim() } : {}),
        ...(file.format === "xml" && xmlVariantPath.trim() ? { xmlVariantPath: xmlVariantPath.trim() } : {}),
      };
      const job = await bff<ImportJob>(`${apiBase}/imports`, { method: "POST", body: { assetId: file.assetId, format: file.format, ...(profileId !== "none" ? { profileId } : {}), options } });
      router.push(`${basePath}/products/imports/${job.id}`);
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <PageHeader
        title={t("imports.new.title")}
        breadcrumbs={[
          { label: t("products.title"), href: `${basePath}/products` },
          { label: t("imports.title"), href: `${basePath}/products/imports` },
        ]}
      />
      <Stepper
        current={file ? 1 : 0}
        steps={[
          { id: "file", label: t("imports.steps.file") },
          { id: "options", label: t("imports.steps.options") },
          { id: "mapping", label: t("imports.steps.mapping") },
          { id: "run", label: t("imports.steps.run") },
        ]}
      />
      {!can("catalog:write") ? <InlineAlert tone="info">{t("commerce.noPermission", { permission: "catalog:write" })}</InlineAlert> : null}
      <Card title={t("imports.new.fileTitle")} description={t("imports.new.fileDescription")} padding="form">
        {file ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet aria-hidden="true" className="size-5 text-fg-muted" />
              <span className="truncate text-base text-fg">{file.name}</span>
              <span className="text-sm uppercase text-fg-subtle">{file.format}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              {t("imports.new.replace")}
            </Button>
          </div>
        ) : (
          <FileDropzone upload={onUpload} multiple={false} accept=".csv,.xlsx,.xml,text/csv,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" acceptLabel="CSV, Excel (.xlsx), XML" disabled={!can("catalog:write")} />
        )}
      </Card>

      {file ? (
        <Card title={t("imports.new.optionsTitle")} padding="form">
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <FormAlert tone="danger" focusKey={error}>
                {describeError(error).message}
              </FormAlert>
            ) : null}
            {profiles.length > 0 ? (
              <Field label={t("imports.new.profile")} description={t("imports.new.profileHint")}>
                <Select value={profileId} onValueChange={setProfileId} options={[{ value: "none", label: t("imports.new.noProfile") }, ...profiles.filter((p) => p.format === file.format).map((p) => ({ value: p.id, label: p.name }))]} />
              </Field>
            ) : null}
            {file.format === "csv" ? (
              <Field label={t("imports.new.delimiter")}>
                <Select
                  value={delimiter}
                  onValueChange={setDelimiter}
                  options={[
                    { value: "auto", label: t("imports.new.delimiterAuto") },
                    { value: ",", label: t("imports.new.delimiters.comma") },
                    { value: ";", label: t("imports.new.delimiters.semicolon") },
                    { value: "tab", label: t("imports.new.delimiters.tab") },
                    { value: "|", label: t("imports.new.delimiters.pipe") },
                  ]}
                />
              </Field>
            ) : null}
            {file.format === "xml" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("imports.new.xmlItemPath")} optional description={t("imports.new.xmlItemPathHint")}>
                  <Input value={xmlItemPath} onChange={(e) => setXmlItemPath(e.target.value)} placeholder="products.product" className="font-mono" maxLength={200} />
                </Field>
                <Field label={t("imports.new.xmlVariantPath")} optional description={t("imports.new.xmlVariantPathHint")}>
                  <Input value={xmlVariantPath} onChange={(e) => setXmlVariantPath(e.target.value)} placeholder="variants.variant" className="font-mono" maxLength={200} />
                </Field>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("imports.new.groupBy")} description={t("imports.new.groupByHint")}>
                <Select value={groupBy} onValueChange={setGroupBy} options={(["handle", "external_ref", "none"] as const).map((g) => ({ value: g, label: t(`imports.new.groupByOptions.${g}`) }))} />
              </Field>
              <Field label={t("imports.new.matchBy")} description={t("imports.new.matchByHint")}>
                <Select value={matchBy} onValueChange={setMatchBy} options={(["sku", "external_ref", "handle"] as const).map((m) => ({ value: m, label: t(`imports.new.matchByOptions.${m}`) }))} />
              </Field>
              {store.supportedLocales.length > 1 ? (
                <Field label={t("imports.new.locale")}>
                  <Select value={locale} onValueChange={setLocale} options={store.supportedLocales.map((l) => ({ value: l, label: localeLabel(l, ui) }))} />
                </Field>
              ) : null}
              {store.supportedCurrencies.length > 1 ? (
                <Field label={t("imports.new.currency")}>
                  <Select value={currency} onValueChange={setCurrency} options={store.supportedCurrencies.map((c) => ({ value: c, label: c }))} />
                </Field>
              ) : null}
            </div>
            <Switch checked={updateExisting} onCheckedChange={setUpdateExisting} label={t("imports.new.updateExisting")} description={t("imports.new.updateExistingHint")} />
            <Switch checked={publishImported} onCheckedChange={setPublishImported} label={t("imports.new.publish")} description={t("imports.new.publishHint")} />
            <Button type="submit" variant="primary" className="self-end" loading={pending}>
              {t("imports.new.submit")}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
