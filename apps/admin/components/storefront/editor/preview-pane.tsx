"use client";

import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ErrorState } from "@/components/ui/error-state";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { previewUrl } from "@/lib/storefront/preview";
import type { Device, PreviewToken } from "@/lib/storefront/types";

/** Tokens live one hour; a new one is minted well before that. */
const TOKEN_REUSE_MS = 45 * 60_000;

export const DEVICE_WIDTHS: Record<Device, number> = { desktop: 1280, tablet: 768, mobile: 390 };

/**
 * Store-bound preview tokens (POST storefront/preview-token), reused while fresh. A preview URL
 * carries the token; the storefront turns it into its preview cookie and shows drafts.
 */
export function usePreviewToken() {
  const { apiBase } = useStore();
  const cached = useRef<{ token: string; at: number } | null>(null);
  const pending = useRef<Promise<string> | null>(null);
  return useCallback(async (): Promise<string> => {
    if (cached.current && Date.now() - cached.current.at < TOKEN_REUSE_MS) return cached.current.token;
    if (pending.current) return pending.current;
    const p = bff<PreviewToken>(`${apiBase}/storefront/preview-token`, { method: "POST" })
      .then((r) => {
        cached.current = { token: r.token, at: Date.now() };
        return r.token;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = p;
    return p;
  }, [apiBase]);
}

interface Frame {
  key: number;
  src: string;
  loaded: boolean;
}

/**
 * Live preview of the draft in an iframe at the chosen device width (scaled down to fit). After
 * every save the page is reloaded in a second, hidden frame that replaces the visible one once it
 * has loaded, so the preview never flashes blank.
 */
export function PreviewPane({ path, device, reloadKey, title, placeholder }: { path: string | null; device: Device; reloadKey: number; title: string; placeholder?: ReactNode }) {
  const { t } = useI18n();
  const { storefrontUrl } = useStore();
  const getToken = usePreviewToken();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nextKey = useRef(1);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    getToken().then(
      (token) => {
        if (!alive) return;
        setError(null);
        const key = nextKey.current++;
        const src = previewUrl(storefrontUrl, path, token, { _v: String(key) });
        setFrames((list) => [...list.filter((f) => f.loaded).slice(-1), { key, src, loaded: false }]);
      },
      (err) => alive && setError(err instanceof ApiError ? err.toInfo() : { status: 0, code: "network", messageKey: "errors.network", correlationId: null }),
    );
    return () => {
      alive = false;
    };
  }, [path, reloadKey, attempt, getToken, storefrontUrl]);

  const onLoad = (key: number) => setFrames((list) => (list.some((f) => f.key === key) ? list.filter((f) => f.key >= key).map((f) => (f.key === key ? { ...f, loaded: true } : f)) : list));

  const width = DEVICE_WIDTHS[device];
  const scale = box.width > 0 ? Math.min(1, (box.width - 32) / width) : 1;
  const height = box.height > 0 ? (box.height - 32) / scale : 800;
  const reloading = frames.some((f) => !f.loaded);
  const shown = frames.filter((f) => f.loaded).at(-1)?.key ?? frames.at(-1)?.key;

  return (
    <div ref={boxRef} className="relative flex h-full min-h-0 w-full items-start justify-center overflow-hidden bg-surface-sunken p-4">
      {!path ? (
        <div className="flex h-full w-full items-center justify-center">{placeholder}</div>
      ) : error ? (
        <div className="m-auto max-w-md rounded-lg border border-border bg-surface">
          <ErrorState error={error} title={t("editor.preview.tokenFailed")} compact onRetry={() => setAttempt((a) => a + 1)} />
        </div>
      ) : (
        <div
          className="relative shrink-0 origin-top overflow-hidden rounded-md border border-border bg-white shadow-md"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top center" }}
        >
          {frames.map((f) => (
            <iframe
              key={f.key}
              src={f.src}
              title={title}
              // The storefront runs merchant-configured third-party code (tracking tags, theme
              // content). It keeps its own origin for cookies and preview mode, but may not navigate
              // the admin window, open popups or start downloads.
              sandbox="allow-scripts allow-same-origin allow-forms"
              referrerPolicy="no-referrer"
              onLoad={() => onLoad(f.key)}
              aria-hidden={f.key !== shown || undefined}
              tabIndex={f.key !== shown ? -1 : undefined}
              className={cn("absolute inset-0 size-full border-0 bg-white", f.key !== shown && "invisible")}
            />
          ))}
        </div>
      )}
      {path && !error && reloading ? (
        <div role="status" className="absolute end-6 top-6 flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg-muted shadow-sm">
          {frames.some((f) => f.loaded) ? <RotateCw aria-hidden="true" className="size-3.5 animate-spin-slow" /> : <Spinner />}
          {frames.some((f) => f.loaded) ? t("editor.preview.refreshing") : t("editor.preview.loading")}
        </div>
      ) : null}
    </div>
  );
}
