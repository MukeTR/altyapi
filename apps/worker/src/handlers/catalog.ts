import { refreshAllAutomatedCollections, refreshProductMemberships, runScheduledProductPublishing } from "@altyapi/catalog";
import { expireReservations } from "@altyapi/inventory";
import { eq, productVariants, withTenantTx } from "@altyapi/database";
import type { EventHandler } from "@altyapi/events";
import type { WorkerDeps } from "../deps";

export function catalogEventHandlers(deps: WorkerDeps): EventHandler[] {
  return [
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
