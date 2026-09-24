import { forbidden } from "@altyapi/commerce-core";
import { grantsAllow, type Permission, type RoleGrant } from "@altyapi/auth";

export type PrincipalKind = "user" | "agent" | "api_client" | "system";

/**
 * The authenticated actor. Agents carry the grants of the human they act for, further
 * narrowed by the scopes granted to the agent (intersection, never union).
 */
export interface Principal {
  kind: PrincipalKind;
  userId: string | null;
  agentId: string | null;
  sessionId: string | null;
  grants: RoleGrant[];
  /** When present, permissions are limited to this set (agent/API-client scopes). */
  scopeLimit?: ReadonlySet<Permission>;
}

export interface OrganizationContext {
  organizationId: string;
  principal: Principal;
}

export interface StoreSnapshot {
  id: string;
  slug: string;
  name: string;
  status: string;
  defaultLocale: string;
  supportedLocales: string[];
  defaultCurrency: string;
  supportedCurrencies: string[];
  timezone: string;
  countryCode: string;
  routingVersion: number;
  contentVersion: number;
}

/** Required by every tenant-data service function. There is no store-less data access path. */
export interface StoreContext extends OrganizationContext {
  storeId: string;
  store: StoreSnapshot;
}

export function can(ctx: OrganizationContext, permission: Permission, storeId?: string): boolean {
  if (ctx.principal.kind === "system") return true;
  if (ctx.principal.scopeLimit && !ctx.principal.scopeLimit.has(permission)) return false;
  return grantsAllow(ctx.principal.grants, permission, storeId);
}

export function assertCan(ctx: OrganizationContext | StoreContext, permission: Permission): void {
  const storeId = "storeId" in ctx ? ctx.storeId : undefined;
  if (!can(ctx, permission, storeId)) throw forbidden(permission);
}

export function tenantScope(ctx: StoreContext) {
  return { organizationId: ctx.organizationId, storeId: ctx.storeId };
}

export function systemPrincipal(): Principal {
  return { kind: "system", userId: null, agentId: null, sessionId: null, grants: [] };
}
