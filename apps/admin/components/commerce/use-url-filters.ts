"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/** Pagination parameters that must reset whenever a filter changes. */
const PAGING = ["cursor", "prev", "offset"];

/**
 * Reads and writes list filters in the URL (?status=…&q=…), so filtered views can be shared and
 * survive reloads. Changing a filter drops the pagination cursor.
 */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const hrefWith = useCallback(
    (changes: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const key of PAGING) next.delete(key);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      const s = next.toString();
      return s ? `${pathname}?${s}` : pathname;
    },
    [params, pathname],
  );

  const setFilters = useCallback(
    (changes: Record<string, string | null | undefined>) => {
      startTransition(() => router.replace(hrefWith(changes), { scroll: false }));
    },
    [router, hrefWith],
  );

  return { params, pending, hrefWith, setFilters, clearHref: pathname };
}
