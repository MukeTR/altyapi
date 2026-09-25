"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/components/providers/store-provider";
import { ApiError, bff } from "@/lib/api/client";
import type { CursorPage } from "@/lib/api/types";
import type { ProductListItem } from "@/lib/commerce/types";

/**
 * Debounced (200 ms), abortable product search over GET products?q= for pickers. An empty query
 * lists the most recently updated products.
 */
export function useProductSearch(limit = 20) {
  const { apiBase } = useStore();
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef("");

  const run = useCallback(
    async (q: string) => {
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      setLoading(true);
      setError(null);
      try {
        const page = await bff<CursorPage<ProductListItem>>(`${apiBase}/products`, { query: { q: q.trim() || undefined, limit }, signal: c.signal });
        if (!c.signal.aborted) setItems(page.items);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (err instanceof ApiError) setError(err);
        else throw err;
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    [apiBase, limit],
  );

  const search = useCallback(
    (q: string) => {
      last.current = q;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(q), 200);
    },
    [run],
  );

  useEffect(() => {
    void run("");
    return () => {
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run]);

  return { items, loading, error, search, retry: () => void run(last.current) };
}
