"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OrganizationSummary, RoleGrant, Store, User } from "@/lib/api/types";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";

/** The signed-in user, the current organization and store, and the user's permissions for it. */
export interface StoreContextValue {
  user: User;
  organizations: OrganizationSummary[];
  organization: OrganizationSummary;
  /** Stores of the current organization the user can access. */
  stores: Store[];
  store: Store;
  grants: RoleGrant[];
  /** Effective permissions for the current store. */
  permissions: string[];
  /** Organization-wide permissions (org-level actions such as creating a store need these). */
  organizationPermissions: string[];
  /** Admin URL prefix of the store: /o/<org>/<store>. */
  basePath: string;
  /** API path prefix of the store: /v1/organizations/<id>/stores/<id>. */
  apiBase: string;
  /** Public storefront URL (canonical domain when one is active). */
  storefrontUrl: string;
}

interface StoreContextApi extends StoreContextValue {
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
}

const StoreContext = createContext<StoreContextApi | null>(null);

export function StoreProvider({ value, children }: { value: StoreContextValue; children: ReactNode }) {
  const api = useMemo<StoreContextApi>(
    () => ({
      ...value,
      can: (p) => hasPermission(value.permissions, p),
      canAny: (ps) => hasAnyPermission(value.permissions, ps),
    }),
    [value],
  );
  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextApi {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside a store route (/o/[org]/[store])");
  return value;
}

/** Store context when rendered inside a store route, otherwise null (auth and onboarding pages). */
export function useOptionalStore(): StoreContextApi | null {
  return useContext(StoreContext);
}
