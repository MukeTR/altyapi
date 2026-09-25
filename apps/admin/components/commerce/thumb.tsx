"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const BOX = { 28: "size-7", 36: "size-9", 48: "size-12", 64: "size-16", 96: "size-24" } as const;

/**
 * Square product image with a neutral placeholder when there is none or it fails to load
 * (e.g. storage that does not serve public objects). Decorative unless `alt` is given.
 */
export function Thumb({ src, alt = "", size = 36, className }: { src: string | null; alt?: string; size?: keyof typeof BOX; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const box = BOX[size];
  // A server-rendered <img> can fail before React hydrates, so its onError never runs; check once mounted.
  useEffect(() => {
    const el = imgRef.current;
    if (src && el && el.complete && el.naturalWidth === 0) setFailed(src);
  }, [src]);
  if (!src || failed === src) {
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn("inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-fg-subtle", box, className)}
      >
        <ImageOff className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- media is served by the storage CDN, not the Next image optimizer.
    <img ref={imgRef} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} className={cn("shrink-0 rounded-md border border-border bg-surface-muted object-cover", box, className)} />
  );
}
