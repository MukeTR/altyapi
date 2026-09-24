export const RESOURCES = [
  "organization",
  "members",
  "store",
  "settings",
  "catalog",
  "inventory",
  "pricing",
  "orders",
  "customers",
  "campaigns",
  "marketing",
  "storefront",
  "content",
  "media",
  "domains",
  "payments",
  "analytics",
  "karmatik",
  "yanit",
  "ai_actions",
  "developer",
  "audit",
  /** Pixels, analytics and consent: a protected layer, never editable through design tools. */
  "tracking",
  /** Connections to integrators, marketplaces and feeds (credentials, sync, data ownership). */
  "integrations",
] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = "read" | "write" | "publish" | "refund" | "manage" | "approve";
export type Permission = `${Resource}:${Action}`;

export const ROLES = [
  "organization_owner",
  "store_admin",
  "catalog_manager",
  "order_manager",
  "marketing_manager",
  "analyst",
  "developer",
] as const;

export type Role = (typeof ROLES)[number];

const ALL: readonly Permission[] = RESOURCES.flatMap((r) =>
  (["read", "write", "publish", "refund", "manage", "approve"] as const).map((a) => `${r}:${a}` as Permission),
);

const read = (...resources: Resource[]): Permission[] => resources.map((r) => `${r}:read` as Permission);
const write = (...resources: Resource[]): Permission[] =>
  resources.flatMap((r) => [`${r}:read`, `${r}:write`] as Permission[]);

/**
 * Role → permission matrix. organization_owner is the only role that can manage the
 * organization itself; store-scoped roles can be limited to individual stores.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  organization_owner: new Set(ALL),
  store_admin: new Set(ALL.filter((p) => !p.startsWith("organization:"))),
  catalog_manager: new Set<Permission>([
    ...read("store", "storefront", "analytics", "karmatik", "ai_actions", "integrations"),
    ...write("catalog", "inventory", "pricing", "content", "media"),
    "ai_actions:write",
  ]),
  order_manager: new Set<Permission>([
    ...read("store", "catalog", "analytics", "ai_actions", "integrations"),
    ...write("orders", "customers", "inventory"),
    "orders:refund",
    "ai_actions:write",
  ]),
  marketing_manager: new Set<Permission>([
    ...read("store", "catalog", "customers", "analytics", "karmatik", "yanit", "ai_actions", "tracking"),
    ...write("campaigns", "marketing", "content", "storefront", "media"),
    "tracking:manage",
    "storefront:publish",
    "content:publish",
    "campaigns:publish",
    "ai_actions:write",
  ]),
  analyst: new Set<Permission>(
    read("store", "catalog", "inventory", "pricing", "orders", "customers", "campaigns", "marketing", "analytics", "karmatik", "yanit", "storefront", "content", "ai_actions", "integrations"),
  ),
  developer: new Set<Permission>([
    ...read("store", "catalog", "orders", "storefront", "audit", "ai_actions", "settings", "integrations"),
    "developer:read",
    "developer:write",
    "developer:manage",
  ]),
};

export interface RoleGrant {
  role: Role;
  /** null = every store in the organization */
  storeId: string | null;
}

/** Returns true if any grant gives the permission for the given store (or org-wide when storeId is undefined). */
export function grantsAllow(grants: readonly RoleGrant[], permission: Permission, storeId?: string): boolean {
  return grants.some(
    (g) =>
      ROLE_PERMISSIONS[g.role].has(permission) &&
      (g.storeId === null || (storeId !== undefined && g.storeId === storeId)),
  );
}

export function effectivePermissions(grants: readonly RoleGrant[], storeId?: string): Permission[] {
  const out = new Set<Permission>();
  for (const g of grants) {
    if (g.storeId === null || (storeId !== undefined && g.storeId === storeId)) {
      for (const p of ROLE_PERMISSIONS[g.role]) out.add(p);
    }
  }
  return [...out].sort();
}
