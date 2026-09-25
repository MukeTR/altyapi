"use client";

import { ShieldCheck, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConflictBanner } from "@/components/ui/conflict-banner";
import { AlertDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { SecretInput, type SecretValue } from "@/components/ui/secret-input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { MessageKey } from "@/lib/i18n/translate";
import { TRACKING_SECRETS, type TrackingConfig, type TrackingSecret } from "@/lib/settings/types";

type IdKey = "gtmContainerId" | "ga4MeasurementId" | "googleAdsConversionId" | "googleAdsPurchaseLabel" | "metaPixelId" | "tiktokPixelId";
type SwitchKey = "metaCapiEnabled" | "tiktokEventsApiEnabled" | "ga4MeasurementProtocolEnabled";

const ID_KEYS: readonly IdKey[] = ["gtmContainerId", "ga4MeasurementId", "googleAdsConversionId", "googleAdsPurchaseLabel", "metaPixelId", "tiktokPixelId"];

/** Field ids for the error summary; the API reports ids by body path ("/gtmContainerId"). */
const fieldId = (key: string) => `tracking-${key}`;

/** Server-side problems of errors.tracking.incomplete and the field each one concerns. */
const PROBLEM_FIELD: Record<string, string> = {
  meta_capi_requires_pixel_and_token: "metaCapiEnabled",
  tiktok_events_requires_pixel_and_token: "tiktokEventsApiEnabled",
  ga4_mp_requires_measurement_id_and_secret: "ga4MeasurementProtocolEnabled",
  google_ads_label_requires_conversion_id: "googleAdsPurchaseLabel",
};

interface Draft {
  ids: Record<IdKey, string>;
  switches: Record<SwitchKey, boolean>;
  secrets: Partial<Record<TrackingSecret, SecretValue>>;
}

function toDraft(c: TrackingConfig): Draft {
  return {
    ids: Object.fromEntries(ID_KEYS.map((k) => [k, c[k] ?? ""])) as Record<IdKey, string>,
    switches: { metaCapiEnabled: c.metaCapiEnabled, tiktokEventsApiEnabled: c.tiktokEventsApiEnabled, ga4MeasurementProtocolEnabled: c.ga4MeasurementProtocolEnabled },
    secrets: {},
  };
}

function Group({ title, description, badge, children }: { title: ReactNode; description?: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-md font-semibold text-fg">
          {title}
          {badge}
        </h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Marketing › Tracking layer. Pixel and tag ids, server-side conversion APIs (with write-only
 * keys) and the consent policy version, saved as one versioned record: a save carries the version
 * it started from and a concurrent change answers 409.
 */
export function TrackingForm({ config }: { config: TrackingConfig }) {
  const { t, describeError } = useI18n();
  const { apiBase, can, basePath } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [, startRefresh] = useTransition();
  const [current, setCurrent] = useState(config);
  const [draft, setDraft] = useState(() => toDraft(config));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const canEdit = can("tracking:manage");
  const conflictRef = useRef<HTMLDivElement>(null);

  const idsChanged = ID_KEYS.some((k) => draft.ids[k].trim() !== (current[k] ?? ""));
  const switchesChanged = (Object.keys(draft.switches) as SwitchKey[]).some((k) => draft.switches[k] !== current[k]);
  const secretsChanged = Object.values(draft.secrets).some((v) => v !== undefined && v !== "");
  const dirty = idsChanged || switchesChanged || secretsChanged;

  const conflict = error?.code === "conflict" && error.messageKey === "errors.tracking.version_conflict";
  // The banner sits above the fields; bring it into view (and focus) when a save conflicts.
  useEffect(() => {
    if (conflict) conflictRef.current?.focus();
  }, [conflict]);
  const described = error && !conflict ? describeError(error) : null;
  const problems = error?.messageKey === "errors.tracking.incomplete" ? (((error.details as { problems?: unknown } | undefined)?.problems as string[] | undefined) ?? []) : [];
  const fieldErrors: Record<string, string> = {};
  if (described) {
    for (const [path, message] of Object.entries(described.fields)) {
      const key = path.startsWith("secrets.") ? path.slice("secrets.".length) : path;
      fieldErrors[key] = t.maybe(`tracking.errors.${key}`) ?? message;
    }
  }
  for (const p of problems) {
    const key = PROBLEM_FIELD[p];
    if (key) fieldErrors[key] = t.maybe(`tracking.problems.${p}`) ?? p;
  }
  const labelOf = (key: string): string => t.maybe(`tracking.fields.${key}`) ?? key;
  const summaryItems = Object.entries(fieldErrors).map(([key, message]) => ({ fieldId: fieldId(key), message, label: labelOf(key) }));

  // Only what changed here is sent; the API keeps every omitted field as it is, so saving on top
  // of a newer version ("save anyway") does not undo someone else's unrelated changes.
  const body = (expectedVersion: number, extra: Record<string, unknown> = {}) => {
    const ids = Object.fromEntries(ID_KEYS.flatMap((k) => (draft.ids[k].trim() !== (current[k] ?? "") ? [[k, draft.ids[k].trim() || null]] : [])));
    const switches = Object.fromEntries((Object.keys(draft.switches) as SwitchKey[]).flatMap((k) => (draft.switches[k] !== current[k] ? [[k, draft.switches[k]]] : [])));
    const secrets = Object.fromEntries(TRACKING_SECRETS.flatMap((k) => (draft.secrets[k] === undefined || draft.secrets[k] === "" ? [] : [[k, draft.secrets[k]]])));
    return { expectedVersion, ...ids, ...switches, ...(Object.keys(secrets).length ? { secrets } : {}), ...extra };
  };

  const send = async (payload: Record<string, unknown>, successTitle: string) => {
    setPending(true);
    setError(null);
    try {
      const next = await bff<TrackingConfig>(`${apiBase}/tracking`, { method: "PUT", body: payload });
      setCurrent(next);
      setDraft(toDraft(next));
      toast({ tone: "success", title: successTitle });
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
      return false;
    } finally {
      setPending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || pending) return;
    void send(body(current.version), t("tracking.saved"));
  };

  const overwrite = () => {
    const currentVersion = (error?.details as { currentVersion?: unknown } | undefined)?.currentVersion;
    if (typeof currentVersion === "number") void send(body(currentVersion), t("tracking.saved"));
  };

  const reload = () => {
    setError(null);
    startRefresh(() => router.refresh());
  };

  const idField = (key: IdKey, placeholder: string, help?: MessageKey) => (
    <Field id={fieldId(key)} label={labelOf(key)} description={help ? t(help) : undefined} error={fieldErrors[key] ?? null} optional>
      <Input
        value={draft.ids[key]}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="characters"
        className="font-mono"
        onChange={(e) => setDraft((d) => ({ ...d, ids: { ...d.ids, [key]: e.target.value } }))}
      />
    </Field>
  );

  const switchField = (key: SwitchKey, help: MessageKey) => (
    <div className="flex flex-col gap-1">
      <Switch
        id={fieldId(key)}
        label={labelOf(key)}
        description={t(help)}
        checked={draft.switches[key]}
        disabled={!canEdit}
        onCheckedChange={(on) => setDraft((d) => ({ ...d, switches: { ...d.switches, [key]: on } }))}
      />
      {fieldErrors[key] ? <p className="text-sm text-danger">{fieldErrors[key]}</p> : null}
    </div>
  );

  const secretField = (key: TrackingSecret, help: MessageKey) => (
    <Field id={fieldId(key)} label={labelOf(key)} description={t(help)} error={fieldErrors[key] ?? null} optional>
      <SecretInput id={fieldId(key)} saved={current.secrets[key]} value={draft.secrets[key]} onChange={(v) => setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: v } }))} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate className="min-w-0 rounded-lg border border-border bg-surface">
        <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-5 p-5">
          <legend className="sr-only">{t("tracking.formLegend")}</legend>
          {conflict ? (
            <div ref={conflictRef} tabIndex={-1} className="outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <ConflictBanner onReload={reload} {...(canEdit ? { onOverwrite: overwrite } : {})} pending={pending} />
            </div>
          ) : null}
          {described || problems.length ? <ErrorSummary message={summaryItems.length ? undefined : described?.message} items={summaryItems} /> : null}

          <Group title={t("tracking.groups.gtm")} description={t("tracking.groups.gtmHelp")}>
            {idField("gtmContainerId", "GTM-XXXXXXX")}
          </Group>

          <Group title={t("tracking.groups.ga4")} description={t("tracking.groups.ga4Help")}>
            {idField("ga4MeasurementId", "G-XXXXXXXXXX")}
            {switchField("ga4MeasurementProtocolEnabled", "tracking.help.ga4Mp")}
            {secretField("ga4ApiSecret", "tracking.help.ga4ApiSecret")}
          </Group>

          <Group title={t("tracking.groups.googleAds")} description={t("tracking.groups.googleAdsHelp")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {idField("googleAdsConversionId", "AW-123456789")}
              {idField("googleAdsPurchaseLabel", "AbCdEfGh123", "tracking.help.googleAdsLabel")}
            </div>
          </Group>

          <Group title={t("tracking.groups.meta")} description={t("tracking.groups.metaHelp")}>
            {idField("metaPixelId", "123456789012345")}
            {switchField("metaCapiEnabled", "tracking.help.metaCapi")}
            <div className="grid gap-4 sm:grid-cols-2">
              {secretField("metaCapiAccessToken", "tracking.help.metaToken")}
              {secretField("metaTestEventCode", "tracking.help.testCode")}
            </div>
          </Group>

          <Group title={t("tracking.groups.tiktok")} description={t("tracking.groups.tiktokHelp")}>
            {idField("tiktokPixelId", "C0ABCDEFGHIJKLMNOP")}
            {switchField("tiktokEventsApiEnabled", "tracking.help.tiktokEvents")}
            <div className="grid gap-4 sm:grid-cols-2">
              {secretField("tiktokAccessToken", "tracking.help.tiktokToken")}
              {secretField("tiktokTestEventCode", "tracking.help.testCode")}
            </div>
          </Group>
        </fieldset>
        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <span className="text-sm text-fg-muted">
              {current.version > 0 ? (
                <>
                  {t("tracking.version", { version: current.version })} · <DateTime value={current.updatedAt} format="relative" />
                </>
              ) : (
                t("tracking.neverSaved")
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button disabled={!dirty || pending} onClick={() => setDraft(toDraft(current))}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      <section aria-labelledby="consent-title" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="consent-title" className="flex items-center gap-2 text-md font-semibold text-fg">
              <ShieldCheck aria-hidden="true" className="size-4 text-fg-muted" />
              {t("tracking.consent.title")}
              <Badge>{t("tracking.consent.version", { version: current.consentPolicyVersion })}</Badge>
            </h2>
            <p className="text-sm text-fg-muted">{t("tracking.consent.description")}</p>
          </div>
          {canEdit ? (
            <Button onClick={() => setRenewOpen(true)} disabled={pending || dirty}>
              <RefreshCcw aria-hidden="true" />
              {t("tracking.consent.renew")}
            </Button>
          ) : null}
        </div>
        <ul className="list-disc ps-5 text-sm text-fg-muted">
          <li>{t("tracking.consent.defaultDenied")}</li>
          <li>{t("tracking.consent.categories")}</li>
          <li>{t("tracking.consent.records")}</li>
        </ul>
        {can("storefront:read") ? (
          <p className="text-sm">
            <Link href={`${basePath}/storefront/editor?panel=theme`}>{t("tracking.consent.bannerLink")}</Link>
          </p>
        ) : null}
        {canEdit && dirty ? <p className="text-sm text-fg-muted">{t("tracking.consent.saveFirst")}</p> : null}
      </section>

      <AlertDialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        tone="primary"
        title={t("tracking.consent.renewTitle")}
        description={t("tracking.consent.renewBody", { next: String((Number.parseInt(current.consentPolicyVersion, 10) || 1) + 1) })}
        confirmLabel={t("tracking.consent.renewConfirm")}
        pending={pending}
        onConfirm={() =>
          void send({ expectedVersion: current.version, renewConsent: true }, t("tracking.consent.renewed")).then((ok) => {
            if (ok) setRenewOpen(false);
          })
        }
      >
        {error && renewOpen ? (
          <InlineAlert tone="danger" live="alert">
            {describeError(error).message}
          </InlineAlert>
        ) : null}
      </AlertDialog>
    </div>
  );
}
