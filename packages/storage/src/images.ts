/**
 * Image presets rendered by Cloudflare Image Transformations. Only the original is stored;
 * every size is produced at the edge via /cdn-cgi/image/<options>/<path>.
 */
export const IMAGE_PRESETS = {
  thumbnail: { width: 160, height: 160, fit: "cover" },
  card: { width: 480, height: 480, fit: "cover" },
  product: { width: 1000, height: 1000, fit: "contain" },
  zoom: { width: 2000, height: 2000, fit: "scale-down" },
  "hero-mobile": { width: 828, height: 1104, fit: "cover" },
  "hero-desktop": { width: 1920, height: 800, fit: "cover" },
  social: { width: 1200, height: 630, fit: "cover" },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

export interface ImageUrlOptions {
  preset: ImagePreset;
  /** Device pixel ratio variant for srcset (1 or 2). */
  dpr?: 1 | 2;
  quality?: number;
}

/** Public URL of an object in the storefront-public bucket. */
export function publicObjectUrl(mediaBaseUrl: string, objectKey: string): string {
  return `${mediaBaseUrl.replace(/\/$/, "")}/${objectKey}`;
}

export function imageUrl(mediaBaseUrl: string, objectKey: string, opts: ImageUrlOptions): string {
  const p = IMAGE_PRESETS[opts.preset];
  const options = [
    `width=${p.width}`,
    `height=${p.height}`,
    `fit=${p.fit}`,
    `dpr=${opts.dpr ?? 1}`,
    `quality=${opts.quality ?? 85}`,
    "format=auto",
    "metadata=none",
  ].join(",");
  return `${mediaBaseUrl.replace(/\/$/, "")}/cdn-cgi/image/${options}/${objectKey}`;
}

/** srcset with 1x/2x variants for responsive images. */
export function imageSrcSet(mediaBaseUrl: string, objectKey: string, preset: ImagePreset): string {
  return [1, 2]
    .map((dpr) => `${imageUrl(mediaBaseUrl, objectKey, { preset, dpr: dpr as 1 | 2 })} ${IMAGE_PRESETS[preset].width * dpr}w`)
    .join(", ");
}
