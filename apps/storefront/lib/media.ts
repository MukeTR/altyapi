/** Mirrors IMAGE_PRESETS in @altyapi/storage (Cloudflare Image Transformations). */
export const PRESETS = {
  thumbnail: { width: 160, height: 160, fit: "cover" },
  card: { width: 480, height: 480, fit: "cover" },
  product: { width: 1000, height: 1000, fit: "contain" },
  zoom: { width: 2000, height: 2000, fit: "scale-down" },
  "hero-mobile": { width: 828, height: 1104, fit: "cover" },
  "hero-desktop": { width: 1920, height: 800, fit: "cover" },
  social: { width: 1200, height: 630, fit: "cover" },
} as const;

export type Preset = keyof typeof PRESETS;

export function mediaUrl(base: string | null, objectKey: string, preset?: Preset, dpr: 1 | 2 = 1): string | null {
  if (!base) return null;
  const root = base.replace(/\/$/, "");
  if (!preset) return `${root}/${objectKey}`;
  const p = PRESETS[preset];
  return `${root}/cdn-cgi/image/width=${p.width},height=${p.height},fit=${p.fit},dpr=${dpr},quality=85,format=auto,metadata=none/${objectKey}`;
}

export function srcSet(base: string | null, objectKey: string, preset: Preset): string | undefined {
  if (!base) return undefined;
  return ([1, 2] as const).map((d) => `${mediaUrl(base, objectKey, preset, d)} ${PRESETS[preset].width * d}w`).join(", ");
}
