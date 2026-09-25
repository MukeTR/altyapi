"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/components/providers/store-provider";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { Asset } from "@/lib/media/types";

/** Assets already fetched in this tab, by id (they rarely change; alt text edits update the entry). */
const cache = new Map<string, Asset>();
const inflight = new Map<string, Promise<Asset>>();

export function rememberAsset(asset: Asset) {
  cache.set(asset.id, asset);
}

function fetchAsset(apiBase: string, id: string): Promise<Asset> {
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = bff<Asset>(`${apiBase}/assets/${id}`)
    .then((a) => {
      cache.set(id, a);
      return a;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export type AssetState = { status: "empty" } | { status: "loading" } | { status: "ready"; asset: Asset } | { status: "error"; error: ApiErrorInfo };

/** The asset behind an id (a section image, the logo), loaded once per tab. */
export function useAsset(id: string | null | undefined): AssetState {
  const { apiBase } = useStore();
  const [state, setState] = useState<AssetState>(() => (!id ? { status: "empty" } : cache.has(id) ? { status: "ready", asset: cache.get(id)! } : { status: "loading" }));

  useEffect(() => {
    if (!id) {
      setState({ status: "empty" });
      return;
    }
    const cached = cache.get(id);
    if (cached) {
      setState({ status: "ready", asset: cached });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    fetchAsset(apiBase, id).then(
      (asset) => alive && setState({ status: "ready", asset }),
      (err) => alive && setState({ status: "error", error: err instanceof ApiError ? err.toInfo() : { status: 0, code: "network", messageKey: "errors.network", correlationId: null } }),
    );
    return () => {
      alive = false;
    };
  }, [apiBase, id]);

  return state;
}

/** Smallest usable image URL: the thumbnail variant when the image service serves it, else the original. */
export function assetThumbnail(asset: Asset): string | null {
  return asset.variants?.thumbnail ?? asset.url;
}
