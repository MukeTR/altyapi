import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  bulkSetStatus,
  bulkStatusSchema,
  categoryInputSchema,
  collectionInputSchema,
  createProduct,
  deleteCollection,
  deleteProduct,
  getCollection,
  getProduct,
  listCategories,
  listCollections,
  listProducts,
  listProductsQuerySchema,
  listTaxClasses,
  productInputSchema,
  productUpdateSchema,
  saveCategory,
  saveCollection,
  saveTaxClass,
  setCollectionProducts,
  setCollectionProductsSchema,
  taxClassSchema,
  updateProduct,
} from "@altyapi/catalog";
import {
  adjustStock,
  adjustStockSchema,
  createLocation,
  createTransfer,
  createTransferSchema,
  getInventoryLevels,
  listLocations,
  locationSchema,
  receiveTransfer,
  shipTransfer,
} from "@altyapi/inventory";
import {
  createPriceList,
  createPriceListSchema,
  deletePriceList,
  getPrices,
  listPriceLists,
  priceQuerySchema,
  setPrices,
  setPricesSchema,
} from "@altyapi/pricing";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const id = (name: string) => storeParams.extend({ [name]: z.uuid() } as Record<string, z.ZodUUID>);

export const catalogRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId";
  const ctx = (req: Parameters<typeof storeContext>[1]) => storeContext(deps, req);

  // Products
  app.get(`${base}/products`, { schema: { tags: ["catalog"], params: storeParams, querystring: listProductsQuerySchema } }, async (req) =>
    listProducts(deps.db, await ctx(req), req.query),
  );
  app.post(`${base}/products`, { schema: { tags: ["catalog"], params: storeParams, body: productInputSchema } }, async (req, reply) =>
    reply.status(201).send(await createProduct(deps.db, await ctx(req), req.body)),
  );
  app.get(`${base}/products/:productId`, { schema: { tags: ["catalog"], params: id("productId") } }, async (req) =>
    getProduct(deps.db, await ctx(req), (req.params as { productId: string }).productId),
  );
  app.put(`${base}/products/:productId`, { schema: { tags: ["catalog"], params: id("productId"), body: productUpdateSchema } }, async (req) =>
    updateProduct(deps.db, await ctx(req), (req.params as { productId: string }).productId, req.body),
  );
  app.delete(`${base}/products/:productId`, { schema: { tags: ["catalog"], params: id("productId") } }, async (req) =>
    deleteProduct(deps.db, await ctx(req), (req.params as { productId: string }).productId),
  );
  app.post(`${base}/products/bulk-status`, { schema: { tags: ["catalog"], params: storeParams, body: bulkStatusSchema } }, async (req) =>
    bulkSetStatus(deps.db, await ctx(req), req.body),
  );

  // Collections
  app.get(`${base}/collections`, { schema: { tags: ["catalog"], params: storeParams } }, async (req) => ({ items: await listCollections(deps.db, await ctx(req)) }));
  app.post(`${base}/collections`, { schema: { tags: ["catalog"], params: storeParams, body: collectionInputSchema } }, async (req, reply) =>
    reply.status(201).send(await saveCollection(deps.db, await ctx(req), req.body)),
  );
  app.get(`${base}/collections/:collectionId`, { schema: { tags: ["catalog"], params: id("collectionId") } }, async (req) =>
    getCollection(deps.db, await ctx(req), (req.params as { collectionId: string }).collectionId),
  );
  app.put(`${base}/collections/:collectionId`, { schema: { tags: ["catalog"], params: id("collectionId"), body: collectionInputSchema } }, async (req) =>
    saveCollection(deps.db, await ctx(req), req.body, (req.params as { collectionId: string }).collectionId),
  );
  app.put(
    `${base}/collections/:collectionId/products`,
    { schema: { tags: ["catalog"], params: id("collectionId"), body: setCollectionProductsSchema } },
    async (req, reply) => {
      await setCollectionProducts(deps.db, await ctx(req), (req.params as { collectionId: string }).collectionId, req.body);
      return reply.status(204).send();
    },
  );
  app.delete(`${base}/collections/:collectionId`, { schema: { tags: ["catalog"], params: id("collectionId") } }, async (req, reply) => {
    await deleteCollection(deps.db, await ctx(req), (req.params as { collectionId: string }).collectionId);
    return reply.status(204).send();
  });

  // Categories & tax classes
  app.get(`${base}/categories`, { schema: { tags: ["catalog"], params: storeParams } }, async (req) => ({ items: await listCategories(deps.db, await ctx(req)) }));
  app.post(`${base}/categories`, { schema: { tags: ["catalog"], params: storeParams, body: categoryInputSchema } }, async (req, reply) =>
    reply.status(201).send(await saveCategory(deps.db, await ctx(req), req.body)),
  );
  app.put(`${base}/categories/:categoryId`, { schema: { tags: ["catalog"], params: id("categoryId"), body: categoryInputSchema } }, async (req) =>
    saveCategory(deps.db, await ctx(req), req.body, (req.params as { categoryId: string }).categoryId),
  );
  app.get(`${base}/tax-classes`, { schema: { tags: ["settings"], params: storeParams } }, async (req) => ({ items: await listTaxClasses(deps.db, await ctx(req)) }));
  app.put(`${base}/tax-classes`, { schema: { tags: ["settings"], params: storeParams, body: taxClassSchema } }, async (req) =>
    saveTaxClass(deps.db, await ctx(req), req.body),
  );

  // Inventory
  app.get(`${base}/inventory/locations`, { schema: { tags: ["inventory"], params: storeParams } }, async (req) => ({ items: await listLocations(deps.db, await ctx(req)) }));
  app.post(`${base}/inventory/locations`, { schema: { tags: ["inventory"], params: storeParams, body: locationSchema } }, async (req, reply) =>
    reply.status(201).send(await createLocation(deps.db, await ctx(req), req.body)),
  );
  app.post(
    `${base}/inventory/levels/query`,
    { schema: { tags: ["inventory"], params: storeParams, body: z.object({ variantIds: z.array(z.uuid()).min(1).max(500) }) } },
    async (req) => ({ items: await getInventoryLevels(deps.db, await ctx(req), req.body.variantIds) }),
  );
  app.post(`${base}/inventory/adjustments`, { schema: { tags: ["inventory"], params: storeParams, body: adjustStockSchema } }, async (req) =>
    adjustStock(deps.db, await ctx(req), req.body),
  );
  app.post(`${base}/inventory/transfers`, { schema: { tags: ["inventory"], params: storeParams, body: createTransferSchema } }, async (req, reply) =>
    reply.status(201).send(await createTransfer(deps.db, await ctx(req), req.body)),
  );
  app.post(`${base}/inventory/transfers/:transferId/ship`, { schema: { tags: ["inventory"], params: id("transferId") } }, async (req) =>
    shipTransfer(deps.db, await ctx(req), (req.params as { transferId: string }).transferId),
  );
  app.post(
    `${base}/inventory/transfers/:transferId/receive`,
    { schema: { tags: ["inventory"], params: id("transferId"), body: z.object({ receivedByLineId: z.record(z.uuid(), z.number().int().min(0)).optional() }).optional() } },
    async (req) => receiveTransfer(deps.db, await ctx(req), (req.params as { transferId: string }).transferId, req.body?.receivedByLineId),
  );

  // Pricing
  app.get(`${base}/price-lists`, { schema: { tags: ["pricing"], params: storeParams } }, async (req) => ({ items: await listPriceLists(deps.db, await ctx(req)) }));
  app.post(`${base}/price-lists`, { schema: { tags: ["pricing"], params: storeParams, body: createPriceListSchema } }, async (req, reply) =>
    reply.status(201).send(await createPriceList(deps.db, await ctx(req), req.body)),
  );
  app.put(`${base}/price-lists/:priceListId/prices`, { schema: { tags: ["pricing"], params: id("priceListId"), body: setPricesSchema } }, async (req) =>
    setPrices(deps.db, await ctx(req), (req.params as { priceListId: string }).priceListId, req.body),
  );
  app.delete(`${base}/price-lists/:priceListId`, { schema: { tags: ["pricing"], params: id("priceListId") } }, async (req, reply) => {
    await deletePriceList(deps.db, await ctx(req), (req.params as { priceListId: string }).priceListId);
    return reply.status(204).send();
  });
  app.post(`${base}/prices/query`, { schema: { tags: ["pricing"], params: storeParams, body: priceQuerySchema } }, async (req) => ({
    items: await getPrices(deps.db, await ctx(req), req.body),
  }));
};
