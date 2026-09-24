import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createStore, createStoreSchema, listStores, updateStoreSettings, updateStoreSettingsSchema } from "@altyapi/tenancy";
import { bootstrapStorefront } from "@altyapi/theme-engine";
import { ensureDefaultTaxClass } from "@altyapi/catalog";
import { ensureDefaultLocation } from "@altyapi/inventory";
import { ensureBasePriceList } from "@altyapi/pricing";
import type { AppDeps } from "../deps";
import { orgContext, storeContext } from "../plugins/auth";

export const storeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  defaultCurrency: z.string(),
  supportedCurrencies: z.array(z.string()),
  timezone: z.string(),
  countryCode: z.string(),
  routingVersion: z.number().int(),
  contentVersion: z.number().int(),
  /** Active capability modules (core included), in dependency order; see /site/modules. */
  modules: z.array(z.string()),
  modulesVersion: z.number().int(),
  policyVersion: z.number().int(),
});

const orgParams = z.object({ organizationId: z.uuid() });
export const storeParams = orgParams.extend({ storeId: z.uuid() });

export const storeRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    "/v1/organizations/:organizationId/stores",
    { schema: { tags: ["stores"], params: orgParams, response: { 200: z.object({ items: z.array(storeSchema) }) } } },
    async (req) => ({ items: await listStores(deps.db, await orgContext(deps, req)) }),
  );

  app.post(
    "/v1/organizations/:organizationId/stores",
    { schema: { tags: ["stores"], params: orgParams, body: createStoreSchema, response: { 201: storeSchema } } },
    async (req, reply) => {
      const ctx = await orgContext(deps, req);
      const store = await createStore(
        deps.db,
        ctx,
        req.body,
        { rootDomain: deps.env.STORE_ROOT_DOMAIN },
        {
          onCreated: async (tx, store) => {
            const scope = { organizationId: store.organizationId, storeId: store.storeId };
            await ensureDefaultLocation(tx, scope);
            await ensureBasePriceList(tx, scope, req.body.defaultCurrency);
            await ensureDefaultTaxClass(tx, scope, req.body.countryCode);
            // The storefront starts from the site-kind preset (shop layout, or pages without a cart).
            await bootstrapStorefront(tx, { ...store, preset: store.siteKind });
          },
        },
      );
      return reply.status(201).send(store);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/stores/:storeId",
    { schema: { tags: ["stores"], params: storeParams, response: { 200: storeSchema } } },
    async (req) => (await storeContext(deps, req)).store,
  );

  app.patch(
    "/v1/organizations/:organizationId/stores/:storeId",
    { schema: { tags: ["stores"], params: storeParams, body: updateStoreSettingsSchema, response: { 200: storeSchema } } },
    async (req) => updateStoreSettings(deps.db, await storeContext(deps, req), req.body),
  );
};
