import type { EventHandler } from "@altyapi/events";
import { sendPurchaseConversions } from "@altyapi/marketing";
import type { WorkerDeps } from "../deps";

export function marketingEventHandlers(deps: WorkerDeps): EventHandler[] {
  return [
    {
      // Purchase → Meta CAPI / TikTok Events API / GA4 MP, deduplicated with the browser pixel.
      name: "server-conversions",
      events: ["order.confirmed"],
      async handle(event) {
        if (!event.organizationId || !event.storeId) return;
        const results = await sendPurchaseConversions(
          { db: deps.db, keys: deps.payments.keys, metaGraphApiVersion: deps.env.META_GRAPH_API_VERSION },
          { organizationId: event.organizationId, storeId: event.storeId },
          (event.payload as { orderId: string }).orderId,
        );
        for (const r of results) {
          if (r.result.status === "failed") deps.logger.warn({ destination: r.destination, status: r.result.httpStatus, message: r.result.message }, "conversion rejected");
        }
      },
    },
  ];
}
