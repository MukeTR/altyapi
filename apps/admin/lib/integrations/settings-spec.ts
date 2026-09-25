import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Form description of each connector's non-secret settings. GET /v1/integrations/providers
 * does not publish the settings schema yet, so these mirror the zod schemas in
 * packages/integrations/src/providers/*.ts (the API validates every value and answers 422
 * errors.integrations.invalid_settings with per-field issues, which the form shows inline).
 * A provider without an entry has no settings.
 */

export type SettingKind = "text" | "integer" | "integerList" | "select";

export interface SettingField {
  /** Dotted path in the settings object, e.g. "mapping.sku". */
  path: string;
  label: MessageKey;
  description?: MessageKey;
  kind: SettingKind;
  required?: boolean;
  /** Value filled in for a new connection. */
  defaultValue?: string;
  options?: readonly { value: string; label: MessageKey }[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Show only when another setting has one of these values (e.g. XML paths for format=xml). */
  when?: { path: string; oneOf: readonly string[] };
}

const initialDays = (): SettingField => ({
  path: "initialDays",
  label: "integrations.settings.initialDays",
  description: "integrations.settings.initialDaysHelp",
  kind: "integer",
  min: 1,
  max: 90,
  defaultValue: "30",
});

export const PROVIDER_SETTINGS: Readonly<Record<string, readonly SettingField[]>> = {
  stockmount: [
    { path: "storeIds", label: "integrations.settings.storeIds", description: "integrations.settings.storeIdsHelp", kind: "integerList" },
    { path: "productSourceId", label: "integrations.settings.productSourceId", description: "integrations.settings.productSourceIdHelp", kind: "integer", min: 1 },
    initialDays(),
  ],
  trendyol: [
    { path: "sellerId", label: "integrations.settings.sellerId", description: "integrations.settings.sellerIdHelp", kind: "integer", required: true, min: 1 },
    {
      path: "integratorName",
      label: "integrations.settings.integratorName",
      description: "integrations.settings.trendyolIntegratorHelp",
      kind: "text",
      defaultValue: "SelfIntegration",
      placeholder: "SelfIntegration",
    },
    {
      path: "environment",
      label: "integrations.settings.environment",
      kind: "select",
      defaultValue: "prod",
      options: [
        { value: "prod", label: "integrations.settings.envProd" },
        { value: "stage", label: "integrations.settings.envStage" },
      ],
    },
    initialDays(),
  ],
  hepsiburada: [
    { path: "merchantId", label: "integrations.settings.merchantId", description: "integrations.settings.merchantIdHelp", kind: "text", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
    { path: "integratorName", label: "integrations.settings.integratorName", description: "integrations.settings.hepsiburadaIntegratorHelp", kind: "text", required: true },
    {
      path: "environment",
      label: "integrations.settings.environment",
      kind: "select",
      defaultValue: "prod",
      options: [
        { value: "prod", label: "integrations.settings.envProd" },
        { value: "sit", label: "integrations.settings.envSit" },
      ],
    },
    initialDays(),
  ],
  feed: [
    {
      path: "format",
      label: "integrations.settings.format",
      kind: "select",
      required: true,
      defaultValue: "csv",
      options: [
        { value: "csv", label: "integrations.settings.formatCsv" },
        { value: "xlsx", label: "integrations.settings.formatXlsx" },
        { value: "xml", label: "integrations.settings.formatXml" },
      ],
    },
    {
      path: "csvDelimiter",
      label: "integrations.settings.csvDelimiter",
      kind: "select",
      options: [
        { value: ",", label: "integrations.settings.delimiterComma" },
        { value: ";", label: "integrations.settings.delimiterSemicolon" },
        { value: "\t", label: "integrations.settings.delimiterTab" },
        { value: "|", label: "integrations.settings.delimiterPipe" },
      ],
      when: { path: "format", oneOf: ["csv"] },
    },
    { path: "xmlItemPath", label: "integrations.settings.xmlItemPath", description: "integrations.settings.xmlItemPathHelp", kind: "text", placeholder: "Urunler.Urun", when: { path: "format", oneOf: ["xml"] } },
    { path: "xmlVariantPath", label: "integrations.settings.xmlVariantPath", description: "integrations.settings.xmlVariantPathHelp", kind: "text", when: { path: "format", oneOf: ["xml"] } },
    { path: "mapping.sku", label: "integrations.settings.mapSku", description: "integrations.settings.mapHelp", kind: "text", required: true },
    { path: "mapping.barcode", label: "integrations.settings.mapBarcode", kind: "text" },
    { path: "mapping.title", label: "integrations.settings.mapTitle", kind: "text" },
    { path: "mapping.stock", label: "integrations.settings.mapStock", kind: "text" },
    { path: "mapping.price", label: "integrations.settings.mapPrice", kind: "text" },
    { path: "mapping.listPrice", label: "integrations.settings.mapListPrice", kind: "text" },
  ],
};

export function settingsFor(provider: string): readonly SettingField[] {
  return PROVIDER_SETTINGS[provider] ?? [];
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (!next || typeof next !== "object") node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

/** Form values (strings) from stored settings, or the defaults for a new connection. */
export function settingsToForm(fields: readonly SettingField[], settings: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = settings ? getPath(settings, f.path) : undefined;
    if (v === undefined || v === null) out[f.path] = settings ? "" : (f.defaultValue ?? "");
    else if (Array.isArray(v)) out[f.path] = v.join(", ");
    else out[f.path] = String(v);
  }
  return out;
}

export function isFieldVisible(field: SettingField, values: Record<string, string>): boolean {
  return !field.when || field.when.oneOf.includes(values[field.when.path] ?? "");
}

/**
 * Settings object for the API from form values. Empty optional fields are left out; numbers are
 * sent as numbers when they parse, otherwise as typed so the API reports the field.
 */
export function formToSettings(fields: readonly SettingField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!isFieldVisible(f, values)) continue;
    const raw = (values[f.path] ?? "").trim();
    if (!raw && f.kind !== "select") continue;
    if (f.kind === "select" && !raw) continue;
    if (f.kind === "integer") setPath(out, f.path, /^-?\d+$/.test(raw) ? Number(raw) : raw);
    else if (f.kind === "integerList") {
      const parts = raw.split(/[\s,;]+/).filter(Boolean);
      setPath(out, f.path, parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p)));
    } else setPath(out, f.path, f.kind === "select" ? values[f.path] : raw);
  }
  return out;
}
