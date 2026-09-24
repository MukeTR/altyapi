import { isDeepStrictEqual } from "node:util";
import { conflict, notFound } from "@altyapi/commerce-core";
import { eq, siteModules, withTenantTx, type Database, type DbExecutor, type Transaction } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import {
  SITE_MODULES,
  isActiveStatus,
  type LocalizedLabel,
  type ModuleKey,
  type SiteModuleSource,
  type SiteModuleStatus,
} from "@altyapi/site";
import { assertCan, tenantScope, type StoreContext } from "../context";
import { bumpStoreVersions, lockSiteProfile } from "./shared";

type SiteModuleRow = typeof siteModules.$inferSelect;

export interface SiteModuleView {
  key: ModuleKey;
  version: string;
  label: LocalizedLabel;
  description: LocalizedLabel;
  /** Stored status; locked_on for always-on modules, disabled when the store has no row. */
  status: SiteModuleStatus;
  /** Counts for the feature gates: status is on and every dependency is active. */
  active: boolean;
  alwaysOn: boolean;
  /** Who set the status last; null for always-on modules and modules never switched. */
  source: SiteModuleSource | null;
  /** Settings with defaults filled in (the stored value when it no longer matches the schema). */
  settings: Record<string, unknown>;
  /** False when the stored settings do not match the current manifest schema. */
  settingsValid: boolean;
  dependsOn: ModuleKey[];
  /** Modules that depend on this one. */
  dependents: ModuleKey[];
  updatedAt: Date | null;
}

/** The store a module hook runs for, with the modules a change turned on. */
export interface SiteModuleHookTarget {
  organizationId: string;
  storeId: string;
  /** Modules that became active with this change. */
  activated: ModuleKey[];
  /** Every active module after the change (core included). */
  activeModules: ModuleKey[];
}

/**
 * Callbacks the caller injects (tenancy sits below the storefront engine and cannot call it):
 * the API passes theme-engine's modulePageHooks, so a module turned on after the site was set
 * up gets the pages its routes render with, in the same transaction.
 */
export interface SiteModuleHooks {
  /** Runs inside the transaction of a change that turned modules on. */
  onActivated?: (tx: Transaction, target: SiteModuleHookTarget) => Promise<void>;
}

