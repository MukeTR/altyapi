"use client";

import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SecretInput } from "@/components/ui/secret-input";
import { Switch } from "@/components/ui/switch";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { formToSettings, isFieldVisible, settingsFor, settingsToForm } from "@/lib/integrations/settings-spec";
import type { ConnectResult, IntegrationConnection, IntegrationProvider } from "@/lib/integrations/types";
import { isSecretCredential } from "./shared";

const credId = (key: string) => `integration-credential-${key}`;
const settingId = (path: string) => `integration-setting-${path.replace(/\./g, "-")}`;

export interface ConnectionFormProps {
  provider: Pick<IntegrationProvider, "id" | "name" | "credentialFields" | "defaultPollMinutes">;
  /** Edit an existing connection; omitted for a new one. */
  connection?: IntegrationConnection;
  onDone: (connection: IntegrationConnection, account: string | null) => void;
  onCancel?: () => void;
}

/**
 * Credentials, non-secret settings, name and polling interval of an integration connection.
 * New connections are verified with the provider before they are saved; editing re-verifies
 * when settings or credentials change. Stored credentials are never shown: editing offers to
 * replace them as a whole.
 */
export function ConnectionForm({ provider, connection, onDone, onCancel }: ConnectionFormProps) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const settingFields = settingsFor(provider.id);
  const [name, setName] = useState(connection?.name ?? provider.name);
  const [poll, setPoll] = useState(String(connection?.pollIntervalMinutes ?? provider.defaultPollMinutes));
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [replaceCredentials, setReplaceCredentials] = useState(!connection);
  const initialSettings = settingsToForm(settingFields, connection ? connection.settings : null);
  const [settings, setSettings] = useState<Record<string, string>>(initialSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const described = error ? describeError(error, { "errors.integrations.name_taken": "name" }) : null;
  // The API reports credential and settings issues with paths inside their own object.
  const target = error?.messageKey === "errors.integrations.invalid_credentials" ? "credentials" : error?.messageKey === "errors.integrations.invalid_settings" ? "settings" : null;
  const credentialErrors: Record<string, string> = {};
  const settingErrors: Record<string, string> = {};
  const otherErrors: Record<string, string> = {};
  if (described) {
    for (const [path, message] of Object.entries(described.fields)) {
      if (target === "credentials") credentialErrors[path] = message;
      else if (target === "settings") settingErrors[path] = message;
      else otherErrors[path] = message;
    }
  }
  const providerMessage = error?.messageKey === "errors.integrations.verification_failed" && typeof (error.details as { message?: unknown } | undefined)?.message === "string" ? (error.details as { message: string }).message : null;
  const formMessage = described
    ? target === "credentials"
      ? t("integrations.form.invalidCredentials")
      : target === "settings"
        ? t("integrations.form.invalidSettings")
        : providerMessage
          ? `${described.message} ${t("integrations.form.providerSaid", { message: providerMessage })}`
          : described.message
    : undefined;
  const summaryItems = [
    ...Object.entries(credentialErrors).map(([k, m]) => ({ fieldId: credId(k), message: m, label: t.maybe(`integrations.credentials.${k}`) ?? k })),
    ...Object.entries(settingErrors).map(([k, m]) => {
      const f = settingFields.find((s) => s.path === k);
      return { fieldId: settingId(k), message: m, label: f ? t(f.label) : k };
    }),
    ...Object.entries(otherErrors).map(([k, m]) => ({ fieldId: k === "name" ? "integration-name" : k === "pollIntervalMinutes" ? "integration-poll" : "integration-name", message: m, label: k === "pollIntervalMinutes" ? t("integrations.form.poll") : t("integrations.form.name") })),
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const pollMinutes = Number.parseInt(poll, 10);
    const settingsBody = formToSettings(settingFields, settings);
    const credentialsBody = Object.fromEntries(provider.credentialFields.flatMap((k) => ((credentials[k] ?? "").trim() ? [[k, credentials[k]!.trim()]] : [])));
    try {
      if (!connection) {
        const res = await bff<ConnectResult>(`${apiBase}/integrations/connections`, {
          method: "POST",
          body: { provider: provider.id, name: name.trim(), credentials: credentialsBody, settings: settingsBody, ...(Number.isFinite(pollMinutes) ? { pollIntervalMinutes: pollMinutes } : {}) },
        });
        setCredentials({});
        onDone(res.connection, res.account);
      } else {
        const settingsChanged = JSON.stringify(settingsBody) !== JSON.stringify(formToSettings(settingFields, initialSettings));
        const patch = {
          ...(name.trim() !== connection.name ? { name: name.trim() } : {}),
          ...(Number.isFinite(pollMinutes) && pollMinutes !== connection.pollIntervalMinutes ? { pollIntervalMinutes: pollMinutes } : {}),
          ...(settingsChanged ? { settings: settingsBody } : {}),
          ...(replaceCredentials ? { credentials: credentialsBody } : {}),
        };
        const updated = await bff<IntegrationConnection>(`${apiBase}/integrations/connections/${connection.id}`, { method: "PATCH", body: patch });
        setCredentials({});
        setReplaceCredentials(false);
        onDone(updated, null);
      }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate autoComplete="off" className="flex flex-col gap-5">
      {formMessage || summaryItems.length ? <ErrorSummary message={formMessage} items={summaryItems} /> : null}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <legend className="mb-2 text-md font-semibold text-fg">{t("integrations.form.general")}</legend>
        <Field id="integration-name" label={t("integrations.form.name")} description={t("integrations.form.nameHelp")} required error={otherErrors.name ?? null}>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="integration-poll" label={t("integrations.form.poll")} description={t("integrations.form.pollHelp")} error={otherErrors.pollIntervalMinutes ?? null}>
          <Input type="number" inputMode="numeric" min={5} max={1440} value={poll} onChange={(e) => setPoll(e.target.value)} suffix={t("integrations.form.minutes")} className="w-40" />
        </Field>
      </fieldset>

      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4 border-t border-border pt-5">
        <legend className="sr-only">{t("integrations.form.credentials")}</legend>
        <div className="flex flex-col gap-0.5">
          <h3 aria-hidden="true" className="text-md font-semibold text-fg">
            {t("integrations.form.credentials")}
          </h3>
          <p className="text-sm text-fg-muted">{t("integrations.form.credentialsHelp")}</p>
        </div>
        {connection ? (
          <Switch label={t("integrations.form.replaceCredentials")} description={t("integrations.form.replaceCredentialsHelp")} checked={replaceCredentials} onCheckedChange={setReplaceCredentials} />
        ) : null}
        {replaceCredentials
          ? provider.credentialFields.map((key) => (
              <Field key={key} id={credId(key)} label={t.maybe(`integrations.credentials.${key}`) ?? key} error={credentialErrors[key] ?? null}>
                {isSecretCredential(key) ? (
                  <SecretInput id={credId(key)} saved={false} removable={false} value={credentials[key] ?? ""} onChange={(v) => setCredentials((c) => ({ ...c, [key]: v ?? "" }))} />
                ) : (
                  <Input
                    type={key === "url" ? "url" : key === "email" ? "email" : "text"}
                    spellCheck={false}
                    autoComplete="off"
                    className={key === "url" ? "font-mono" : undefined}
                    placeholder={key === "url" ? "https://" : undefined}
                    value={credentials[key] ?? ""}
                    onChange={(e) => setCredentials((c) => ({ ...c, [key]: e.target.value }))}
                  />
                )}
              </Field>
            ))
          : null}
      </fieldset>

      {settingFields.length ? (
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4 border-t border-border pt-5">
          <legend className="sr-only">{t("integrations.form.settings")}</legend>
          <div className="flex flex-col gap-0.5">
            <h3 aria-hidden="true" className="text-md font-semibold text-fg">
              {t("integrations.form.settings")}
            </h3>
            <p className="text-sm text-fg-muted">{t("integrations.form.settingsHelp")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {settingFields.filter((f) => isFieldVisible(f, settings)).map((f) => (
              <Field key={f.path} id={settingId(f.path)} label={t(f.label)} description={f.description ? t(f.description) : undefined} required={f.required ?? false} error={settingErrors[f.path] ?? null}>
                {f.kind === "select" ? (
                  <Select value={settings[f.path] ?? ""} onValueChange={(v) => setSettings((s) => ({ ...s, [f.path]: v }))} options={(f.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }))} />
                ) : (
                  <Input
                    value={settings[f.path] ?? ""}
                    inputMode={f.kind === "integer" ? "numeric" : undefined}
                    placeholder={f.placeholder}
                    spellCheck={false}
                    className={f.kind === "text" ? "font-mono" : undefined}
                    onChange={(e) => setSettings((s) => ({ ...s, [f.path]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          <ShieldCheck aria-hidden="true" />
          {connection ? t("integrations.form.save") : t("integrations.form.connect")}
        </Button>
      </div>
    </form>
  );
}
