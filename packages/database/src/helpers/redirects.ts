import { and, eq } from "drizzle-orm";
import { newIdForHelpers } from "./ids";
import { redirects } from "../schema/storefront";
import type { Transaction } from "../client";

/**
 * Creates or updates a storefront redirect while preventing chains and loops: redirects
 * that pointed at fromPath are re-pointed to toPath, and any redirect away from toPath
 * is removed (the target is live again).
 */
export async function upsertRedirect(
  tx: Transaction,
  scope: { organizationId: string; storeId: string },
  fromPath: string,
  toPath: string,
  statusCode: 301 | 302,
  source: string,
): Promise<void> {
  if (fromPath === toPath) return;
  await tx.update(redirects).set({ toPath }).where(and(eq(redirects.storeId, scope.storeId), eq(redirects.toPath, fromPath)));
  await tx.delete(redirects).where(and(eq(redirects.storeId, scope.storeId), eq(redirects.fromPath, toPath)));
  await tx
    .insert(redirects)
    .values({ id: newIdForHelpers(), organizationId: scope.organizationId, storeId: scope.storeId, fromPath, toPath, statusCode, source })
    .onConflictDoUpdate({ target: [redirects.storeId, redirects.fromPath], set: { toPath, statusCode, source, updatedAt: new Date() } });
}
