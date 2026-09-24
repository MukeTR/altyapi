import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  autoMap,
  cancelImport,
  createImportJob,
  createImportSchema,
  getImportJob,
  IMPORT_FIELD_KEYS,
  listImportJobs,
  listImportProfiles,
  setImportMapping,
  setMappingSchema,
  startImport,
} from "@altyapi/catalog";
import type { Queue } from "@altyapi/events";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const jobParams = storeParams.extend({ jobId: z.uuid() });

export const importRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; queue: Queue }> = async (app, { deps, queue }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/imports";

  app.get("/v1/import-fields", { schema: { tags: ["imports"] } }, async () => ({ fields: IMPORT_FIELD_KEYS }));
  app.post("/v1/import-fields/auto-map", { schema: { tags: ["imports"], body: z.object({ columns: z.array(z.string().max(300)).max(500) }) } }, async (req) => ({
    mapping: autoMap(req.body.columns),
  }));

  app.get(base, { schema: { tags: ["imports"], params: storeParams } }, async (req) => ({ items: await listImportJobs(deps.db, await storeContext(deps, req)) }));
  app.get(`${base}/profiles`, { schema: { tags: ["imports"], params: storeParams } }, async (req) => ({ items: await listImportProfiles(deps.db, await storeContext(deps, req)) }));
  app.post(base, { schema: { tags: ["imports"], params: storeParams, body: createImportSchema } }, async (req, reply) =>
    reply.status(201).send(await createImportJob(deps.db, await storeContext(deps, req), req.body)),
  );
  app.get(`${base}/:jobId`, { schema: { tags: ["imports"], params: jobParams } }, async (req) => getImportJob(deps.db, await storeContext(deps, req), req.params.jobId));
  app.put(`${base}/:jobId/mapping`, { schema: { tags: ["imports"], params: jobParams, body: setMappingSchema } }, async (req) =>
    setImportMapping(deps.db, await storeContext(deps, req), req.params.jobId, req.body),
  );
  app.post(`${base}/:jobId/start`, { schema: { tags: ["imports"], params: jobParams } }, async (req) =>
    startImport(deps.db, queue, await storeContext(deps, req), req.params.jobId),
  );
  app.post(`${base}/:jobId/cancel`, { schema: { tags: ["imports"], params: jobParams } }, async (req) =>
    cancelImport(deps.db, await storeContext(deps, req), req.params.jobId),
  );
};
