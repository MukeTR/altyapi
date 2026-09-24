import { sql } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { ekosistemTombstones } from "../schema/ekosistem";
import { newIdForHelpers } from "./ids";

export type TombstoneResource = (typeof ekosistemTombstones.$inferInsert)["resource"];

/**
 * Records that a record was deleted so incremental ekosistem endpoints can report it as
 * { ref, deleted: true, updatedAt } (docs/ekosistem/v1.md §6.3). Call inside the
 * transaction that deletes the record; deleting the same ref again refreshes deletedAt.
 */
export async function recordTombstone(
  tx: DbExecutor,
  input: { organizationId: string; storeId: string; resource: TombstoneResource; ref: string },
): Promise<void> {
  await tx
    .insert(ekosistemTombstones)
    .values({ id: newIdForHelpers(), organizationId: input.organizationId, storeId: input.storeId, resource: input.resource, ref: input.ref })
    .onConflictDoUpdate({
      target: [ekosistemTombstones.storeId, ekosistemTombstones.resource, ekosistemTombstones.ref],
      set: { deletedAt: sql`now()` },
    });
}
