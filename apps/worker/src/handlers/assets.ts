import { cleanupAssets, processAsset, type R2Storage } from "@altyapi/storage";
import type { EventHandler } from "@altyapi/events";
import type { WorkerDeps } from "../deps";

export function assetEventHandlers(deps: WorkerDeps, r2: R2Storage | null): EventHandler[] {
  return [
    {
      name: "asset-processor",
      events: ["asset.uploaded"],
      async handle(event) {
        if (!r2) throw new Error("R2 storage is not configured");
        const asset = await processAsset(deps.db, r2, (event.payload as { assetId: string }).assetId);
        if (asset?.status === "failed") deps.logger.warn({ assetId: asset.id, reason: asset.failureReason }, "asset rejected");
      },
    },
  ];
}

export async function runAssetCleanup(deps: WorkerDeps, r2: R2Storage | null): Promise<number> {
  if (!r2) return 0;
  return cleanupAssets(deps.db, r2);
}
