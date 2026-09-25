"use client";

import { FileImage } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/components/providers/store-provider";
import { bff } from "@/lib/api/client";
import type { Asset } from "@/lib/media/types";
import { cn } from "@/lib/cn";

/** Short-lived signed URLs by asset id (the API signs them for 300 s; reused for up to 4 minutes). */
const signed = new Map<string, { url: string; until: number }>();

export async function signedAssetUrl(apiBase: string, id: string): Promise<string> {
  const hit = signed.get(id);
  if (hit && hit.until > Date.now()) return hit.url;
  const res = await bff<{ url: string; expiresInSeconds: number }>(`${apiBase}/assets/${id}/download`);
  signed.set(id, { url: res.url, until: Date.now() + Math.max(30, Math.min(240, res.expiresInSeconds - 30)) * 1000 });
  return res.url;
}

/**
 * Thumbnail of an asset. Tries the resized variant, then the public original, then a signed
 * download link (private buckets, and development setups without a public image host).
 */
export function AssetImage({ asset, alt, className, variant = "thumbnail" }: { asset: Asset; alt: string; className?: string; variant?: "thumbnail" | "card" }) {
  const { apiBase } = useStore();
  const candidates = [asset.variants?.[variant], asset.url].filter((u): u is string => Boolean(u));
  const [index, setIndex] = useState(0);
  const [signedSrc, setSignedSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const usable = asset.kind === "image" && asset.status === "ready";

  useEffect(() => {
    setIndex(0);
    setSignedSrc(null);
    setFailed(false);
  }, [asset.id]);

  // After the public URLs failed (or there are none), ask the API for a signed link once.
  const needSigned = usable && !failed && index >= candidates.length && signedSrc === null;
  useEffect(() => {
    if (!needSigned) return;
    let alive = true;
    signedAssetUrl(apiBase, asset.id).then(
      (url) => alive && setSignedSrc(url),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [needSigned, apiBase, asset.id]);

  const src = index < candidates.length ? candidates[index] : signedSrc;
  const imgRef = useRef<HTMLImageElement>(null);
  const next = () => (index < candidates.length ? setIndex(index + 1) : setFailed(true));
  // A server-rendered <img> can fail before React hydrates, so its onError never runs; check once mounted.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per candidate; `next` closes over it
  }, [src]);
  if (!usable || failed) {
    return (
      <span className={cn("flex items-center justify-center bg-surface-muted text-fg-subtle", className)}>
        <FileImage aria-hidden="true" className="size-5" />
        {alt ? <span className="sr-only">{alt}</span> : null}
      </span>
    );
  }
  if (!src) return <span aria-hidden="true" className={cn("block animate-shimmer bg-surface-muted", className)} />;
  return (
    // Storefront media are served by the store's image host; next/image optimization does not apply.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      ref={imgRef}
      onError={next}
      className={cn("bg-surface-muted object-cover", className)}
    />
  );
}
