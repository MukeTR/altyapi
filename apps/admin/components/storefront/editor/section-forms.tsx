"use client";

import { useId } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fieldIssue } from "@/lib/storefront/issues";
import { localeLabel } from "@/lib/locales";
import { SCHEME_NAMES, type Device, type SectionInstance, type SectionSettings, type SectionVisibility } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";
import { StringListField, useIssueMessage } from "./schema-fields";

const DEVICES: Device[] = ["mobile", "tablet", "desktop"];
const ANCHOR = /^[a-z0-9-]{1,40}$/;

type Change = (section: SectionInstance, opts?: { immediate?: boolean }) => void;

function clean<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0));
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

function withSettings(section: SectionInstance, patch: Partial<SectionSettings>): SectionInstance {
  const settings = clean({ ...(section.settings ?? {}), ...patch });
  const { settings: _old, ...rest } = section;
  return settings ? { ...rest, settings } : rest;
}

function withVisibility(section: SectionInstance, patch: Partial<SectionVisibility>): SectionInstance {
  const visibility = clean({ ...(section.visibility ?? {}), ...patch });
  const { visibility: _old, ...rest } = section;
  return visibility ? { ...rest, visibility } : rest;
}

function PaddingInputs({ label, value, defaults, onChange, disabled }: { label: string; value: Record<string, number> | undefined; defaults: { mobile: number; desktop: number }; onChange: (v: Record<string, number> | undefined) => void; disabled: boolean }) {
  const { t } = useI18n();
  const legendId = useId();
  const set = (bp: "mobile" | "desktop", raw: string) => {
    const next = { ...(value ?? {}) };
    const n = Number(raw);
    if (raw === "") delete next[bp];
    else if (Number.isInteger(n) && n >= 0 && n <= 200) next[bp] = n;
    else return;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-1.5">
      <span id={legendId} className="text-base font-medium text-fg">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {(["mobile", "desktop"] as const).map((bp) => (
          <Field key={bp} label={t(`editor.devices.${bp}`)}>
            <Input
              type="number"
              min={0}
              max={200}
              step={4}
              suffix="px"
              disabled={disabled}
              value={value?.[bp] ?? ""}
              placeholder={t("editor.appearance.defaultValue", { value: defaults[bp] })}
              onChange={(e) => set(bp, e.target.value)}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

/** Spacing, color scheme, width, anchor and responsive hiding of a section. */
export function AppearanceForm({ section, issueBase, onChange }: { section: SectionInstance; issueBase: string; onChange: Change }) {
  const { t } = useI18n();
  const { canEdit, issues } = useEditorContext();
  const issueText = useIssueMessage();
  const st = section.settings ?? {};
  const anchorIssue = fieldIssue(issues, issueBase, "settings.anchorId");
  const anchorLocalError = st.anchorId !== undefined && !ANCHOR.test(st.anchorId) ? t("editor.appearance.anchorInvalid") : null;
  return (
    <div className="flex flex-col gap-4">
      <PaddingInputs label={t("editor.appearance.paddingTop")} value={st.paddingTop} defaults={{ mobile: 32, desktop: 48 }} disabled={!canEdit} onChange={(v) => onChange(withSettings(section, { paddingTop: v }))} />
      <PaddingInputs label={t("editor.appearance.paddingBottom")} value={st.paddingBottom} defaults={{ mobile: 32, desktop: 48 }} disabled={!canEdit} onChange={(v) => onChange(withSettings(section, { paddingBottom: v }))} />
      <Field label={t("editor.appearance.colorScheme")} description={t("editor.appearance.colorSchemeHint")}>
        <Select
          disabled={!canEdit}
          value={st.colorScheme ?? "__inherit"}
          onValueChange={(v) => onChange(withSettings(section, { colorScheme: v === "__inherit" ? undefined : v }), { immediate: true })}
          options={[{ value: "__inherit", label: t("editor.appearance.inherit") }, ...SCHEME_NAMES.map((s) => ({ value: s, label: t(`editor.schemes.${s}`) }))]}
        />
      </Field>
      <Field label={t("editor.appearance.width")}>
        <Select
          disabled={!canEdit}
          value={st.fullWidth === undefined ? "__default" : st.fullWidth ? "full" : "contained"}
          onValueChange={(v) => onChange(withSettings(section, { fullWidth: v === "__default" ? undefined : v === "full" }), { immediate: true })}
          options={[
            { value: "__default", label: t("editor.appearance.widthDefault") },
            { value: "full", label: t("editor.appearance.widthFull") },
            { value: "contained", label: t("editor.appearance.widthContained") },
          ]}
        />
      </Field>
      <Field label={t("editor.appearance.anchorId")} description={t("editor.appearance.anchorHint")} error={anchorLocalError ?? (anchorIssue ? issueText(anchorIssue.message) : null)} optional>
        <Input
          value={st.anchorId ?? ""}
          disabled={!canEdit}
          maxLength={40}
          prefix="#"
          onChange={(e) => onChange(withSettings(section, { anchorId: e.target.value === "" ? undefined : e.target.value.toLowerCase() }))}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium text-fg">{t("editor.appearance.hideOn")}</legend>
        {DEVICES.map((d) => (
          <Checkbox
            key={d}
            label={t(`editor.devices.${d}`)}
            disabled={!canEdit}
            checked={st.hideOn?.includes(d) ?? false}
            onCheckedChange={(c) => onChange(withSettings(section, { hideOn: c ? [...(st.hideOn ?? []), d] : (st.hideOn ?? []).filter((x) => x !== d) }), { immediate: true })}
          />
        ))}
      </fieldset>
    </div>
  );
}

/** When, where and for whom a section is shown (schedule, devices, languages, routes, campaigns). */
export function VisibilityForm({ section, scope, issueBase, onChange }: { section: SectionInstance; scope: "page" | "global"; issueBase: string; onChange: Change }) {
  const { t, locale: ui } = useI18n();
  const { canEdit, issues, locales } = useEditorContext();
  const issueText = useIssueMessage();
  const v = section.visibility ?? {};
  const scheduleIssue = fieldIssue(issues, issueBase, "visibility");
  const scheduleError = v.startsAt && v.endsAt && v.startsAt >= v.endsAt ? t("editor.visibility.scheduleInvalid") : scheduleIssue ? issueText(scheduleIssue.message) : null;
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-medium text-fg">{t("editor.visibility.schedule")}</legend>
        <p className="-mt-1 text-sm text-fg-muted">{t("editor.visibility.scheduleHint")}</p>
        <Field label={t("editor.visibility.startsAt")} optional>
          <DateTimeInput value={v.startsAt ?? null} disabled={!canEdit} onChange={(iso) => onChange(withVisibility(section, { startsAt: iso ?? undefined }), { immediate: true })} />
        </Field>
        <Field label={t("editor.visibility.endsAt")} optional error={scheduleError}>
          <DateTimeInput value={v.endsAt ?? null} disabled={!canEdit} onChange={(iso) => onChange(withVisibility(section, { endsAt: iso ?? undefined }), { immediate: true })} />
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium text-fg">{t("editor.visibility.devices")}</legend>
        <p className="-mt-1 text-sm text-fg-muted">{t("editor.visibility.emptyMeansAll")}</p>
        {DEVICES.map((d) => (
          <Checkbox
            key={d}
            label={t(`editor.devices.${d}`)}
            disabled={!canEdit}
            checked={v.devices?.includes(d) ?? false}
            onCheckedChange={(c) => onChange(withVisibility(section, { devices: c ? [...(v.devices ?? []), d] : (v.devices ?? []).filter((x) => x !== d) }), { immediate: true })}
          />
        ))}
      </fieldset>
      {locales.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("editor.visibility.locales")}</legend>
          <p className="-mt-1 text-sm text-fg-muted">{t("editor.visibility.emptyMeansAll")}</p>
          {locales.map((l) => (
            <Checkbox
              key={l}
              label={localeLabel(l, ui)}
              disabled={!canEdit}
              checked={v.locales?.includes(l) ?? false}
              onCheckedChange={(c) => onChange(withVisibility(section, { locales: c ? [...(v.locales ?? []), l] : (v.locales ?? []).filter((x) => x !== l) }), { immediate: true })}
            />
          ))}
        </fieldset>
      ) : null}
      {scope === "global" ? (
        <>
          <StringListField label={t("editor.visibility.routes")} hint={t("editor.visibility.routesHint")} value={v.routes} maxItems={50} onChange={(list) => onChange(withVisibility(section, { routes: list }))} />
          <StringListField label={t("editor.visibility.excludeRoutes")} hint={null} value={v.excludeRoutes} maxItems={50} onChange={(list) => onChange(withVisibility(section, { excludeRoutes: list }))} />
        </>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-medium text-fg">{t("editor.visibility.campaign")}</legend>
        <p className="-mt-1 text-sm text-fg-muted">{t("editor.visibility.campaignHint")}</p>
        {(["source", "medium", "campaign"] as const).map((k) => (
          <StringListField
            key={k}
            label={t(`editor.visibility.utm.${k}`)}
            hint={null}
            value={v.utm?.[k]}
            maxItems={null}
            onChange={(list) => onChange(withVisibility(section, { utm: clean({ ...(v.utm ?? {}), [k]: list }) }))}
          />
        ))}
        <StringListField label={t("editor.visibility.referrer")} hint={t("editor.visibility.referrerHint")} value={v.referrerContains} maxItems={20} onChange={(list) => onChange(withVisibility(section, { referrerContains: list }))} />
      </fieldset>
      {v.segmentIds?.length ? <InlineAlert tone="info">{t("editor.visibility.segmentsKept", { count: v.segmentIds.length })}</InlineAlert> : null}
    </div>
  );
}
