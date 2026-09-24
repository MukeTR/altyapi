import { RESOURCES, type Permission, type Resource } from "@altyapi/auth";
import { invalid, isLocaleCode } from "@altyapi/commerce-core";
import { PAGE_CLASSES, type ModuleManifest, type ModuleRouteDef, type ModuleTemplateDef } from "./manifest";
import type { SiteModuleStatus } from "./types";

/** Same format as the site_modules_key_format database check. */
const MODULE_KEY_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** "/" or lower-case slug segments: "/products", "/calisma-alanlari/kategori". */
const ROUTE_PATH_RE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
/** Dotted segments, each a key or the {type} placeholder: "entries.{type}.detail". */
const TEMPLATE_KEY_RE = /^[a-z][a-z0-9_]*(?:\.(?:\{type\}|[a-z][a-z0-9_]*))+$/;
/** What a {type} placeholder matches: a content type key (content_types_key_format). */
const TYPE_SEGMENT_RE = "[a-z][a-z0-9_]{0,47}";

/** Statuses that turn a module on (the merchant's choice or a pack/policy lock). */
export const ACTIVE_MODULE_STATUSES: readonly SiteModuleStatus[] = ["enabled", "locked_on"];

export function isActiveStatus(status: SiteModuleStatus): boolean {
  return status === "enabled" || status === "locked_on";
}

/** Thrown at boot when the manifests do not form a valid registry; lists every problem. */
export class ModuleRegistryError extends Error {
  override name = "ModuleRegistryError";
  constructor(readonly problems: readonly string[]) {
    super(`Invalid site module registry:\n- ${problems.join("\n- ")}`);
  }
}

export interface RegisteredRoute extends ModuleRouteDef {
  module: string;
}

export interface RegisteredTemplate extends ModuleTemplateDef {
  module: string;
}

/** A stored module row as far as the registry is concerned. */
export interface ModuleState {
  moduleKey: string;
  status: SiteModuleStatus;
}

/**
 * The validated set of capability modules. Construction fails (ModuleRegistryError) unless:
 * keys and versions are well formed and unique; every dependency has a manifest and the
 * dependency graph is acyclic; always-on modules depend only on always-on modules; every
 * permission resource of the platform is owned by exactly one module (a resource without an
 * owner is a missing manifest); route ids, route paths, template keys, admin nav keys and event
 * types are claimed at most once; and every settings schema accepts an empty object.
 *
 * `list()` returns manifests in dependency order (dependencies first).
 */
export class ModuleRegistry<K extends string = string> {
  private readonly byKey: ReadonlyMap<string, ModuleManifest>;
  private readonly ordered: readonly ModuleManifest[];
  private readonly resourceOwner: ReadonlyMap<Resource, K>;
  private readonly dependentsOf: ReadonlyMap<string, readonly K[]>;
  private readonly routeList: readonly RegisteredRoute[];
  private readonly templateList: readonly (RegisteredTemplate & { pattern: RegExp })[];

