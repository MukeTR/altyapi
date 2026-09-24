import { notFound } from "@altyapi/commerce-core";
import { eq, siteProfiles, sql, stores, type DbExecutor } from "@altyapi/database";

/**
 * Bumps the store's content version (cached storefront HTML, the edge cache key) and, when the
 * route table or module gates can change, its modules version. Runs in the caller's
 * transaction; returns the versions after the bump.
 */
export async function bumpStoreVersions(
  tx: DbExecutor,
  storeId: string,
  bump: { modules: boolean },
): Promise<{ contentVersion: number; modulesVersion: number }> {
  const [row] = await tx
    .update(stores)
    .set({
      contentVersion: sql`${stores.contentVersion} + 1`,
      ...(bump.modules ? { modulesVersion: sql`${stores.modulesVersion} + 1` } : {}),
    })
    .where(eq(stores.id, storeId))
    .returning({ contentVersion: stores.contentVersion, modulesVersion: stores.modulesVersion });
  return row!;
}

/**
 * Locks the store's site profile row for the rest of the transaction and returns it. Every
 * site-core write takes this lock first, so concurrent module switches (dependency checks)
 * and location writes (the single primary location) of one store are serialized.
 */
export async function lockSiteProfile(tx: DbExecutor, storeId: string) {
  const [row] = await tx.select().from(siteProfiles).where(eq(siteProfiles.storeId, storeId)).for("update");
  if (!row) throw notFound("site_profile", storeId);
  return row;
}
