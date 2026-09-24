import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, conversionDeliveries, desc, eq, lt, withTenantTx } from "@altyapi/database";
import { getTrackingConfig, saveTrackingConfig, trackingConfigSchema } from "@altyapi/marketing";
import { assertCan } from "@altyapi/tenancy";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

/**
 * Protected tracking layer (pixels, analytics, conversion APIs, consent policy). Separate
 * from storefront design endpoints and guarded by the tracking permission.
 */
export const trackingRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/tracking";
  const trackingDeps = { db: deps.db, keys: deps.keys };

  app.get(base, { schema: { tags: ["tracking"], params: storeParams } }, async (req) => getTrackingConfig(trackingDeps, await storeContext(deps, req)));

  app.put(base, { schema: { tags: ["tracking"], params: storeParams, body: trackingConfigSchema } }, async (req) =>
    saveTrackingConfig(trackingDeps, await storeContext(deps, req), req.body),
  );

  // Server-side conversion delivery log (pixel health).
  app.get(
    `${base}/deliveries`,
    {
      schema: {
        tags: ["tracking"],
        params: storeParams,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.iso.datetime().optional() }),
      },
    },
    async (req) => {
      const ctx = await storeContext(deps, req);
      assertCan(ctx, "tracking:read");
      const items = await withTenantTx(deps.db, ctx, (tx) =>
        tx
          .select()
          .from(conversionDeliveries)
          .where(
            and(
              eq(conversionDeliveries.storeId, ctx.storeId),
              req.query.before ? lt(conversionDeliveries.createdAt, new Date(req.query.before)) : undefined,
            ),
          )
          .orderBy(desc(conversionDeliveries.createdAt))
          .limit(req.query.limit),
      );
      return { items };
    },
  );
};
