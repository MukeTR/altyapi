import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { StoreContextValue } from "@/components/providers/store-provider";
import { load } from "@/lib/api/load";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList, Me, PermissionsResponse, Store } from "@/lib/api/types";
import { serverEnv, storefrontOrigin } from "@/lib/env";

/** Per-request cached account and tenancy reads shared by layouts and pages. */
export const getMe = cache(() => load<Me>("/v1/me"));

export const listStores = cache((organizationId: string) => load<ItemList<Store>>(`/v1/organizations/${organizationId}/stores`));

export const getPermissions = cache((organizationId: string, storeId?: string) =>
  load<PermissionsResponse>(`/v1/organizations/${organizationId}/permissions`, { query: { storeId } }),
);

interface DomainRow {
  hostname: string;
  status: string;
  isCanonical: boolean;
}

/** Canonical active domain if the user can read domains; otherwise the platform subdomain. */
async function storefrontUrlFor(apiBase: string, store: Store, permissions: readonly string[]): Promise<string> {
  const platform = storefrontOrigin(`${store.slug}.${serverEnv.storeRootDomain()}`);
  if (!permissions.includes("domains:read")) return platform;
  const domains = await load<ItemList<DomainRow>>(`${apiBase}/domains`);
  if (!domains.ok) return platform;
  const canonical = domains.data.items.find((d) => d.isCanonical && d.status === "active");
  return canonical ? storefrontOrigin(canonical.hostname) : platform;
}

/**
 * Resolves /o/[org]/[store] slugs for the signed-in user. Unknown slugs (or ones the user
 * cannot access) render not-found, exactly like the API does for foreign organization ids.
 */
export const getStoreContext = cache(async (orgSlug: string, storeSlug: string): Promise<ApiResult<StoreContextValue>> => {
  const me = await getMe();
  if (!me.ok) return me;
  const organization = me.data.organizations.find((o) => o.slug === orgSlug);
  if (!organization) notFound();
  const stores = await listStores(organization.id);
  if (!stores.ok) return stores;
  const store = stores.data.items.find((s) => s.slug === storeSlug);
  if (!store) notFound();
  const [perms, orgPerms] = await Promise.all([getPermissions(organization.id, store.id), getPermissions(organization.id)]);
  if (!perms.ok) return perms;
  if (!orgPerms.ok) return orgPerms;
  const apiBase = `/v1/organizations/${organization.id}/stores/${store.id}`;
  return {
    ok: true,
    data: {
      user: me.data.user,
      organizations: me.data.organizations,
      organization,
      stores: stores.data.items,
      store,
      grants: perms.data.grants,
      permissions: perms.data.permissions,
      organizationPermissions: orgPerms.data.permissions,
      basePath: `/o/${organization.slug}/${store.slug}`,
      apiBase,
      storefrontUrl: await storefrontUrlFor(apiBase, store, perms.data.permissions),
    },
  };
});

/**
 * For pages under a store route: the layout has already validated the context, so a failure
 * here only happens on a race (e.g. access revoked mid-request) and is thrown to error.tsx.
 */
export async function requireStoreContext(params: Promise<{ org: string; store: string }>): Promise<StoreContextValue> {
  const { org, store } = await params;
  const ctx = await getStoreContext(org, store);
  if (!ctx.ok) throw new Error(`store context failed: ${ctx.error.code}`);
  return ctx.data;
}