function toViews(rows: SiteModuleRow[]): SiteModuleView[] {
  const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
  const active = new Set<string>(SITE_MODULES.activeKeys(rows));
  return SITE_MODULES.list().map((m) => {
    const row = byKey.get(m.key);
    const parsed = m.settings.safeParse(row?.settings ?? {});
    return {
      key: m.key as ModuleKey,
      version: m.version,
      label: m.label,
      description: m.description,
      status: m.alwaysOn ? "locked_on" : (row?.status ?? "disabled"),
      active: active.has(m.key),
      alwaysOn: m.alwaysOn === true,
      source: m.alwaysOn ? null : (row?.source ?? null),
      settings: parsed.success ? parsed.data : (row?.settings ?? {}),
      settingsValid: parsed.success,
      dependsOn: [...m.dependsOn] as ModuleKey[],
      dependents: [...SITE_MODULES.dependents(m.key)],
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

function loadRows(tx: DbExecutor, storeId: string): Promise<SiteModuleRow[]> {
  return tx.select().from(siteModules).where(eq(siteModules.storeId, storeId));
}

/** Every registered module with its state for the store, in dependency order. */
export async function listModules(db: Database, ctx: StoreContext): Promise<SiteModuleView[]> {
  assertCan(ctx, "site:read");
  const rows = await withTenantTx(db, tenantScope(ctx), (tx) => loadRows(tx, ctx.storeId));
  return toViews(rows);
}

interface ModuleChange {
  /** New merchant status; null keeps the status (settings-only change). */
  target: "enabled" | "disabled" | null;
  /** New settings (validated against the manifest); undefined keeps the stored settings. */
  settings?: unknown;
}

/**
 * Applies one module change under the store's site lock:
 * - the module must be registered (gate 1) and not always-on;
 * - locked_on / locked_off statuses come from packs and policy and cannot be switched here
 *   (asking for the state a lock already guarantees is a no-op);
 * - enabling needs every dependency active; disabling is refused while an active module
 *   depends on it;
 * - settings are validated by the manifest schema and kept while a module is off.
 * Gate 2 (plan entitlement) is not wired yet; see the gate notes in context.ts.
 * An effective change bumps the modules and content versions and emits site.modules_changed;
 * modules it turns on get their storefront pages through hooks.onActivated.
 */
async function changeModule(db: Database, ctx: StoreContext, key: string, change: ModuleChange, hooks?: SiteModuleHooks): Promise<SiteModuleView> {
  assertCan(ctx, "site:manage");
  if (!SITE_MODULES.has(key)) throw notFound("site_module", key);
  const manifest = SITE_MODULES.get(key)!;
  if (manifest.alwaysOn) throw conflict("errors.site.module.locked", { module: key, status: "locked_on" });

  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    const rows = await loadRows(tx, ctx.storeId);
    const row = rows.find((r) => r.moduleKey === key);
    const current: SiteModuleStatus = row?.status ?? "disabled";
    const active = SITE_MODULES.activeKeys(rows);

    let status = current;
    if (change.target === "enabled" && !isActiveStatus(current)) {
      if (current === "locked_off") throw conflict("errors.site.module.locked", { module: key, status: current });
      const missing = manifest.dependsOn.filter((d) => !active.includes(d as ModuleKey));
      if (missing.length) throw conflict("errors.site.module.dependencies_inactive", { module: key, missing });
      status = "enabled";
    } else if (change.target === "disabled" && isActiveStatus(current)) {
      if (current === "locked_on") throw conflict("errors.site.module.locked", { module: key, status: current });
      const dependents = SITE_MODULES.dependents(key).filter((d) => active.includes(d));
      if (dependents.length) throw conflict("errors.site.module.required_by", { module: key, dependents });
      status = "disabled";
    }

    const statusChanged = status !== current;
    const storedSettings = row?.settings ?? {};
    // Turning a module on re-validates what is stored and fills in defaults, so the row shows
    // the settings in effect; a schema that moved on since then asks for new settings.
    const nextSettings =
      change.settings !== undefined
        ? SITE_MODULES.parseSettings(key, change.settings)
        : statusChanged && status === "enabled"
          ? SITE_MODULES.parseSettings(key, storedSettings)
          : storedSettings;
    if (!statusChanged && isDeepStrictEqual(nextSettings, storedSettings)) return toViews(rows).find((v) => v.key === key)!;

    const source: SiteModuleSource = statusChanged ? "merchant" : (row?.source ?? "merchant");
    const [saved] = await tx
      .insert(siteModules)
      .values({ storeId: ctx.storeId, organizationId: ctx.organizationId, moduleKey: key, status, settings: nextSettings, source })
      .onConflictDoUpdate({ target: [siteModules.storeId, siteModules.moduleKey], set: { status, settings: nextSettings, source } })
      .returning();
    const nextRows = [...rows.filter((r) => r.moduleKey !== key), saved!];
    const activeAfter = SITE_MODULES.activeKeys(nextRows);
    const versions = await bumpStoreVersions(tx, ctx.storeId, { modules: true });

    const kind = statusChanged ? (status === "enabled" ? "enabled" : "disabled") : "settings";
    await appendEvent(tx, {
      type: "site.modules_changed",
      ...tenantScope(ctx),
      aggregateType: "site_module",
      aggregateId: ctx.storeId,
      payload: { moduleKey: key, change: kind, status, activeModules: activeAfter, ...versions },
    });
    await recordAudit(tx, {
      ...tenantScope(ctx),
      action: kind === "settings" ? "site.module_configured" : `site.module_${kind}`,
      resourceType: "site_module",
      resourceId: key,
      before: { status: current, settings: storedSettings },
      after: { status, settings: nextSettings },
      metadata: { activeModules: activeAfter },
    });
    const activated = activeAfter.filter((m) => !active.includes(m));
    if (activated.length) await hooks?.onActivated?.(tx, { ...tenantScope(ctx), activated, activeModules: activeAfter });
    return toViews(nextRows).find((v) => v.key === key)!;
  });
}

/** Turns a module on (site:manage), optionally with its first settings. */
export function enableModule(db: Database, ctx: StoreContext, key: string, input: { settings?: unknown } = {}, hooks?: SiteModuleHooks): Promise<SiteModuleView> {
  return changeModule(db, ctx, key, { target: "enabled", settings: input.settings }, hooks);
}

/** Turns a module off (site:manage). Its settings and data stay; enabling it again restores both. */
export function disableModule(db: Database, ctx: StoreContext, key: string): Promise<SiteModuleView> {
  return changeModule(db, ctx, key, { target: "disabled" });
}

/** Replaces a module's settings (site:manage) without changing whether it is on. */
export function configureModule(db: Database, ctx: StoreContext, key: string, settings: unknown): Promise<SiteModuleView> {
  return changeModule(db, ctx, key, { target: null, settings });
}
