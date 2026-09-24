import { deterministicId } from "@altyapi/commerce-core";
import { dueDomainChecks, publishRouting, refreshDomainStatus, storeHostnames } from "@altyapi/domains";
import { enqueueJob, PermanentJobError, type EventHandler, type JobHandler } from "@altyapi/events";
import type { WorkerDeps } from "../deps";

export function domainJobHandlers(deps: WorkerDeps): JobHandler[] {
  return [
    {
      type: "domains.check",
      timeoutSeconds: 60,
      async handle(job) {
        if (!deps.domains.cloudflare) throw new PermanentJobError("cloudflare not configured");
        await refreshDomainStatus(deps.domains, String(job.payload.domainId));
      },
    },
  ];
}

export function domainEventHandlers(deps: WorkerDeps): EventHandler[] {
  return [
    {
      // Content changes bump stores.content_version; the edge cache key includes it. KV writes are
      // coalesced per store (flushed by the scheduler) to respect KV per-key write limits.
      // storefront.publication_switched covers every live pointer move, including rollbacks.
      // Content entries go live one by one (record versions) and site settings change what
      // every page renders (modules, URL style, identity, locations), so they count too.
      name: "edge-content-version",
      events: [
        "storefront.publication_switched",
        "theme.published",
        "page.published",
        "redirect.changed",
        "content.entry.published",
        "content.entry.unpublished",
        "content.entry.archived",
        "content.type.changed",
        "site.profile_changed",
        "site.modules_changed",
        "site.identity_changed",
        "site.locations_changed",
        "product.created",
        "product.updated",
        "product.published",
        "product.deleted",
        "collection.changed",
        "store.settings_updated",
        "campaign.activated",
        "tracking.updated",
      ],
      async handle(event) {
        if (!deps.domains.cloudflare || !event.storeId) return;
        await deps.redis.sadd("edge:content-pending", event.storeId);
      },
    },
    {
      name: "edge-routing-publisher",
      events: ["domain.routing_changed", "store.created"],
      async handle(event) {
        const cf = deps.domains.cloudflare;
        if (!cf) return; // edge falls back to origin resolution when KV is not configured
        const hostnames =
          event.type === "domain.routing_changed"
            ? (event.payload as { hostnames: string[] }).hostnames
            : [`${(event.payload as { slug: string }).slug}.${deps.env.STORE_ROOT_DOMAIN}`];
        await publishRouting(deps.db, cf, hostnames);
      },
    },
  ];
}

/** Scheduler tick: enqueue status checks for domains whose next check is due. */
export async function scheduleDomainChecks(deps: WorkerDeps): Promise<number> {
  if (!deps.domains.cloudflare) return 0;
  const ids = await dueDomainChecks(deps.db, 200);
  const slot = Math.floor(Date.now() / 60_000);
  for (const domainId of ids) {
    await enqueueJob(deps.queue, {
      id: deterministicId(`domains.check:${domainId}:${slot}`),
      type: "domains.check",
      payload: { domainId },
    });
  }
  return ids.length;
}

/** Scheduler tick: publishes the latest content version for stores with pending changes. */
export async function flushEdgeContentVersions(deps: WorkerDeps): Promise<number> {
  const cf = deps.domains.cloudflare;
  if (!cf) return 0;
  const storeIds = await deps.redis.spop("edge:content-pending", 100);
  for (const storeId of storeIds) {
    await publishRouting(deps.db, cf, await storeHostnames(deps.db, storeId));
  }
  return storeIds.length;
}