  constructor(manifests: readonly ModuleManifest[]) {
    const problems: string[] = [];
    const byKey = new Map<string, ModuleManifest>();
    for (const m of manifests) {
      if (!MODULE_KEY_RE.test(m.key)) problems.push(`module key "${m.key}" does not match ${MODULE_KEY_RE}`);
      if (!SEMVER_RE.test(m.version)) problems.push(`module "${m.key}": version "${m.version}" is not semver`);
      if (byKey.has(m.key)) problems.push(`duplicate module key "${m.key}"`);
      else byKey.set(m.key, m);
    }

    // Dependencies: known, not self, always-on only on always-on, acyclic.
    for (const m of byKey.values()) {
      for (const dep of new Set(m.dependsOn)) {
        const target = byKey.get(dep);
        if (dep === m.key) problems.push(`module "${m.key}" depends on itself`);
        else if (!target) problems.push(`module "${m.key}" depends on "${dep}", which has no manifest`);
        else if (m.alwaysOn && !target.alwaysOn) problems.push(`always-on module "${m.key}" depends on switchable module "${dep}"`);
      }
      if (m.dependsOn.length !== new Set(m.dependsOn).size) problems.push(`module "${m.key}" lists a dependency twice`);
    }
    const ordered: ModuleManifest[] = [];
    const state = new Map<string, "visiting" | "done">();
    const visit = (m: ModuleManifest, path: string[]) => {
      const s = state.get(m.key);
      if (s === "done") return;
      if (s === "visiting") {
        problems.push(`dependency cycle: ${[...path.slice(path.indexOf(m.key)), m.key].join(" -> ")}`);
        return;
      }
      state.set(m.key, "visiting");
      for (const dep of m.dependsOn) {
        const target = byKey.get(dep);
        if (target && dep !== m.key) visit(target, [...path, m.key]);
      }
      state.set(m.key, "done");
      ordered.push(m);
    };
    for (const m of byKey.values()) visit(m, []);

    // Permission resources: each owned by exactly one module, every platform resource owned.
    const resourceOwner = new Map<Resource, K>();
    for (const m of byKey.values()) {
      for (const r of m.resources) {
        if (!(RESOURCES as readonly string[]).includes(r)) problems.push(`module "${m.key}" owns unknown resource "${r}"`);
        const owner = resourceOwner.get(r);
        if (owner) problems.push(`resource "${r}" is owned by both "${owner}" and "${m.key}"`);
        else resourceOwner.set(r, m.key as K);
      }
    }
    for (const r of RESOURCES) {
      if (!resourceOwner.has(r)) problems.push(`permission resource "${r}" has no owning module manifest`);
    }

    // Routes: unique ids, well-formed paths, one owner per path (per language).
    const routeList: RegisteredRoute[] = [];
    const routeIds = new Set<string>();
    const pathOwner = new Map<string, string>();
    const claimPath = (routeId: string, locale: string, path: string) => {
      if (!ROUTE_PATH_RE.test(path)) {
        problems.push(`route "${routeId}": path "${path}" (${locale}) is not a lower-case slug path`);
        return;
      }
      const slot = `${locale}:${path}`;
      const owner = pathOwner.get(slot);
      if (owner && owner !== routeId) problems.push(`route path "${path}" (${locale}) is claimed by both "${owner}" and "${routeId}"`);
      else pathOwner.set(slot, routeId);
    };
    for (const m of byKey.values()) {
      for (const route of m.routes) {
        if (!route.id.startsWith(`${m.key}.`)) problems.push(`route "${route.id}" of module "${m.key}" must be named "${m.key}.<name>"`);
        if (routeIds.has(route.id)) problems.push(`duplicate route id "${route.id}"`);
        routeIds.add(route.id);
        if (!(PAGE_CLASSES as readonly string[]).includes(route.pageClass)) problems.push(`route "${route.id}": unknown page class "${route.pageClass}"`);
        claimPath(route.id, "*", route.path);
        for (const [locale, path] of Object.entries(route.localizedPaths ?? {})) {
          if (!isLocaleCode(locale)) problems.push(`route "${route.id}": unknown locale "${locale}"`);
          else if (path) claimPath(route.id, locale, path);
        }
        routeList.push({ ...route, module: m.key });
      }
    }

    // Templates: well-formed, unique keys.
    const templateList: (RegisteredTemplate & { pattern: RegExp })[] = [];
    const templateOwner = new Map<string, string>();
    for (const m of byKey.values()) {
      for (const t of m.templates) {
        if (!TEMPLATE_KEY_RE.test(t.key)) problems.push(`template "${t.key}" of module "${m.key}" is not a dotted key`);
        const owner = templateOwner.get(t.key);
        if (owner) problems.push(`template "${t.key}" is claimed by both "${owner}" and "${m.key}"`);
        else templateOwner.set(t.key, m.key);
        const pattern = new RegExp(`^${t.key.split(".").map((s) => (s === "{type}" ? TYPE_SEGMENT_RE : s)).join("\\.")}$`);
        templateList.push({ ...t, module: m.key, pattern });
      }
    }

    // Admin nav keys and event types: one owner each.
    const navOwner = new Map<string, string>();
    const eventOwner = new Map<string, string>();
    for (const m of byKey.values()) {
      for (const item of m.adminNav) {
        const owner = navOwner.get(item.key);
        if (owner) problems.push(`admin nav key "${item.key}" is claimed by both "${owner}" and "${m.key}"`);
        else navOwner.set(item.key, m.key);
      }
      for (const event of m.events) {
        const owner = eventOwner.get(event);
        if (owner) problems.push(`event "${event}" is claimed by both "${owner}" and "${m.key}"`);
        else eventOwner.set(event, m.key);
      }
      const defaults = m.settings.safeParse({});
      if (!defaults.success) problems.push(`module "${m.key}": settings schema rejects an empty object (${defaults.error.message})`);
    }

    if (problems.length) throw new ModuleRegistryError(problems);

    const dependentsOf = new Map<string, K[]>();
    for (const m of ordered) {
      for (const dep of m.dependsOn) dependentsOf.set(dep, [...(dependentsOf.get(dep) ?? []), m.key as K]);
    }
    this.byKey = byKey;
    this.ordered = ordered;
    this.resourceOwner = resourceOwner;
    this.dependentsOf = dependentsOf;
    this.routeList = routeList;
    this.templateList = templateList;
  }

