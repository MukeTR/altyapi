/**
 * Public URLs of storefront media (product images). Objects live in the storefront-public
 * bucket under MEDIA_PUBLIC_BASE_URL; production resizes through the CDN image transform, local
 * development serves the original object. Usable on the server and in the browser: server
 * components read the config with mediaConfig() (lib/media-server.ts) and pass it down.
 */
export interface MediaConfig {
  /** MEDIA_PUBLIC_BASE_URL, or null when media is not configured. */
  base: string | null;
  /** The CDN image transform (/cdn-cgi/image/…) is available. */
  transforms: boolean;
}

const PRESETS = {
  thumbnail: { width: 160, height: 160, fit: "cover" },
  card: { width: 480, height: 480, fit: "cover" },
} as const;

export type MediaPreset = keyof typeof PRESETS;

export function mediaUrl(config: MediaConfig, objectKey: string | null | undefined, preset: MediaPreset = "thumbnail"): string | null {
  if (!config.base || !objectKey) return null;
  const root = config.base.replace(/\/$/, "");
  if (!config.transforms) return `${root}/${objectKey}`;
  const p = PRESETS[preset];
  return `${root}/cdn-cgi/image/width=${p.width},height=${p.height},fit=${p.fit},dpr=2,quality=80,format=auto,metadata=none/${objectKey}`;
}
