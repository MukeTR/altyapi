import type { Permission as ApiPermission, Role as ApiRole } from "@altyapi/auth";

/**
 * Permission strings (`<resource>:<action>`) and roles as defined by the API. The effective set
 * for a store comes from GET /v1/organizations/:id/permissions?storeId= and is only used to hide
 * what the user cannot do; the API enforces every permission itself.
 */
export type Permission = ApiPermission;
export type Role = ApiRole;

export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}

/** True when any of the permissions is granted (an empty list means "no requirement"). */
export function hasAnyPermission(granted: readonly string[], permissions: readonly Permission[]): boolean {
  return permissions.length === 0 || permissions.some((p) => granted.includes(p));
}
