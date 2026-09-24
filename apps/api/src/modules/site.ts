import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  configureModule,
  createLocation,
  deleteLocation,
  disableModule,
  enableModule,
  getBusinessIdentity,
  getLocation,
  getSiteProfile,
  listLocations,
  listModules,
  reorderLocations,
  reorderSiteLocationsSchema,
  saveBusinessIdentity,
  updateLocation,
  updateSiteProfile,
  type SiteProfileView,
  type StoreContext,
} from "@altyapi/tenancy";
import {
  SITE_LOCATION_STATUSES,
  businessIdentityInputSchema,
  createSiteLocationSchema,
  siteProfileUpdateSchema,
  updateSiteLocationSchema,
} from "@altyapi/site";
import { modulePageHooks } from "@altyapi/theme-engine";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const moduleParams = storeParams.extend({ moduleKey: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/) });
const locationParams = storeParams.extend({ locationId: z.uuid() });
const settingsBody = z.record(z.string(), z.unknown());

/**
 * Site core (docs/platform/site-turleri-ve-cms.md §1, K3, K6): the site profile, capability
 * modules, business identity and locations of a store. Permissions and module gates are
 * enforced by the tenancy services (site:read, site:write for identity and locations,
 * site:manage for the profile and modules).
 */
export const siteRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/site";
  const ctx = (req: Parameters<typeof storeContext>[1]) => storeContext(deps, req);
  /** The profile with the store's active modules (the request's snapshot; a profile change never switches modules). */
  const profileView = async (c: StoreContext, load: Promise<SiteProfileView>) => ({
    ...(await load),
    modules: c.store.modules,
  });

  // Profile
  app.get(base, { schema: { tags: ["site"], params: storeParams } }, async (req) => {
    const c = await ctx(req);
    return profileView(c, getSiteProfile(deps.db, c));
  });
  app.put(base, { schema: { tags: ["site"], params: storeParams, body: siteProfileUpdateSchema } }, async (req) => {
    const c = await ctx(req);
    return profileView(c, updateSiteProfile(deps.db, c, req.body));
  });

  // Capability modules
  app.get(`${base}/modules`, { schema: { tags: ["site"], params: storeParams } }, async (req) => ({
    items: await listModules(deps.db, await ctx(req)),
  }));
  app.post(
    `${base}/modules/:moduleKey/enable`,
    { schema: { tags: ["site"], params: moduleParams, body: z.object({ settings: settingsBody.optional() }).nullish() } },
    // A module turned on after the site was set up gets its storefront pages (as drafts) in the same transaction.
    async (req) => enableModule(deps.db, await ctx(req), req.params.moduleKey, { settings: req.body?.settings }, modulePageHooks),
  );
  app.post(`${base}/modules/:moduleKey/disable`, { schema: { tags: ["site"], params: moduleParams } }, async (req) =>
    disableModule(deps.db, await ctx(req), req.params.moduleKey),
  );
  app.put(
    `${base}/modules/:moduleKey/settings`,
    { schema: { tags: ["site"], params: moduleParams, body: z.object({ settings: settingsBody }) } },
    async (req) => configureModule(deps.db, await ctx(req), req.params.moduleKey, req.body.settings),
  );

  // Business identity (patch semantics: omitted fields keep their value, null clears)
  app.get(`${base}/identity`, { schema: { tags: ["site"], params: storeParams } }, async (req) => getBusinessIdentity(deps.db, await ctx(req)));
  app.put(`${base}/identity`, { schema: { tags: ["site"], params: storeParams, body: businessIdentityInputSchema } }, async (req) =>
    saveBusinessIdentity(deps.db, await ctx(req), req.body),
  );

  // Locations
  app.get(
    `${base}/locations`,
    { schema: { tags: ["site"], params: storeParams, querystring: z.object({ status: z.enum(SITE_LOCATION_STATUSES).optional() }) } },
    async (req) => ({ items: await listLocations(deps.db, await ctx(req), req.query) }),
  );
  app.post(`${base}/locations`, { schema: { tags: ["site"], params: storeParams, body: createSiteLocationSchema } }, async (req, reply) =>
    reply.status(201).send(await createLocation(deps.db, await ctx(req), req.body)),
  );
  // Static segment: registered next to /locations/:locationId, matched before it.
  app.put(`${base}/locations/order`, { schema: { tags: ["site"], params: storeParams, body: reorderSiteLocationsSchema } }, async (req) => ({
    items: await reorderLocations(deps.db, await ctx(req), req.body),
  }));
  app.get(`${base}/locations/:locationId`, { schema: { tags: ["site"], params: locationParams } }, async (req) =>
    getLocation(deps.db, await ctx(req), req.params.locationId),
  );
  app.patch(`${base}/locations/:locationId`, { schema: { tags: ["site"], params: locationParams, body: updateSiteLocationSchema } }, async (req) =>
    updateLocation(deps.db, await ctx(req), req.params.locationId, req.body),
  );
  app.delete(`${base}/locations/:locationId`, { schema: { tags: ["site"], params: locationParams, response: { 204: z.null() } } }, async (req, reply) => {
    await deleteLocation(deps.db, await ctx(req), req.params.locationId);
    return reply.status(204).send(null);
  });
};
