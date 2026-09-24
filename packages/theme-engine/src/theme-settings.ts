import { z } from "zod";
import { localized } from "./sections/primitives";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "errors.theme.invalid_color");

const scheme = z.object({
  background: color,
  foreground: color,
  primary: color,
  primaryForeground: color,
  muted: color,
  mutedForeground: color,
  border: color,
});

/** Fonts are limited to an allow-list served via Google Fonts or the system stack. */
export const FONT_CHOICES = ["system", "Inter", "Manrope", "DM Sans", "Poppins", "Playfair Display", "Lora", "Work Sans", "Nunito Sans"] as const;

export const themeSettingsSchema = z.object({
  colors: z
    .object({
      schemes: z.object({ default: scheme, inverse: scheme, accent: scheme, muted: scheme }),
      sale: color,
      success: color,
      error: color,
    })
    .default({
      schemes: {
        default: { background: "#ffffff", foreground: "#0f172a", primary: "#111827", primaryForeground: "#ffffff", muted: "#f1f5f9", mutedForeground: "#475569", border: "#e2e8f0" },
        inverse: { background: "#0f172a", foreground: "#f8fafc", primary: "#f8fafc", primaryForeground: "#0f172a", muted: "#1e293b", mutedForeground: "#cbd5e1", border: "#334155" },
        accent: { background: "#eef2ff", foreground: "#1e1b4b", primary: "#4f46e5", primaryForeground: "#ffffff", muted: "#e0e7ff", mutedForeground: "#3730a3", border: "#c7d2fe" },
        muted: { background: "#f8fafc", foreground: "#0f172a", primary: "#111827", primaryForeground: "#ffffff", muted: "#f1f5f9", mutedForeground: "#475569", border: "#e2e8f0" },
      },
      sale: "#dc2626",
      success: "#16a34a",
      error: "#dc2626",
    }),
  typography: z
    .object({
      headingFont: z.enum(FONT_CHOICES).default("Inter"),
      bodyFont: z.enum(FONT_CHOICES).default("Inter"),
      baseSizePx: z.number().int().min(14).max(20).default(16),
      headingScale: z.number().min(1.1).max(1.6).default(1.25),
      headingWeight: z.enum(["500", "600", "700", "800"]).default("700"),
    })
    .default({ headingFont: "Inter", bodyFont: "Inter", baseSizePx: 16, headingScale: 1.25, headingWeight: "700" }),
  shape: z
    .object({
      radiusPx: z.number().int().min(0).max(32).default(8),
      buttonStyle: z.enum(["solid", "outline"]).default("solid"),
      buttonRadiusPx: z.number().int().min(0).max(999).default(8),
    })
    .default({ radiusPx: 8, buttonStyle: "solid", buttonRadiusPx: 8 }),
  layout: z
    .object({ maxWidthPx: z.number().int().min(960).max(1920).default(1280), gutterPx: z.number().int().min(8).max(48).default(20) })
    .default({ maxWidthPx: 1280, gutterPx: 20 }),
  productCard: z
    .object({
      imageRatio: z.enum(["1:1", "3:4", "4:5", "adapt"]).default("3:4"),
      showSecondaryImageOnHover: z.boolean().default(true),
      showVendor: z.boolean().default(false),
      showQuickAdd: z.boolean().default(true),
    })
    .default({ imageRatio: "3:4", showSecondaryImageOnHover: true, showVendor: false, showQuickAdd: true }),
  brand: z
    .object({ logoAssetId: z.uuid().nullable().default(null), faviconAssetId: z.uuid().nullable().default(null) })
    .default({ logoAssetId: null, faviconAssetId: null }),
  cookieBanner: z
    .object({
      enabled: z.boolean().default(true),
      position: z.enum(["bottom", "bottom-left", "bottom-right", "center"]).default("bottom"),
      text: localized(1000),
      policyUrl: z.string().max(500).nullable().default(null),
      colorScheme: z.enum(["default", "inverse", "accent", "muted"]).default("inverse"),
    })
    .default({ enabled: true, position: "bottom", text: {}, policyUrl: null, colorScheme: "inverse" }),
});

export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

/** CSS custom properties consumed by storefront components. */
export function themeCssVariables(settings: ThemeSettings): string {
  const lines: string[] = [];
  const s = settings;
  for (const [name, sc] of Object.entries(s.colors.schemes)) {
    const sel = name === "default" ? ":root, [data-scheme=default]" : `[data-scheme=${name}]`;
    lines.push(
      `${sel}{--color-bg:${sc.background};--color-fg:${sc.foreground};--color-primary:${sc.primary};--color-primary-fg:${sc.primaryForeground};--color-muted:${sc.muted};--color-muted-fg:${sc.mutedForeground};--color-border:${sc.border};}`,
    );
  }
  const font = (f: string) => (f === "system" ? "ui-sans-serif, system-ui, sans-serif" : `"${f}", ui-sans-serif, system-ui, sans-serif`);
  lines.push(
    `:root{--color-sale:${s.colors.sale};--color-success:${s.colors.success};--color-error:${s.colors.error};--font-heading:${font(s.typography.headingFont)};--font-body:${font(s.typography.bodyFont)};--font-size-base:${s.typography.baseSizePx}px;--heading-scale:${s.typography.headingScale};--heading-weight:${s.typography.headingWeight};--radius:${s.shape.radiusPx}px;--button-radius:${s.shape.buttonRadiusPx}px;--max-width:${s.layout.maxWidthPx}px;--gutter:${s.layout.gutterPx}px;}`,
  );
  return lines.join("\n");
}
