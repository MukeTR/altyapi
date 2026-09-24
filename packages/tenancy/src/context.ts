import { AppError, forbidden } from "@altyapi/commerce-core";
import { grantsAllow, type Permission, type RoleGrant } from "@altyapi/auth";
import { SITE_MODULES, type ModuleKey } from "@altyapi/site";

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
  /**
   * Active capability modules (enabled or locked_on, dependencies satisfied, the always-on
   * core included), in dependency order. Loaded with the store row.
   */
  modules: ModuleKey[];
  /** Bumped on every module or site profile change; caches of module-derived state key on it. */
  modulesVersion: number;
  /** Bumped when the compiled site policy changes; policy-derived caches key on it. */
  policyVersion: number;
}

/** Required by every tenant-data service function. There is no store-less data access path. */
export interface StoreContext extends OrganizationContext {
  storeId: string;
  store: StoreSnapshot;
}

/*
 * Feature gates (docs/platform/site-turleri-ve-cms.md §1). A feature runs only when all four
 * gates are open, checked in this order, the policy last:
 *
 *   1. Platform flag: the module is registered in the platform module registry
 *      (SITE_MODULES). A module without a manifest has no key a store can turn on.
 *   2. Plan entitlement: NOT WIRED YET. Plans and entitlements do not exist; when they do,
 *      they are checked here and in enableModule, before the module status.
 *   3. Module status: site_modules.status is enabled or locked_on (StoreSnapshot.modules),
 *      checked by assertModule, and by assertCan for permissions on a module's resources.
 *   4. Site policy snapshot: NOT WIRED YET. Compiled policy snapshots (site_policy_snapshots,
 *      packages/compliance) arrive with the compliance core; StoreSnapshot.policyVersion is
 *      already carried so policy-derived caches can key on it.
 */

/**
 * The module that must be active for a permission to be usable in this context, or null
 * when nothing blocks it. Only store contexts carry modules; organization-level checks
 * (members, creating stores) are not module-gated.
 */
function blockingModule(ctx: OrganizationContext | StoreContext, permission: Permission, storeId?: string): ModuleKey | null {
  if (!("store" in ctx) || (storeId !== undefined && storeId !== ctx.storeId)) return null;
  const owner = SITE_MODULES.ownerOfPermission(permission);
  return ctx.store.modules.includes(owner) ? null : owner;
}

function principalAllows(ctx: OrganizationContext, permission: Permission, storeId?: string): boolean {
  if (ctx.principal.scopeLimit && !ctx.principal.scopeLimit.has(permission)) return false;
  return grantsAllow(ctx.principal.grants, permission, storeId);
}

/**
 * True when the principal holds the permission and, in a store context, the module owning
 * the permission's resource is active. System code paths (platform maintenance, payment
 * callbacks for existing orders) are trusted and pass both checks.
 */
export function can(ctx: OrganizationContext, permission: Permission, storeId?: string): boolean {
  if (ctx.principal.kind === "system") return true;
  return principalAllows(ctx, permission, storeId) && blockingModule(ctx, permission, storeId) === null;
}

/** The error for a feature whose module is off: 403 with a key the admin can turn into "enable X". */
export function moduleDisabled(module: ModuleKey, permission?: Permission): AppError {
  return new AppError("forbidden", "errors.site.module.disabled", permission ? { module, permission } : { module });
}

export function assertCan(ctx: OrganizationContext | StoreContext, permission: Permission): void {
  if (ctx.principal.kind === "system") return;
  const storeId = "storeId" in ctx ? ctx.storeId : undefined;
  if (!principalAllows(ctx, permission, storeId)) throw forbidden(permission);
  const blocked = blockingModule(ctx, permission, storeId);
  if (blocked) throw moduleDisabled(blocked, permission);
}

/** True when the module is active for the store (gate 3). */
export function moduleActive(ctx: StoreContext, module: ModuleKey): boolean {
  return ctx.store.modules.includes(module);
}

/**
 * Module gate for features whose permission resource the module does not own (content
 * entries share content:* with pages, which are core). Applies to every principal: it
 * answers whether the store has the feature, not who may use it.
 */
export function assertModule(ctx: StoreContext, module: ModuleKey): void {
  if (!moduleActive(ctx, module)) throw moduleDisabled(module);
}

export function tenantScope(ctx: StoreContext) {
  return { organizationId: ctx.organizationId, storeId: ctx.storeId };
}

export function systemPrincipal(): Principal {
  return { kind: "system", userId: null, agentId: null, sessionId: null, grants: [] };
}
