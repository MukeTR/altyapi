import { enqueueJob, type JobHandler } from "@altyapi/events";
import { claimDueConnections, syncConnectionById, type IntegrationDeps } from "@altyapi/integrations";
import type { WorkerDeps } from "../deps";

const integrationDeps = (deps: WorkerDeps): IntegrationDeps => ({ db: deps.db, keys: deps.payments.keys, redis: deps.redis, logger: deps.logger });

/**
 * Integrators and marketplaces offer no webhooks, so due connections are polled. The
 * scheduler only leases due connections and queues one job each; syncs run on job workers.
 */
export const integrationScheduledTasks = (deps: WorkerDeps) => [
  {
    name: "integrations.schedule",
    intervalMs: 15_000,
    run: async () => {
      const due = await claimDueConnections(integrationDeps(deps), 20);
      for (const conn of due) {
        await enqueueJob(deps.queue, { type: "integration.sync", payload: { connectionId: conn.id }, organizationId: conn.organizationId, storeId: conn.storeId });
      }
      return due.length;
    },
  },
];

export const integrationJobHandlers = (deps: WorkerDeps): JobHandler[] => [
  {
    type: "integration.sync",
    timeoutSeconds: 900,
    async handle(job) {
      await syncConnectionById(integrationDeps(deps), String(job.payload.connectionId));
    },
  },
];
