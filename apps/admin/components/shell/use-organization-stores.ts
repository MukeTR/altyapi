"use client";

import { useEffect, useState } from "react";
import { bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { ApiError } from "@/lib/api/errors";
import type { ItemList, OrganizationSummary, Store } from "@/lib/api/types";

export type OrgStores = { status: "loading" } | { status: "ready"; stores: Store[] } | { status: "error"; error: ApiErrorInfo };

// Stores of other organizations, fetched once per page load and shared by the switcher and the palette.
const cache = new Map<string, Promise<Store[]>>();

function fetchStores(organizationId: string): Promise<Store[]> {
  let pending = cache.get(organizationId);
  if (!pending) {
    pending = bff<ItemList<Store>>(`/v1/organizations/${organizationId}/stores`).then((r) => r.items);
    pending.catch(() => cache.delete(organizationId));
    cache.set(organizationId, pending);
  }
  return pending;
}

/**
 * Stores per organization for the switcher and the palette. The current organization's stores
 * come from the server-loaded context; the others load when `enabled` first becomes true.
 */
export function useOrganizationStores(organizations: readonly OrganizationSummary[], current: { organizationId: string; stores: Store[] }, enabled: boolean) {
  const [state, setState] = useState<Record<string, OrgStores>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    for (const org of organizations) {
      if (org.id === current.organizationId) continue;
      setState((s) => (s[org.id]?.status === "ready" ? s : { ...s, [org.id]: { status: "loading" } }));
      fetchStores(org.id).then(
        (stores) => !cancelled && setState((s) => ({ ...s, [org.id]: { status: "ready", stores } })),
        (err: unknown) =>
          !cancelled &&
          setState((s) => ({
            ...s,
            [org.id]: { status: "error", error: err instanceof ApiError ? err.toInfo() : { status: 0, code: "network", messageKey: "errors.network", correlationId: null } },
          })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, organizations, current.organizationId, attempt]);

  const get = (organizationId: string): OrgStores =>
    organizationId === current.organizationId ? { status: "ready", stores: current.stores } : (state[organizationId] ?? { status: "loading" });

  return { get, retry: () => setAttempt((a) => a + 1) };
}

/** Keeps the current section when switching stores ("/orders/123" → the other store's "/orders"). */
export function sectionPath(pathname: string, basePath: string): string {
  if (!pathname.startsWith(basePath)) return "";
  const first = pathname.slice(basePath.length).split("/").filter(Boolean)[0];
  return first ? `/${first}` : "";
}
