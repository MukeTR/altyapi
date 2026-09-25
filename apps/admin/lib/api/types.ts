/**
 * Response shapes of the account and tenancy endpoints. API responses may carry fields that are
 * not listed here (the API adds fields without a version bump), so code must not assume these
 * types are exhaustive.
 */
import type { Permission, Role } from "@/lib/permissions";

export interface User {
  id: string;
  email: string;
  name: string;
  locale: string;
  emailVerifiedAt: string | null;
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

export interface Me {
  user: User;
  organizations: OrganizationSummary[];
}

export type StoreStatus = "setup" | "active" | "paused" | "closed";

export interface Store {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus | (string & {});
  defaultLocale: string;
  supportedLocales: string[];
  defaultCurrency: string;
  supportedCurrencies: string[];
  timezone: string;
  countryCode: string;
  routingVersion: number;
  contentVersion: number;
  /** Active capability modules (core included); screens of an inactive module are hidden. */
  modules?: string[];
}

export interface RoleGrant {
  role: Role;
  /** null = every store in the organization. */
  storeId: string | null;
}

export interface PermissionsResponse {
  grants: RoleGrant[];
  permissions: Permission[];
}

export interface SessionResponse {
  user: User;
  expiresAt: string;
}

/** Keyset pagination (products, orders). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Offset pagination (Kârmatik and Yanıt lists). */
export interface OffsetPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ItemList<T> {
  items: T[];
}
