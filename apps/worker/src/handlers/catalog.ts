import { analyzeImport, refreshAllAutomatedCollections, refreshProductMemberships, runImportJob, runScheduledProductPublishing } from "@altyapi/catalog";
import type { R2Storage } from "@altyapi/storage";
import { expireReservations } from "@altyapi/inventory";
import { eq, productVariants, withTenantTx } from "@altyapi/database";
import { PermanentJobError, type EventHandler, type JobHandler } from "@altyapi/events";
import type { WorkerDeps } from "../deps";

export function catalogEventHandlers(deps: WorkerDeps, r2: R2Storage | null): EventHandler[] {
  return [
    {
      name: "import-analyzer",
      events: ["import.requested"],
      async handle(event) {
        if (!r2) throw new PermanentJobError("R2 storage is not configured");
        await analyzeImport(deps.db, r2, { organizationId: event.organizationId!, storeId: event.storeId! }, (event.payload as { importJobId: string }).importJobId);
      },
    },
    {
      name: "automated-collection-membership",
      events: ["product.created", "product.updated", "product.published", "inventory.changed"],
      async handle(event) {
        if (!event.organizationId || !event.storeId) return;
        const scope = { organizationId: event.organizationId, storeId: event.storeId };
        let productId: string | undefined;
        if (event.type === "inventory.changed") {
          const variantId = (event.payload as { variantId: string }).variantId;
          if (!variantId) return;
          const v = await withTenantTx(deps.db, scope, (tx) => tx.query.productVariants.findFirst({ where: eq(productVariants.id, variantId) }));
          productId = v?.productId;
        } else {
          productId = (event.payload as { productId: string }).productId;
        }
        if (productId) await refreshProductMemberships(deps.db, scope, productId);
      },
    },
  ];
}

export const catalogScheduledTasks = (deps: WorkerDeps) => [
  { name: "catalog.scheduled-publishing", intervalMs: 60_000, run: () => runScheduledProductPublishing(deps.db) },
  { name: "catalog.refresh-automated-collections", intervalMs: 3600_000, run: () => refreshAllAutomatedCollections(deps.db) },
  { name: "inventory.expire-reservations", intervalMs: 30_000, run: () => expireReservations(deps.db) },
];

export function catalogJobHandlers(deps: WorkerDeps, r2: R2Storage | null): JobHandler[] {
  return [
    {
      type: "catalog.import.run",
      timeoutSeconds: 120,
      async handle(job) {
        if (!r2) throw new PermanentJobError("R2 storage is not configured");
        if (!job.organizationId || !job.storeId) throw new PermanentJobError("import job without tenant scope");
        const payload = job.payload as { jobId: string; sequence?: number };
        await runImportJob({ db: deps.db, r2, queue: deps.queue }, { organizationId: job.organizationId, storeId: job.storeId }, payload.jobId, payload.sequence ?? 0);
      },
    },
  ];
}
