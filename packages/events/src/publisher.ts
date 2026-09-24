import { and, asc, eq, lte, outboxEvents, sql, withPlatformTx, type Database } from "@altyapi/database";
import type { EventEnvelope } from "./outbox";
import { backoffSeconds, type Queue } from "./queue/types";

/**
 * Moves committed outbox rows to the events queue. Rows are locked with SKIP LOCKED so
 * several publisher instances can run concurrently; a send failure schedules a retry.
 * The queue message id equals the event id, which consumers use for deduplication.
 */
export async function publishOutboxBatch(db: Database, queue: Queue, limit = 100): Promise<number> {
  return withPlatformTx(db, async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, new Date())))
      .orderBy(asc(outboxEvents.availableAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    let published = 0;
    for (const row of rows) {
      const envelope: EventEnvelope = {
        id: row.id,
        type: row.type as EventEnvelope["type"],
        version: row.version,
        organizationId: row.organizationId,
        storeId: row.storeId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload as EventEnvelope["payload"],
        correlationId: row.correlationId,
        causationId: row.causationId,
        occurredAt: row.occurredAt.toISOString(),
      };
      try {
        await queue.send("events", envelope as unknown as Record<string, unknown>, { messageId: row.id });
        await tx
          .update(outboxEvents)
          .set({ status: "published", publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
          .where(eq(outboxEvents.id, row.id));
        published++;
      } catch (err) {
        const attempts = row.attempts + 1;
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: (err as Error).message.slice(0, 2000),
            availableAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
            status: attempts >= 20 ? "failed" : "pending",
          })
          .where(eq(outboxEvents.id, row.id));
      }
    }
    return published;
  });
}
