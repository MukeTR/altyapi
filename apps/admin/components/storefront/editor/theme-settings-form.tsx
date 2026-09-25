"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Accordion } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { SCHEME_NAMES, type ColorScheme, type SchemeName, type ThemeSettings } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";
import { LocalizedTextField } from "./localized-fields";
import { ColorSchemeField } from "./reference-fields";
import { useIssueMessage } from "./schema-fields";

/** Fonts the theme engine allows (served via Google Fonts or the system stack). */
const FONTS = ["system", "Inter", "Manrope", "DM Sans", "Poppins", "Playfair Display", "Lora", "Work Sans", "Nunito Sans"] as const;
const SCHEME_KEYS: (keyof ColorScheme)[] = ["background", "foreground", "primary", "primaryForeground", "muted", "mutedForeground", "border"];
const HEX = /^#[0-9a-fA-F]{6}$/;

type Change = (next: ThemeSettings, opts?: { immediate?: boolean }) => void;

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG 2.x contrast ratio of two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number | null {
  if (!HEX.test(a) || !HEX.test(b)) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

function ColorInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string | undefined }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const invalid = !HEX.test(text);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value.toLowerCase() : "#000000"}
          disabled={!canEdit}
          aria-label={t("editor.theme.pickColor", { name: label })}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border-control bg-surface p-0.5 disabled:cursor-not-allowed"
        />
        <Input
          id={id}
          value={text}
          disabled={!canEdit}
          maxLength={7}
          className="font-mono"
          aria-invalid={invalid || Boolean(error) || undefined}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
        />
      </div>
      {invalid || error ? <p className="text-xs text-danger">{error ?? t("editor.theme.hexInvalid")}</p> : null}
    </div>
  );
}

function ContrastBadge({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const { t } = useI18n();
  const ratio = contrastRatio(fg, bg);
  if (ratio === null) return null;
  const ok = ratio >= 4.5;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs", ok ? "text-success" : "text-warning")}>
      {ok ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleAlert aria-hidden="true" className="size-3.5" />}
      {t(ok ? "editor.theme.contrastOk" : "editor.theme.contrastLow", { pair: label, ratio: ratio.toFixed(1) })}
    </p>
  );
}

function SchemeEditor({ name, scheme, onChange, issueFor }: { name: SchemeName; scheme: ColorScheme; onChange: (s: ColorScheme) => void; issueFor: (path: string) => string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="flex items-center justify-between rounded-md border p-3"
        style={{ background: scheme.background, color: scheme.foreground, borderColor: scheme.border }}
      >
        <span className="text-base font-semibold">Aa</span>
        <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: scheme.primary, color: scheme.primaryForeground }}>
          {t("editor.theme.sampleButton")}
        </span>
        <span className="rounded-sm px-1.5 py-0.5 text-xs" style={{ background: scheme.muted, color: scheme.mutedForeground }}>
          {t("editor.theme.sampleMuted")}
        </span>
      </div>
      <ContrastBadge fg={scheme.foreground} bg={scheme.background} label={t("editor.theme.pairText")} />
      <ContrastBadge fg={scheme.primaryForeground} bg={scheme.primary} label={t("editor.theme.pairButton")} />
      <ContrastBadge fg={scheme.mutedForeground} bg={scheme.muted} label={t("editor.theme.pairMuted")} />
      <div className="grid grid-cols-1 gap-3">
        {SCHEME_KEYS.map((k) => (
          <ColorInput key={k} label={t(`editor.theme.colors.${k}`)} value={scheme[k]} error={issueFor(`colors.schemes.${name}.${k}`)} onChange={(v) => onChange({ ...scheme, [k]: v })} />
        ))}
      </div>
    </div>
  );
}

function NumberSetting({ label, value, min, max, step = 1, unit, onChange, hint }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; hint?: string }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text.replace(",", "."));
  const bad = text === "" || !Number.isFinite(n) || n < min || n > max;
  return (
    <Field label={label} description={hint ?? t("editor.fields.range", { min, max })} error={bad ? t("editor.fields.range", { min, max }) : null}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={!canEdit}
        {...(unit ? { suffix: unit } : {})}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value.replace(",", "."));
          if (e.target.value !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(step < 1 ? Math.round(v * 100) / 100 : Math.round(v));
        }}
      />
    </Field>
  );
}

