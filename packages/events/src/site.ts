import type { siteModuleStatus } from "@altyapi/database";

/**
 * Site core events (docs/platform/site-turleri-ve-cms.md §1, K3, K6). Every change bumps the
 * store content version (and the modules version where the route table or module gates can
 * change) in the same transaction; contentVersion / modulesVersion are the values after it.
 * Payloads carry identifiers and field names only: identity values such as tax numbers never
 * leave the database through the outbox.
 */
export interface SiteEventMap {
  /** The site profile changed (kind, URL style, language or crawler policy, verification tags). */
  "site.profile_changed": { fields: string[]; modulesVersion: number; contentVersion: number };
  /** A capability module was turned on or off, or its settings changed. */
  "site.modules_changed": {
    moduleKey: string;
    change: "enabled" | "disabled" | "settings";
    status: (typeof siteModuleStatus.enumValues)[number];
    /** Active module keys after the change (always-on modules included). */
    activeModules: string[];
    modulesVersion: number;
    contentVersion: number;
  };
  /** The business identity (imprint, contact facts, logo, identifiers) changed. */
  "site.identity_changed": { fields: string[]; contentVersion: number };
  /** A location was created, changed or removed; primaryLocationId is the primary one after it. */
  "site.locations_changed": {
    locationId: string;
    change: "created" | "updated" | "deleted";
    primaryLocationId: string | null;
    contentVersion: number;
  };
}

// Site events are part of the domain event catalog: appendEvent, handlers and the publisher
// accept them like the events declared in catalog.ts.
declare module "./catalog" {
  interface DomainEventMap extends SiteEventMap {}
}
