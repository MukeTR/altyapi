import { eq, inArray, siteModules, siteProfiles, type DbExecutor } from "@altyapi/database";
import { SITE_MODULES, type ModuleKey } from "./modules/index";
import { presetModuleRows } from "./presets";
import type { ModuleState } from "./registry";
import type { SiteKind } from "./types";

export interface SiteScope {
  organizationId: string;
  storeId: string;
}

/**
 * Stored module rows of a store. Reads through the caller's transaction, which must be scoped
 * to the store's tenant (RLS) or be a platform transaction.
 */
export async function loadModuleStates(tx: DbExecutor, storeId: string): Promise<ModuleState[]> {
  return tx
    .select({ moduleKey: siteModules.moduleKey, status: siteModules.status })
    .from(siteModules)
    .where(eq(siteModules.storeId, storeId));
}

/** Active module keys of a store (always-on modules included), in dependency order. */
export async function loadActiveModules(tx: DbExecutor, storeId: string): Promise<ModuleKey[]> {
  return SITE_MODULES.activeKeys(await loadModuleStates(tx, storeId));
}

/** Active module keys for several stores in one query. */
export async function loadActiveModulesByStore(tx: DbExecutor, storeIds: readonly string[]): Promise<Map<string, ModuleKey[]>> {
  const states = new Map<string, ModuleState[]>(storeIds.map((id) => [id, []]));
  if (storeIds.length) {
    const rows = await tx
      .select({ storeId: siteModules.storeId, moduleKey: siteModules.moduleKey, status: siteModules.status })
      .from(siteModules)
      .where(inArray(siteModules.storeId, [...storeIds]));
    for (const row of rows) states.get(row.storeId)?.push(row);
  }
  return new Map([...states].map(([storeId, rows]) => [storeId, SITE_MODULES.activeKeys(rows)]));
}

/**
 * Writes the site profile and the preset's module rows for a newly created store. Runs inside
 * the store creation transaction, so a store never exists without its site rows. Returns the
 * active module keys.
 */
export async function seedSiteFromPreset(tx: DbExecutor, scope: SiteScope, kind: SiteKind): Promise<ModuleKey[]> {
  await tx.insert(siteProfiles).values({ storeId: scope.storeId, organizationId: scope.organizationId, kind });
  const rows = presetModuleRows(kind);
  if (rows.length) {
    await tx.insert(siteModules).values(rows.map((r) => ({ storeId: scope.storeId, organizationId: scope.organizationId, ...r })));
  }
  return SITE_MODULES.activeKeys(rows);
}