/** Theme tokens: colors, typography, shape, layout, product cards, logo and the cookie banner. */
export function ThemeSettingsForm({ settings, onChange }: { settings: ThemeSettings; onChange: Change }) {
  const { t } = useI18n();
  const { canEdit, issues } = useEditorContext();
  const issueText = useIssueMessage();
  const issueFor = (path: string) => {
    const hit = issues.find((i) => i.path === `settings/${path}`);
    return hit ? issueText(hit.message) : undefined;
  };
  const s = settings;
  const set = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K], immediate = false) => onChange({ ...s, [key]: value }, { immediate });
  const [scheme, setScheme] = useState<SchemeName>("default");

  return (
    <Accordion
      type="multiple"
      defaultValue={["colors"]}
      items={[
        {
          value: "colors",
          title: t("editor.theme.groups.colors"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              <Field label={t("editor.theme.scheme")} description={t("editor.theme.schemeHint")}>
                <Select value={scheme} onValueChange={(v) => setScheme(v as SchemeName)} options={SCHEME_NAMES.map((n) => ({ value: n, label: t(`editor.schemes.${n}`) }))} />
              </Field>
              <SchemeEditor name={scheme} scheme={s.colors.schemes[scheme]} issueFor={issueFor} onChange={(next) => set("colors", { ...s.colors, schemes: { ...s.colors.schemes, [scheme]: next } })} />
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                {(["sale", "success", "error"] as const).map((k) => (
                  <ColorInput key={k} label={t(`editor.theme.colors.${k}`)} value={s.colors[k]} error={issueFor(`colors.${k}`)} onChange={(v) => set("colors", { ...s.colors, [k]: v })} />
                ))}
              </div>
            </div>
          ),
        },
        {
          value: "typography",
          title: t("editor.theme.groups.typography"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              {(["headingFont", "bodyFont"] as const).map((k) => (
                <Field key={k} label={t(`editor.theme.typography.${k}`)}>
                  <Select
                    disabled={!canEdit}
                    value={s.typography[k]}
                    onValueChange={(v) => set("typography", { ...s.typography, [k]: v }, true)}
                    options={FONTS.map((f) => ({ value: f, label: f === "system" ? t("editor.theme.systemFont") : f }))}
                  />
                </Field>
              ))}
              <NumberSetting label={t("editor.theme.typography.baseSizePx")} value={s.typography.baseSizePx} min={14} max={20} unit="px" onChange={(v) => set("typography", { ...s.typography, baseSizePx: v })} />
              <NumberSetting label={t("editor.theme.typography.headingScale")} value={s.typography.headingScale} min={1.1} max={1.6} step={0.05} onChange={(v) => set("typography", { ...s.typography, headingScale: v })} hint={t("editor.theme.typography.headingScaleHint")} />
              <Field label={t("editor.theme.typography.headingWeight")}>
                <Select
                  disabled={!canEdit}
                  value={s.typography.headingWeight}
                  onValueChange={(v) => set("typography", { ...s.typography, headingWeight: v }, true)}
                  options={["500", "600", "700", "800"].map((w) => ({ value: w, label: t(`editor.theme.weights.w${w as "500" | "600" | "700" | "800"}`) }))}
                />
              </Field>
            </div>
          ),
        },
        {
          value: "shape",
          title: t("editor.theme.groups.shape"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              <NumberSetting label={t("editor.theme.shape.radiusPx")} value={s.shape.radiusPx} min={0} max={32} unit="px" onChange={(v) => set("shape", { ...s.shape, radiusPx: v })} />
              <Field label={t("editor.theme.shape.buttonStyle")}>
                <Select
                  disabled={!canEdit}
                  value={s.shape.buttonStyle}
                  onValueChange={(v) => set("shape", { ...s.shape, buttonStyle: v as "solid" | "outline" }, true)}
                  options={[
                    { value: "solid", label: t("editor.theme.shape.solid") },
                    { value: "outline", label: t("editor.theme.shape.outline") },
                  ]}
                />
              </Field>
              <NumberSetting label={t("editor.theme.shape.buttonRadiusPx")} value={s.shape.buttonRadiusPx} min={0} max={999} unit="px" onChange={(v) => set("shape", { ...s.shape, buttonRadiusPx: v })} />
              <NumberSetting label={t("editor.theme.layout.maxWidthPx")} value={s.layout.maxWidthPx} min={960} max={1920} unit="px" onChange={(v) => set("layout", { ...s.layout, maxWidthPx: v })} />
              <NumberSetting label={t("editor.theme.layout.gutterPx")} value={s.layout.gutterPx} min={8} max={48} unit="px" onChange={(v) => set("layout", { ...s.layout, gutterPx: v })} />
            </div>
          ),
        },
        {
          value: "productCard",
          title: t("editor.theme.groups.productCard"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              <Field label={t("editor.theme.productCard.imageRatio")}>
                <Select
                  disabled={!canEdit}
                  value={s.productCard.imageRatio}
                  onValueChange={(v) => set("productCard", { ...s.productCard, imageRatio: v }, true)}
                  options={["1:1", "3:4", "4:5", "adapt"].map((r) => ({ value: r, label: r === "adapt" ? t("editor.theme.productCard.adapt") : r }))}
                />
              </Field>
              {(["showSecondaryImageOnHover", "showVendor", "showQuickAdd"] as const).map((k) => (
                <Switch key={k} label={t(`editor.theme.productCard.${k}`)} checked={s.productCard[k]} disabled={!canEdit} onCheckedChange={(c) => set("productCard", { ...s.productCard, [k]: c }, true)} />
              ))}
            </div>
          ),
        },
        {
          value: "brand",
          title: t("editor.theme.groups.brand"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              <AssetField label={t("editor.theme.brand.logo")} description={t("editor.theme.brand.logoHint")} value={s.brand.logoAssetId} disabled={!canEdit} onChange={(v) => set("brand", { ...s.brand, logoAssetId: v }, true)} />
              <AssetField label={t("editor.theme.brand.favicon")} description={t("editor.theme.brand.faviconHint")} value={s.brand.faviconAssetId} disabled={!canEdit} onChange={(v) => set("brand", { ...s.brand, faviconAssetId: v }, true)} />
            </div>
          ),
        },
        {
          value: "cookieBanner",
          title: t("editor.theme.groups.cookieBanner"),
          content: (
            <div className="flex flex-col gap-4 text-fg">
              <Switch
                label={t("editor.theme.cookie.enabled")}
                description={t("editor.theme.cookie.enabledHint")}
                checked={s.cookieBanner.enabled}
                disabled={!canEdit}
                onCheckedChange={(c) => set("cookieBanner", { ...s.cookieBanner, enabled: c }, true)}
              />
              <Field label={t("editor.theme.cookie.position")}>
                <Select
                  disabled={!canEdit}
                  value={s.cookieBanner.position}
                  onValueChange={(v) => set("cookieBanner", { ...s.cookieBanner, position: v }, true)}
                  options={(["bottom", "bottom-left", "bottom-right", "center"] as const).map((p) => ({ value: p, label: t(`editor.theme.cookie.positions.${p}`) }))}
                />
              </Field>
              <LocalizedTextField label={t("editor.theme.cookie.text")} description={t("editor.theme.cookie.textHint")} value={s.cookieBanner.text} maxLength={1000} multiline onChange={(m) => set("cookieBanner", { ...s.cookieBanner, text: m as Record<string, string> })} />
              <Field label={t("editor.theme.cookie.policyUrl")} optional description={t("editor.theme.cookie.policyUrlHint")} error={issueFor("cookieBanner.policyUrl")}>
                <Input value={s.cookieBanner.policyUrl ?? ""} disabled={!canEdit} maxLength={500} placeholder="/pages/kvkk" onChange={(e) => set("cookieBanner", { ...s.cookieBanner, policyUrl: e.target.value.trim() === "" ? null : e.target.value })} />
              </Field>
              <ColorSchemeField label={t("editor.theme.cookie.colorScheme")} value={s.cookieBanner.colorScheme} options={SCHEME_NAMES} onChange={(v) => set("cookieBanner", { ...s.cookieBanner, colorScheme: v }, true)} />
              <p className="text-sm text-fg-muted">{t("editor.theme.cookie.trackingNote")}</p>
            </div>
          ),
        },
      ]}
    />
  );
}
