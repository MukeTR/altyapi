import { deterministicId, newId } from "@altyapi/commerce-core";
import { ekosistemEventReceipts, withTenantTx } from "@altyapi/database";
import { enqueueJob } from "@altyapi/events";
import { PUSH_COALESCE_MS, type PeerProduct } from "../constants";
import type { PushEvent } from "../schemas";
import { hasAnyScope, type EkosistemScope } from "../scopes";
import type { EkosistemServerDeps, LinkRow } from "./common";
import type { PullResource } from "./consume/resources";

/**
 * POST /ekosistem/v1/events (§10). The receiver answers 2xx, ignores types it does not
 * handle, is idempotent by event id per link, and coalesces pulls for the same resource
 * for at least 30 seconds: the first event of a window schedules one pull 30 s later and
 * later events in the window ride along with it.
 */

export const PULL_JOB_TYPE = "ekosistem.pull";

interface PullTarget {
  resource: PullResource;
  from: PeerProduct;
  /** altyapi must hold one of these peer scopes for the pull to make sense. */
  scopes: EkosistemScope[];
}

const PULL_TARGETS: Record<string, PullTarget> = {
  "karmatik.profit.updated": { resource: "profit", from: "karmatik", scopes: ["profit:read", "profit:summary"] },
  "karmatik.suggestion.created": { resource: "suggestions", from: "karmatik", scopes: ["pricing:read"] },
};

/** Push types that trigger a pull of `resource`. */
export function pushTypesFor(resource: PullResource): string[] {
  return Object.entries(PULL_TARGETS)
    .filter(([, t]) => t.resource === resource)
    .map(([type]) => type);
}

export type ReceiveOutcome = "accepted" | "duplicate" | "ignored";

export async function receivePushEvent(deps: EkosistemServerDeps, link: LinkRow, event: PushEvent, now: Date = new Date()): Promise<ReceiveOutcome> {
  const target = PULL_TARGETS[event.type];
  if (!target || target.from !== link.peerProduct || !hasAnyScope(link.peerScopes, ...target.scopes)) return "ignored";

  const inserted = await withTenantTx(deps.db, { organizationId: link.organizationId, storeId: link.storeId }, (tx) =>
    tx
      .insert(ekosistemEventReceipts)
      .values({
        id: newId(),
        organizationId: link.organizationId,
        storeId: link.storeId,
        linkId: link.id,
        eventId: event.id.toLowerCase(),
        type: event.type,
        ref: typeof event.data.ref === "string" ? event.data.ref : null,
        occurredAt: new Date(event.occurredAt),
      })
      .onConflictDoNothing({ target: [ekosistemEventReceipts.linkId, ekosistemEventReceipts.eventId] })
      .returning({ id: ekosistemEventReceipts.id }),
  );
  if (!inserted.length) return "duplicate";

  // One pull per (link, resource) per window; the pull is incremental over the whole resource,
  // so it also covers every (type, ref) that arrived in the window.
  let schedule = true;
  if (deps.redis) {
    try {
      schedule = (await deps.redis.set(`ekosistem:coalesce:${link.id}:${target.resource}`, "1", "PX", PUSH_COALESCE_MS, "NX")) === "OK";
    } catch (err) {
      deps.logger.warn({ err, linkId: link.id }, "ekosistem coalescing unavailable; relying on job ids");
    }
  }
  if (schedule && deps.queue) {
    const slot = Math.floor(now.getTime() / PUSH_COALESCE_MS);
    await enqueueJob(
      deps.queue,
      {
        // Deterministic per window so a lost coalescing key cannot schedule the same pull twice.
        id: deterministicId(`${PULL_JOB_TYPE}:${link.id}:${target.resource}:${slot}`),
        type: PULL_JOB_TYPE,
        payload: { linkId: link.id, resource: target.resource },
        organizationId: link.organizationId,
        storeId: link.storeId,
      },
      { delaySeconds: Math.ceil(PUSH_COALESCE_MS / 1000) },
    );
  }
  return "accepted";
}
