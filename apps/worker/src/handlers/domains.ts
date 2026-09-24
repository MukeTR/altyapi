import { deterministicId } from "@altyapi/commerce-core";
import { dueDomainChecks, publishRouting, refreshDomainStatus } from "@altyapi/domains";
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
