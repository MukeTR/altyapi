import { newId } from "@altyapi/commerce-core";
import { and, eq, redirects, sql, type Transaction } from "@altyapi/database";

type Scope = { organizationId: string; storeId: string };

export interface PathRedirectInput {
  fromPath: string;
  /** Target path; null for 410 Gone. */
  toPath: string | null;
  statusCode: 301 | 302 | 410;
  /** prefix: fromPath and everything below it, with the rest of the path carried over. */
  matchType: "exact" | "prefix";
  source: string;
}

/**
 * Saves a redirect created by content changes (slug changes, type prefix changes, removed
 * prefixes) while keeping the redirect table free of chains and loops:
 *   - redirects that ended at fromPath now end at toPath (for a prefix rule, every redirect
 *     that ended below fromPath is moved below toPath too);
 *   - a redirect away from toPath is removed (the target is live again).
 * A rule already starting at fromPath is replaced, match type included.
 */
export async function savePathRedirect(tx: Transaction, scope: Scope, input: PathRedirectInput): Promise<void> {
  const { fromPath, toPath } = input;
  if (fromPath === toPath) return;
  if (toPath !== null) {
    await tx
      .update(redirects)
      .set({ toPath, updatedAt: new Date() })
      .where(and(eq(redirects.storeId, scope.storeId), eq(redirects.toPath, fromPath)));
    if (input.matchType === "prefix") {
      await tx
        .update(redirects)
        .set({ toPath: sql`${toPath}::text || substr(${redirects.toPath}, ${fromPath.length + 1}::int)`, updatedAt: new Date() })
        .where(and(eq(redirects.storeId, scope.storeId), sql`${redirects.toPath} like ${likePrefix(fromPath)} escape '\\'`));
    }
    await releasePath(tx, scope.storeId, toPath);
  }
  await tx
    .insert(redirects)
    .values({
      id: newId(),
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      fromPath,
      toPath,
      statusCode: input.statusCode,
      matchType: input.matchType,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [redirects.storeId, redirects.fromPath],
      set: { toPath, statusCode: input.statusCode, matchType: input.matchType, source: input.source, updatedAt: new Date() },
    });
}

/** Removes the redirect starting at a path that is served again (an entry or a type prefix went live there). */
export async function releasePath(tx: Transaction, storeId: string, path: string): Promise<void> {
  await tx.delete(redirects).where(and(eq(redirects.storeId, storeId), eq(redirects.fromPath, path)));
}

/** LIKE pattern for "below this path" with wildcards in the path escaped. */
function likePrefix(path: string): string {
  return `${path.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
}