  /** Manifests in dependency order (dependencies first). */
  list(): readonly ModuleManifest[] {
    return this.ordered;
  }

  keys(): K[] {
    return this.ordered.map((m) => m.key as K);
  }

  has(key: string): key is K {
    return this.byKey.has(key);
  }

  get(key: string): ModuleManifest | undefined {
    return this.byKey.get(key);
  }

  /** Modules that are always active (the site core). */
  alwaysOnKeys(): K[] {
    return this.ordered.filter((m) => m.alwaysOn).map((m) => m.key as K);
  }

  isAlwaysOn(key: string): boolean {
    return this.byKey.get(key)?.alwaysOn === true;
  }

  /** Direct dependents: modules that list `key` in dependsOn. */
  dependents(key: string): readonly K[] {
    return this.dependentsOf.get(key) ?? [];
  }

  /** The module owning a permission resource. Total: every resource has an owner. */
  ownerOfResource(resource: Resource): K {
    return this.resourceOwner.get(resource)!;
  }

  /** The module owning the resource of a permission ("orders:write" → "commerce"). */
  ownerOfPermission(permission: Permission): K {
    return this.ownerOfResource(permission.slice(0, permission.indexOf(":")) as Resource);
  }

  /**
   * Modules that count as active for a store, in dependency order: always-on modules plus
   * rows whose status is enabled or locked_on. Fails closed on inconsistent data: rows without
   * a manifest are ignored and a module whose dependency is inactive is inactive too.
   */
  activeKeys(states: Iterable<ModuleState>): K[] {
    const on = new Set<string>(this.alwaysOnKeys());
    for (const s of states) if (isActiveStatus(s.status) && this.byKey.has(s.moduleKey)) on.add(s.moduleKey);
    // Dependencies come first in `ordered`, so one pass settles the whole chain.
    for (const m of this.ordered) {
      if (on.has(m.key) && m.dependsOn.some((d) => !on.has(d))) on.delete(m.key);
    }
    return this.ordered.filter((m) => on.has(m.key)).map((m) => m.key as K);
  }

  /** Every fixed-path route of every module, with its owning module. */
  routes(): readonly RegisteredRoute[] {
    return this.routeList;
  }

  /** The module template a concrete template key belongs to ("entries.post.detail"), if any. */
  templateFor(templateKey: string): RegisteredTemplate | null {
    const hit = this.templateList.find((t) => t.pattern.test(templateKey));
    if (!hit) return null;
    const { pattern: _pattern, ...template } = hit;
    void _pattern;
    return template;
  }

  /**
   * Validates module settings against the manifest schema and fills in defaults. Refused
   * settings raise errors.site.module.invalid_settings with the schema issues.
   */
  parseSettings(key: K, raw: unknown): Record<string, unknown> {
    const manifest = this.byKey.get(key)!;
    const parsed = manifest.settings.safeParse(raw ?? {});
    if (!parsed.success) {
      throw invalid("errors.site.module.invalid_settings", {
        module: key,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return parsed.data;
  }
}
