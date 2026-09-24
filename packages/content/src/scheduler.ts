import { AppError } from "@altyapi/commerce-core";
import { and, asc, contentEntries, eq, pgTimestamp, sql, withPlatformTx, withTenantTx, type Database, type Transaction } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { publishEntryTx, unpublishEntryTx } from "./service/publish";
import { loadStoreInfo, type Scope } from "./service/shared";

/** Where the scheduler reports entries it could not handle (the worker logger). */
export interface EntryScheduleLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

type DueEntry = {
  id: string;
  organizationId: string;
  storeId: string;
  status: typeof contentEntries.$inferSelect.status;
  publishAt: Date | null;
  unpublishAt: Date | null;
};

const BATCH = 100;

/**
 * Publishes entries whose publish time has come (scheduled entries and scheduled updates of
 * live ones) and takes down live entries whose unpublish time has come, the longest overdue
 * first. A scheduled publish puts live the draft revision that was approved (scheduled_revision)
 * and records its approver as the publisher; edits made since by others stay in the draft. Every entry runs in its own transaction, so one failure never holds up the rest of the
 * batch (other entries, other stores). An entry the platform refuses (a domain error such as a
 * missing required field or a slug another entry went live under) leaves the schedule with an
 * audit entry and a content.entry.schedule_failed event instead of failing again on every run;
 * an unexpected error keeps it scheduled for the next run. Returns the number handled.
 */
export async function runScheduledEntryPublishing(db: Database, now: Date = new Date(), logger?: EntryScheduleLogger): Promise<number> {
  const at = pgTimestamp(now);
  const dueAt = sql`least(coalesce(${contentEntries.publishAt}, 'infinity'::timestamptz), coalesce(${contentEntries.unpublishAt}, 'infinity'::timestamptz))`;
  const due: DueEntry[] = await withPlatformTx(db, (tx) =>
    tx
      .select({
        id: contentEntries.id,
        organizationId: contentEntries.organizationId,
        storeId: contentEntries.storeId,
        status: contentEntries.status,
        publishAt: contentEntries.publishAt,
        unpublishAt: contentEntries.unpublishAt,
      })
      .from(contentEntries)
      .where(
        sql`(${contentEntries.status} in ('scheduled', 'published') and ${contentEntries.publishAt} <= ${at})
          or (${contentEntries.status} = 'published' and ${contentEntries.unpublishAt} <= ${at})`,
      )
      .orderBy(asc(dueAt), asc(contentEntries.id))
      .limit(BATCH),
  );
  let handled = 0;
  for (const e of due) {
    const scope: Scope = { organizationId: e.organizationId, storeId: e.storeId };
    // A due take-down wins over a due update of the same live entry.
    const operation: "publish" | "unpublish" = e.status === "published" && e.unpublishAt !== null && e.unpublishAt <= now ? "unpublish" : "publish";
    try {
      await withTenantTx(db, scope, async (tx) => {
        // The merchant may have published, unpublished or rescheduled it since the batch was read.
        const [current] = await tx
          .select({
            status: contentEntries.status,
            publishAt: contentEntries.publishAt,
            unpublishAt: contentEntries.unpublishAt,
            scheduledRevision: contentEntries.scheduledRevision,
            scheduledByPrincipalId: contentEntries.scheduledByPrincipalId,
          })
          .from(contentEntries)
          .where(eq(contentEntries.id, e.id))
          .for("update");
        const stillDue =
          operation === "unpublish"
            ? current?.status === "published" && current.unpublishAt !== null && current.unpublishAt <= now
            : (current?.status === "scheduled" || current?.status === "published") && current.publishAt !== null && current.publishAt <= now;
        if (!stillDue || !current) return;
        const store = await loadStoreInfo(tx, scope);
        if (operation === "unpublish") await unpublishEntryTx(tx, store, e.id, { reason: "scheduled" });
        else {
          await publishEntryTx(tx, store, e.id, {
            principalId: current.scheduledByPrincipalId,
            reason: "scheduled",
            revision: current.scheduledRevision ?? undefined,
          });
        }
      });
      handled++;
    } catch (err) {
      if (!(err instanceof AppError)) {
        logger?.error({ err, entryId: e.id, storeId: e.storeId, operation }, "scheduled entry publishing failed; retrying on the next run");
        continue;
      }
      try {
        await withTenantTx(db, scope, (tx) => abandonSchedule(tx, scope, e.id, operation, err));
        logger?.warn({ entryId: e.id, storeId: e.storeId, operation, error: err.messageKey, details: err.details }, "scheduled entry publishing refused; entry left the schedule");
        handled++;
      } catch (abandonErr) {
        logger?.error({ err: abandonErr, entryId: e.id, storeId: e.storeId, operation }, "scheduled entry could not leave the schedule; retrying on the next run");
      }
    }
  }
  return handled;
}

/**
 * Takes an entry the platform refused to publish (or take down) on schedule off the schedule:
 * a refused first publish goes back to draft, a refused update or take-down keeps the live
 * version as it is. The refusal is audited and announced for the merchant.
 */
async function abandonSchedule(tx: Transaction, scope: Scope, entryId: string, operation: "publish" | "unpublish", err: AppError): Promise<void> {
  const [row] =
    operation === "publish"
      ? await tx
          .update(contentEntries)
          .set({
            status: sql`case when ${contentEntries.status} = 'scheduled' then 'draft'::content_entry_status else ${contentEntries.status} end`,
            publishAt: null,
            scheduledRevision: null,
            scheduledByPrincipalId: null,
          })
          .where(and(eq(contentEntries.id, entryId), sql`${contentEntries.status} in ('scheduled', 'published')`))
          .returning({ id: contentEntries.id })
      : await tx
          .update(contentEntries)
          .set({ unpublishAt: null })
          .where(and(eq(contentEntries.id, entryId), eq(contentEntries.status, "published")))
          .returning({ id: contentEntries.id });
  if (!row) return;
  const details = err.details ?? {};
  await appendEvent(tx, {
    type: "content.entry.schedule_failed",
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    aggregateType: "content_entry",
    aggregateId: entryId,
    payload: { entryId, operation, errorKey: err.messageKey, details },
  });
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    action: "content_entry.schedule_failed",
    resourceType: "content_entry",
    resourceId: entryId,
    after: { operation, error: err.messageKey, details },
  });
}
