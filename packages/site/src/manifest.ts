import type { z } from "zod";
import type { Permission, Resource } from "@altyapi/auth";
import type { LocaleCode } from "@altyapi/commerce-core";
import type { DomainEventType } from "@altyapi/events";

/**
 * Capability module manifests (docs/platform/site-turleri-ve-cms.md §1.1). A module is a
 * feature set a site can turn on or off (content, catalog, commerce, later people, forms,
 * booking…). The manifest is the declarative contract the platform reads instead of branching
 * on the site kind or pack name: which permission resources, routes, templates, settings,
 * events and admin navigation the module brings. Manifests are pure data; the module's server
 * code lives in its own package.
 */

/** Admin-facing text. Turkish is the primary admin language; English is always provided. */
export type LocalizedLabel = { tr: string; en: string } & Partial<Record<LocaleCode, string>>;

/**
 * public: identical for every visitor, cached at the edge under the store content version.
 * private: per visitor (cart, checkout, portal); never cached by the edge.
 */
export type RouteCacheClass = "public" | "private";

/**
 * What kind of page a route renders. The tracking layer and the compliance policy scope by it:
 * marketing scripts never load on booking, intake and portal pages, and rule packs can target
 * a single class (e.g. prices only on checkout pages).
 */
export const PAGE_CLASSES = ["marketing", "service", "booking", "intake", "portal", "checkout", "legal"] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];

/** A storefront route with a fixed path owned by a module. */
export interface ModuleRouteDef {
  /** Unique across the registry: "<module>.<name>". */
  id: string;
  /** Path the route owns, without the locale segment: "/" or "/segment[/segment…]". */
  path: string;
  /** Per-language paths for languages that do not use `path` ({ tr: "/hizmetler", en: "/services" }). */
  localizedPaths?: Partial<Record<LocaleCode, string>>;
  /** exact: only the path itself; prefix: the path and every path below it. */
  match: "exact" | "prefix";
  cacheClass: RouteCacheClass;
  pageClass: PageClass;
}

/**
 * Routes whose prefixes are merchant data rather than code. content_types: each content type
 * with a route prefix serves /{prefix} (index) and /{prefix}/{slug} (entry), per language.
 */
export interface ModuleDynamicRoutes {
  source: "content_types";
  cacheClass: RouteCacheClass;
  pageClass: PageClass;
}

/**
 * A template page layout the module renders its records with (pages.type = 'template',
 * pages.template_key = key). A `{type}` segment stands for a content type key, so
 * "entries.{type}.detail" covers "entries.post.detail", "entries.service.detail", ….
 * Sections allowed in a template declare the placement "tpl:<key>".
 */
export interface ModuleTemplateDef {
  key: string;
  pageClass: PageClass;
}

/** An entry of the merchant admin navigation, shown only to principals holding `permission`. */
export interface ModuleAdminNavItem {
  /** Unique across the registry. */
  key: string;
  label: LocalizedLabel;
  /** Admin app path. */
  path: string;
  permission: Permission;
  /** Ascending sort position within the navigation. */
  order: number;
}

export interface ModuleManifest {
  /** site_modules.module_key; same format as the database check (^[a-z][a-z0-9_-]{0,63}$). */
  key: string;
  /** Semantic version of the manifest. */
  version: string;
  label: LocalizedLabel;
  description: LocalizedLabel;
  /** The site core: always active, never stored in site_modules and never switchable. */
  alwaysOn?: boolean;
  /** Modules that must be active for this one to be enabled (and to count as active). */
  dependsOn: readonly string[];
  /**
   * Permission resources the module owns. While the module is off for a store, assertCan
   * refuses every permission on them. Every resource belongs to exactly one module.
   */
  resources: readonly Resource[];
  routes: readonly ModuleRouteDef[];
  dynamicRoutes?: readonly ModuleDynamicRoutes[];
  templates: readonly ModuleTemplateDef[];
  /**
   * Schema of site_modules.settings. Parsing an empty object must succeed so a module can be
   * enabled without settings; defaults fill in whatever the merchant did not choose.
   */
  settings: z.ZodType<Record<string, unknown>>;
  /** Outbox event types the module emits. An event type belongs to at most one module. */
  events: readonly DomainEventType[];
  adminNav: readonly ModuleAdminNavItem[];
}

/** Placement key under which sections are allowed in a template ("tpl:entries.post.detail"). */
export function templatePlacement(templateKey: string): `tpl:${string}` {
  return `tpl:${templateKey}`;
}

/** Identity helper that keeps literal keys, so the registry can derive a key union. */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
