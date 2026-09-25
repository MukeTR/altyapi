"use client";

import { useId } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RecordPicker } from "./record-pickers";

/** LinkTarget of packages/content/src/links.ts: internal records by id, never by path. */
export type LinkTarget =
  | { type: "url"; url: string }
  | { type: "page"; id: string }
  | { type: "entry"; id: string }
  | { type: "product"; id: string }
  | { type: "collection"; id: string }
  | { type: "anchor"; anchor: string }
  | { type: "whatsapp"; phone: string; text?: string }
  | { type: "tel"; phone: string };

export const LINK_TARGET_TYPES: LinkTarget["type"][] = ["url", "entry", "page", "product", "collection", "anchor", "tel", "whatsapp"];

export function emptyTarget(type: LinkTarget["type"]): LinkTarget {
  switch (type) {
    case "url":
      return { type, url: "" };
    case "anchor":
      return { type, anchor: "" };
    case "tel":
      return { type, phone: "" };
    case "whatsapp":
      return { type, phone: "" };
    default:
      return { type, id: "" };
  }
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** The API's external URL rule: https, mailto or tel only (http and anything with spaces are refused). */
export function isAllowedExternalUrl(value: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.length > 0 && !url.username && !url.password;
    if (url.protocol === "mailto:") return /^mailto:[^@]+@[^@]+\.[^@]+$/.test(value);
    if (url.protocol === "tel:") return /^tel:\+?[0-9-]{3,20}$/.test(value);
    return false;
  } catch {
    return false;
  }
}

/** Why a target cannot be saved yet, as a message key; null when it is complete. */
export function targetProblem(target: LinkTarget): "content.link.urlInvalid" | "content.link.chooseTarget" | "content.link.anchorInvalid" | "content.link.phoneInvalid" | null {
  switch (target.type) {
    case "url":
      return isAllowedExternalUrl(target.url.trim()) ? null : "content.link.urlInvalid";
    case "anchor":
      return /^[a-z0-9][a-z0-9-]{0,79}$/.test(target.anchor) ? null : "content.link.anchorInvalid";
    case "tel":
    case "whatsapp":
      return E164.test(target.phone) ? null : "content.link.phoneInvalid";
    default:
      return target.id ? null : "content.link.chooseTarget";
  }
}

/** Normalizes typed phone numbers (spaces, dashes, 00 prefix) to E.164. */
function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().\-/]/g, "");
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
}

/**
 * Where a link leads: an address (https, mailto, tel), a record of the store (entry, page,
 * product, collection; stored by id so renames never break it), an in-page anchor, a phone
 * call or a WhatsApp chat.
 */
export function LinkTargetField({ value, onChange, showErrors, disabled, types = LINK_TARGET_TYPES }: { value: LinkTarget; onChange: (t: LinkTarget) => void; showErrors: boolean; disabled?: boolean; types?: readonly LinkTarget["type"][] }) {
  const { t } = useI18n();
  const id = useId();
  const problem = showErrors ? targetProblem(value) : null;
  const error = problem ? t(problem) : null;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("content.link.type")}>
        <Select value={value.type} disabled={disabled} onValueChange={(v) => onChange(emptyTarget(v as LinkTarget["type"]))} options={types.map((ty) => ({ value: ty, label: t(`content.link.types.${ty}`) }))} />
      </Field>
      {value.type === "url" ? (
        <Field label={t("content.link.url")} description={t("content.link.urlHint")} error={error} required>
          <Input value={value.url} disabled={disabled} inputMode="url" placeholder="https://" maxLength={2000} className="font-mono" onChange={(e) => onChange({ type: "url", url: e.target.value })} />
        </Field>
      ) : value.type === "anchor" ? (
        <Field label={t("content.link.anchor")} description={t("content.link.anchorHint")} error={error} required>
          <Input value={value.anchor} disabled={disabled} prefix="#" maxLength={80} className="font-mono" onChange={(e) => onChange({ type: "anchor", anchor: e.target.value.trim().toLowerCase() })} />
        </Field>
      ) : value.type === "tel" || value.type === "whatsapp" ? (
        <>
          <Field label={t("content.link.phone")} description={t("content.link.phoneHint")} error={error} required>
            <Input value={value.phone} disabled={disabled} type="tel" inputMode="tel" placeholder="+90 5xx xxx xx xx" onChange={(e) => onChange({ ...value, phone: normalizePhone(e.target.value) })} />
          </Field>
          {value.type === "whatsapp" ? (
            <Field label={t("content.link.whatsappText")} optional>
              <Input value={value.text ?? ""} disabled={disabled} maxLength={500} onChange={(e) => onChange({ type: "whatsapp", phone: value.phone, ...(e.target.value ? { text: e.target.value } : {}) })} />
            </Field>
          ) : null}
        </>
      ) : (
        <Field label={t(`content.link.types.${value.type}`)} error={error} required id={`${id}-record`}>
          <RecordPicker to={value.type} value={value.id || null} disabled={disabled} onChange={(v) => onChange({ type: value.type, id: v ?? "" } as LinkTarget)} />
        </Field>
      )}
    </div>
  );
}

/** One-line description of a target ("https://…", "Yazı: Başlık", "#iletisim"). */
export function describeTarget(target: LinkTarget, labelOf: (id: string) => string | undefined, t: (key: "content.link.types.entry" | "content.link.types.page" | "content.link.types.product" | "content.link.types.collection") => string): string {
  switch (target.type) {
    case "url":
      return target.url;
    case "anchor":
      return `#${target.anchor}`;
    case "tel":
    case "whatsapp":
      return target.phone;
    default:
      return `${t(`content.link.types.${target.type}`)}: ${labelOf(target.id) ?? "…"}`;
  }
}
