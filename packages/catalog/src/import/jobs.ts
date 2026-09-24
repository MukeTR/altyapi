import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, deterministicId, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  categories,
  contentAssets,
  desc,
  eq,
  gt,
  importJobs,
  importProfiles,
  importRowErrors,
  importRows,
  inArray,
  isNull,
  productMedia,
  products,
  productTranslations,
  productVariants,
  sql,
  withTenantTx,
  type Database,
  type ImportOptions,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent, enqueueJob, type Queue } from "@altyapi/events";
import { ensureDefaultLocation, setOnHand } from "@altyapi/inventory";
import { importRemoteImage, setAssetReferences, type R2Storage } from "@altyapi/storage";
import { assertCan, loadStoreContext, systemPrincipal, type StoreContext } from "@altyapi/tenancy";
import { getProductTx, saveProductAggregate, type ProductInput } from "../products";
import { buildProductFromRows, type BuiltProduct, type RowError } from "./build";
import { autoMap, groupKeyFor, IMPORT_FIELD_KEYS, type ImportField } from "./mapping";
import { readRows, sampleRows, type ImportFormat } from "./parsers";

type Scope = { organizationId: string; storeId: string };
const scopeOf = (ctx: StoreContext): Scope => ({ organizationId: ctx.organizationId, storeId: ctx.storeId });

export const IMPORT_CHUNK_GROUPS = 50;
/** Wall-clock budget of one worker run; the job re-enqueues itself to continue. */
export const IMPORT_RUN_BUDGET_MS = 45_000;

const optionsSchema = z.object({
  xmlItemPath: z.string().max(200).optional(),
  xmlVariantPath: z.string().max(200).optional(),
  csvDelimiter: z.enum([",", ";", "\t", "|"]).optional(),
  locale: z.string().regex(/^[a-z]{2}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  matchBy: z.enum(["sku", "external_ref", "handle"]).default("sku"),
  groupBy: z.enum(["handle", "external_ref", "none"]).default("handle"),
  updateExisting: z.boolean().default(true),
  publishImported: z.boolean().default(false),
});

export const createImportSchema = z.object({
  assetId: z.uuid(),
  format: z.enum(["csv", "xlsx", "xml"]).optional(),
  profileId: z.uuid().optional(),
  options: optionsSchema.partial().default({}),
});

export const setMappingSchema = z.object({
  mapping: z.partialRecord(z.enum(IMPORT_FIELD_KEYS as [ImportField, ...ImportField[]]), z.string().min(1).max(300)),
  options: optionsSchema.partial().default({}),
  saveProfileName: z.string().trim().min(1).max(80).optional(),
});

function formatFromAsset(extension: string): ImportFormat {
  if (extension === "csv") return "csv";
  if (extension === "xlsx") return "xlsx";
  if (extension === "xml") return "xml";
  throw invalid("errors.import.unsupported_format");
}

async function loadJob(tx: Transaction, storeId: string, jobId: string) {
  const job = await tx.query.importJobs.findFirst({ where: and(eq(importJobs.id, jobId), eq(importJobs.storeId, storeId)) });
  if (!job) throw notFound("import_job", jobId);
  return job;
}

export async function createImportJob(db: Database, ctx: StoreContext, input: z.infer<typeof createImportSchema>) {
  assertCan(ctx, "catalog:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const asset = await tx.query.contentAssets.findFirst({ where: and(eq(contentAssets.id, input.assetId), eq(contentAssets.storeId, ctx.storeId), isNull(contentAssets.deletedAt)) });
    if (!asset || asset.bucket !== "imports-temporary") throw notFound("asset", input.assetId);
    if (asset.status !== "ready") throw new AppError("precondition_failed", "errors.asset.not_ready");
    const profile = input.profileId
      ? await tx.query.importProfiles.findFirst({ where: and(eq(importProfiles.id, input.profileId), eq(importProfiles.storeId, ctx.storeId)) })
      : undefined;
    if (input.profileId && !profile) throw notFound("import_profile", input.profileId);
    const format = input.format ?? profile?.format ?? formatFromAsset(asset.extension);
    const options: ImportOptions = { ...(profile?.options ?? {}), ...input.options };
    if (format === "xml" && !options.xmlItemPath) throw invalid("errors.import.xml_item_path_required");
    const id = newId();
    await tx.insert(importJobs).values({
      id,
      ...scopeOf(ctx),
      assetId: asset.id,
      profileId: profile?.id ?? null,
      format,
      status: "uploaded",
      mapping: profile?.mapping ?? null,
      options,
      requestedByPrincipalId: ctx.principal.userId,
    });
    await appendEvent(tx, { type: "import.requested", ...scopeOf(ctx), aggregateType: "import_job", aggregateId: id, payload: { importJobId: id } });
    await recordAudit(tx, { action: "import.created", resourceType: "import_job", resourceId: id, after: { format, assetId: asset.id } });
    return loadJob(tx, ctx.storeId, id);
  });
}

/** Worker: reads a sample, detects columns and proposes a mapping. */
export async function analyzeImport(db: Database, r2: R2Storage, scope: Scope, jobId: string) {
  const job = await withTenantTx(db, scope, (tx) => loadJob(tx, scope.storeId, jobId));
  if (job.status !== "uploaded") return;
  const asset = await withTenantTx(db, scope, (tx) => tx.query.contentAssets.findFirst({ where: eq(contentAssets.id, job.assetId) }));
  if (!asset) throw notFound("asset", job.assetId);
  await withTenantTx(db, scope, (tx) => tx.update(importJobs).set({ status: "analyzing" }).where(eq(importJobs.id, jobId)));
  try {
    const { columns, rows } = await sampleRows(await r2.getStream(asset.bucket, asset.objectKey), job.format, job.options);
    if (!columns.length) throw new Error("errors.import.no_columns");
    const mapping = job.mapping ?? autoMap(columns);
    await withTenantTx(db, scope, (tx) =>
      tx
        .update(importJobs)
        .set({ status: "awaiting_mapping", detectedColumns: columns, sampleRows: rows.map((r) => r.data), mapping })
        .where(eq(importJobs.id, jobId)),
    );
  } catch (err) {
    await withTenantTx(db, scope, (tx) =>
      tx.update(importJobs).set({ status: "failed", failureReason: (err as Error).message.slice(0, 500), finishedAt: new Date() }).where(eq(importJobs.id, jobId)),
    );
  }
}

/** Saves the mapping, optionally as a reusable profile, and builds a preview from the sample. */
export async function setImportMapping(db: Database, ctx: StoreContext, jobId: string, input: z.infer<typeof setMappingSchema>) {
  assertCan(ctx, "catalog:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const job = await loadJob(tx, ctx.storeId, jobId);
    if (!["awaiting_mapping", "ready", "previewing"].includes(job.status)) throw new AppError("precondition_failed", "errors.import.not_mappable");
    const columns = new Set(job.detectedColumns ?? []);
    for (const [field, column] of Object.entries(input.mapping)) {
      if (!columns.has(column)) throw invalid("errors.import.unknown_column", { field, column });
    }
    const options: ImportOptions = { ...job.options, ...input.options };
    if (!input.mapping.title && !(options.updateExisting && options.matchBy && input.mapping[options.matchBy === "external_ref" ? "external_ref" : options.matchBy])) {
      throw invalid("errors.import.title_mapping_required");
    }
    if (!input.mapping.price) throw invalid("errors.import.price_mapping_required");

    const locale = options.locale ?? ctx.store.defaultLocale;
    const currency = options.currency ?? ctx.store.defaultCurrency;
    const sample = (job.sampleRows ?? []).map((data, i) => ({ rowNumber: i + 1, data }));
    const groups = new Map<string, typeof sample>();
    for (const row of sample) {
      const key = groupKeyFor(row.data, input.mapping, options.groupBy ?? "handle", row.rowNumber);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const preview = [...groups.values()].slice(0, 10).map((rows) => {
      const { product, errors } = buildProductFromRows(rows, input.mapping, { ...options, locale, currency });
      return {
        rows: rows.map((r) => r.rowNumber),
        title: product?.input.translations[locale]?.title ?? null,
        handle: product?.handle ?? null,
        variants: product?.input.variants.map((v) => ({ sku: v.sku, optionValues: v.optionValues, price: v.price.toString(), stock: v.initialStock?.[0]?.quantity ?? null })) ?? [],
        images: product?.imageUrls.length ?? 0,
        errors,
      };
    });

    let profileId = job.profileId;
    if (input.saveProfileName) {
      const [profile] = await tx
        .insert(importProfiles)
        .values({ id: newId(), ...scopeOf(ctx), name: input.saveProfileName, format: job.format, mapping: input.mapping, options })
        .onConflictDoUpdate({ target: [importProfiles.storeId, importProfiles.name], set: { mapping: input.mapping, options, format: job.format, updatedAt: new Date() } })
        .returning();
      profileId = profile!.id;
    }
    await tx.update(importJobs).set({ mapping: input.mapping, options, preview, profileId, status: "ready" }).where(eq(importJobs.id, jobId));
    return loadJob(tx, ctx.storeId, jobId);
  });
}

export async function startImport(db: Database, queue: Queue, ctx: StoreContext, jobId: string) {
  assertCan(ctx, "catalog:write");
  const job = await withTenantTx(db, scopeOf(ctx), async (tx) => {
    const j = await loadJob(tx, ctx.storeId, jobId);
    if (j.status !== "ready") throw new AppError("precondition_failed", "errors.import.not_ready");
    await tx.update(importJobs).set({ status: "processing", startedAt: new Date() }).where(eq(importJobs.id, jobId));
    await recordAudit(tx, { action: "import.started", resourceType: "import_job", resourceId: jobId });
    return j;
  });
  await enqueueJob(queue, { id: deterministicId(`import:${job.id}:start`), type: "catalog.import.run", payload: { jobId }, ...scopeOf(ctx) });
  return { ...job, status: "processing" as const };
}

export async function cancelImport(db: Database, ctx: StoreContext, jobId: string) {
  assertCan(ctx, "catalog:write");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const j = await loadJob(tx, ctx.storeId, jobId);
    if (["completed", "completed_with_errors", "failed", "cancelled"].includes(j.status)) return j;
    await tx.update(importJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(importJobs.id, jobId));
    await tx.delete(importRows).where(eq(importRows.jobId, jobId));
    return { ...j, status: "cancelled" as const };
  });
}

export async function listImportJobs(db: Database, ctx: StoreContext) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), (tx) =>
    tx.select().from(importJobs).where(eq(importJobs.storeId, ctx.storeId)).orderBy(desc(importJobs.createdAt)).limit(50),
  );
}

export async function getImportJob(db: Database, ctx: StoreContext, jobId: string) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), async (tx) => {
    const job = await loadJob(tx, ctx.storeId, jobId);
    const errors = await tx.select().from(importRowErrors).where(eq(importRowErrors.jobId, jobId)).orderBy(asc(importRowErrors.rowNumber)).limit(200);
    return { ...job, errorsPreview: errors.map((e) => ({ rowNumber: e.rowNumber, errors: e.errors })) };
  });
}

export async function listImportProfiles(db: Database, ctx: StoreContext) {
  assertCan(ctx, "catalog:read");
  return withTenantTx(db, scopeOf(ctx), (tx) => tx.select().from(importProfiles).where(eq(importProfiles.storeId, ctx.storeId)).orderBy(asc(importProfiles.name)));
}

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

export interface ImportRunDeps {
  db: Database;
  r2: R2Storage;
  queue: Queue;
}

/** Pass 1: streams the whole file into import_rows with group keys (idempotent per row). */
async function stageRows(deps: ImportRunDeps, scope: Scope, jobId: string) {
  const job = await withTenantTx(deps.db, scope, (tx) => loadJob(tx, scope.storeId, jobId));
  const asset = await withTenantTx(deps.db, scope, (tx) => tx.query.contentAssets.findFirst({ where: eq(contentAssets.id, job.assetId) }));
  if (!asset) throw notFound("asset", job.assetId);
  const mapping = job.mapping ?? {};
  let batch: (typeof importRows.$inferInsert)[] = [];
  let total = 0;
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    await withTenantTx(deps.db, scope, (tx) => tx.insert(importRows).values(rows).onConflictDoNothing());
  };
  for await (const row of readRows(await deps.r2.getStream(asset.bucket, asset.objectKey), job.format, job.options)) {
    total++;
    batch.push({
      jobId,
      rowNumber: row.rowNumber,
      ...scope,
      groupKey: groupKeyFor(row.data, mapping, job.options.groupBy ?? "handle", row.rowNumber),
      data: row.data,
    });
    if (batch.length >= 500) await flush();
  }
  await flush();
  await withTenantTx(deps.db, scope, (tx) => tx.update(importJobs).set({ totalRows: total, stagedAt: new Date() }).where(eq(importJobs.id, jobId)));
}

async function findExisting(tx: Transaction, scope: Scope, built: BuiltProduct, matchBy: string, locale: string): Promise<string | null> {
  if (matchBy === "external_ref" && built.externalRef) {
    const p = await tx.query.products.findFirst({ where: and(eq(products.storeId, scope.storeId), eq(products.externalRef, built.externalRef)) });
    return p?.id ?? null;
  }
  if (matchBy === "handle") {
    const t = await tx.query.productTranslations.findFirst({
      where: and(eq(productTranslations.storeId, scope.storeId), eq(productTranslations.locale, locale), eq(productTranslations.handle, built.handle)),
    });
    return t?.productId ?? null;
  }
  const skus = built.input.variants.map((v) => v.sku).filter((s): s is string => !!s);
  if (!skus.length) return null;
  const v = await tx
    .select({ productId: productVariants.productId })
    .from(productVariants)
    .where(and(eq(productVariants.storeId, scope.storeId), inArray(productVariants.sku, skus), isNull(productVariants.archivedAt)))
    .limit(1);
  return v[0]?.productId ?? null;
}

type ExistingProduct = Awaited<ReturnType<typeof getProductTx>>;

/**
 * Overlays imported values on an existing product: variants are matched by SKU (then by
 * option values); unmatched imported variants are added; option values are merged.
 */
function mergeIntoExisting(existing: ExistingProduct, built: BuiltProduct, locale: string): { input: ProductInput; stockUpdates: { variantIndex: number; quantity: number }[] } {
  const loc = locale;
  const has = (f: ImportField) => built.provided.has(f);
  const existingOptionNames = existing.options.map((o) => (o.name[loc] ?? Object.values(o.name)[0] ?? "").toLocaleLowerCase("tr"));
  const importedOptionNames = built.input.options.map((o) => (o.name[loc] ?? "").toLocaleLowerCase("tr"));
  if (existing.options.length && importedOptionNames.length && existingOptionNames.join("|") !== importedOptionNames.join("|")) {
    throw new AppError("validation_failed", "errors.import.option_structure_mismatch");
  }
  const options = existing.options.map((o, i) => {
    const imported = built.input.options[i];
    const values: { id?: string; value: Record<string, string>; swatchColor: string | null }[] = o.values.map((v) => ({
      id: v.id,
      value: v.value,
      swatchColor: v.swatchColor,
    }));
    for (const iv of imported?.values ?? []) {
      const label = (iv.value[loc] ?? "").toLocaleLowerCase("tr");
      const known = values.some((v) => (v.value[loc] ?? Object.values(v.value)[0] ?? "").toLocaleLowerCase("tr") === label);
      if (!known) values.push({ value: iv.value, swatchColor: null });
    }
    return { id: o.id, name: o.name, values };
  });
  const finalOptions = existing.options.length ? options : built.input.options;

  const labelOf = (valueId: string) => {
    for (const o of existing.options) {
      const v = o.values.find((x) => x.id === valueId);
      if (v) return { optionIndex: existing.options.indexOf(o), label: v.value[loc] ?? Object.values(v.value)[0] ?? "" };
    }
    return null;
  };
  const existingVariants = existing.variants.map((v) => {
    const labels: string[] = new Array(existing.options.length).fill("");
    for (const id of v.optionValueIds) {
      const l = labelOf(id);
      if (l) labels[l.optionIndex] = l.label;
    }
    return { v, labels };
  });

  const variants: ProductInput["variants"] = existingVariants.map(({ v, labels }) => ({
    id: v.id,
    optionValues: labels,
    sku: v.sku,
    barcode: v.barcode,
    price: v.price?.amount ?? 0n,
    compareAtPrice: v.price?.compareAtAmount ?? null,
    cost: v.cost,
    weightGrams: v.weightGrams,
    requiresShipping: v.requiresShipping,
    trackInventory: v.trackInventory,
    allowBackorder: v.allowBackorder,
    taxClassId: v.taxClassId,
    digitalAssetId: v.digitalAssetId,
    externalRef: v.externalRef,
  }));
  const stockUpdates: { variantIndex: number; quantity: number }[] = [];
  for (const iv of built.input.variants) {
    let idx = iv.sku ? variants.findIndex((v) => v.sku === iv.sku) : -1;
    if (idx < 0) idx = variants.findIndex((v) => v.optionValues.map((x) => x.toLocaleLowerCase("tr")).join("|") === iv.optionValues.map((x) => x.toLocaleLowerCase("tr")).join("|"));
    const qty = iv.initialStock?.[0]?.quantity;
    if (idx >= 0) {
      const cur = variants[idx]!;
      variants[idx] = {
        ...cur,
        price: has("price") ? iv.price : cur.price,
        compareAtPrice: has("compare_at_price") ? iv.compareAtPrice ?? null : cur.compareAtPrice ?? null,
        cost: has("cost") && iv.cost != null ? iv.cost : cur.cost ?? null,
        barcode: has("barcode") && iv.barcode ? iv.barcode : cur.barcode ?? null,
        weightGrams: has("weight_grams") && iv.weightGrams != null ? iv.weightGrams : cur.weightGrams ?? null,
      };
      if (qty !== undefined) stockUpdates.push({ variantIndex: idx, quantity: qty });
    } else {
      variants.push(iv);
    }
  }

  const tr = existing.translations as Record<string, { title: string; handle: string; descriptionHtml: string; seoTitle: string | null; seoDescription: string | null }>;
  const imported = built.input.translations[loc]!;
  const translations = Object.fromEntries(
    Object.entries(tr).map(([l, t]) => [
      l,
      l === loc
        ? {
            title: has("title") ? imported.title : t.title,
            handle: t.handle,
            descriptionHtml: has("description") ? imported.descriptionHtml : t.descriptionHtml,
            seoTitle: has("seo_title") ? imported.seoTitle ?? null : t.seoTitle,
            seoDescription: has("seo_description") ? imported.seoDescription ?? null : t.seoDescription,
          }
        : t,
    ]),
  );
  return {
    input: {
      status: has("status") ? built.input.status : existing.status,
      kind: existing.kind,
      translations,
      vendorName: has("vendor") ? built.input.vendorName ?? null : existing.vendor?.name ?? null,
      productType: has("product_type") ? built.input.productType ?? null : existing.productType,
      categoryId: existing.categoryId,
      taxClassId: existing.taxClassId,
      tags: has("tags") ? built.input.tags : existing.tags,
      collectionIds: [],
      options: finalOptions,
      variants,
      media: existing.media.map((m) => ({ assetId: m.assetId, alt: m.alt, variantIndexes: [] })),
      attributes: existing.attributes,
      weightGrams: existing.weightGrams,
      dimensionsMm: existing.dimensionsMm,
      currency: built.input.currency,
      externalRef: existing.externalRef ?? built.externalRef,
    } as ProductInput,
    stockUpdates,
  };
}

async function recordErrors(tx: Transaction, scope: Scope, jobId: string, errors: RowError[], rows: { rowNumber: number; data: Record<string, string> }[]) {
  const byRow = new Map<number, { field: string; message: string }[]>();
  for (const e of errors) byRow.set(e.rowNumber, [...(byRow.get(e.rowNumber) ?? []), { field: e.field, message: e.message }]);
  for (const [rowNumber, errs] of byRow) {
    await tx.insert(importRowErrors).values({ id: newId(), jobId, ...scope, rowNumber, errors: errs, raw: rows.find((r) => r.rowNumber === rowNumber)?.data ?? {} });
  }
}

/**
 * Pass 2: processes product groups in key order within a time budget, checkpointing after
 * every chunk. Returns "continue" when the job must be re-enqueued to resume.
 */
export async function runImportChunk(deps: ImportRunDeps, scope: Scope, jobId: string): Promise<"continue" | "done"> {
  const started = Date.now();
  let job = await withTenantTx(deps.db, scope, (tx) => loadJob(tx, scope.storeId, jobId));
  if (job.status !== "processing") return "done";
  if (!job.stagedAt) {
    await stageRows(deps, scope, jobId);
    job = await withTenantTx(deps.db, scope, (tx) => loadJob(tx, scope.storeId, jobId));
  }
  const ctx = await loadStoreContext(deps.db, { organizationId: scope.organizationId, principal: systemPrincipal() }, scope.storeId);
  const locale = job.options.locale ?? ctx.store.defaultLocale;
  const currency = job.options.currency ?? ctx.store.defaultCurrency;
  const mapping = (job.mapping ?? {}) as Partial<Record<ImportField, string>>;
  const matchBy = job.options.matchBy ?? "sku";
  const defaultLocation = await withTenantTx(deps.db, scope, (tx) => ensureDefaultLocation(tx, scope));

  while (Date.now() - started < IMPORT_RUN_BUDGET_MS) {
    const current = await withTenantTx(deps.db, scope, (tx) => loadJob(tx, scope.storeId, jobId));
    if (current.status !== "processing") return "done"; // cancelled meanwhile
    const keys = await withTenantTx(deps.db, scope, (tx) =>
      tx
        .selectDistinct({ groupKey: importRows.groupKey })
        .from(importRows)
        .where(and(eq(importRows.jobId, jobId), current.lastProcessedGroup ? gt(importRows.groupKey, current.lastProcessedGroup) : undefined))
        .orderBy(asc(importRows.groupKey))
        .limit(IMPORT_CHUNK_GROUPS),
    );
    if (!keys.length) {
      await finishImport(deps, scope, jobId);
      return "done";
    }
    let created = 0;
    let updated = 0;
    let failed = 0;
    let processedRows = 0;
    for (const { groupKey } of keys) {
      const rows = await withTenantTx(deps.db, scope, (tx) =>
        tx.select().from(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.groupKey, groupKey))).orderBy(asc(importRows.rowNumber)),
      );
      processedRows += rows.length;
      const { product, errors } = buildProductFromRows(rows, mapping, { ...job.options, locale, currency });
      if (errors.length) failed += new Set(errors.map((e) => e.rowNumber)).size;
      let groupErrors: RowError[] = errors;
      let productId: string | null = null;
      if (product) {
        try {
          productId = await withTenantTx(deps.db, scope, async (tx) => {
            if (product.categoryHandle) {
              const cat = await tx.query.categories.findFirst({ where: and(eq(categories.storeId, scope.storeId), eq(categories.handle, product.categoryHandle)) });
              if (cat) product.input.categoryId = cat.id;
            }
            const existingId = await findExisting(tx, scope, product, matchBy, locale);
            if (existingId && !job.options.updateExisting) throw new AppError("conflict", "errors.import.already_exists");
            if (existingId) {
              const existing = await getProductTx(tx, ctx, existingId);
              const merged = mergeIntoExisting(existing, product, locale);
              if (product.input.categoryId) merged.input.categoryId = product.input.categoryId;
              await saveProductAggregate(tx, ctx, merged.input, existingId);
              const after = await getProductTx(tx, ctx, existingId);
              for (const s of merged.stockUpdates) {
                const sku = merged.input.variants[s.variantIndex]!.sku;
                const variant = after.variants.find((v) => (sku ? v.sku === sku : false)) ?? after.variants[s.variantIndex];
                if (variant?.trackInventory) {
                  await setOnHand(tx, scope, { variantId: variant.id, locationId: defaultLocation, quantity: s.quantity, reason: "import", idempotencyKey: `import:${jobId}:${variant.id}` });
                }
              }
              updated++;
              return existingId;
            }
            const { productId: id } = await saveProductAggregate(tx, ctx, product.input);
            created++;
            return id;
          });
        } catch (err) {
          const message = err instanceof AppError ? err.messageKey : "errors.import.row_failed";
          groupErrors = [...errors, ...product.rowNumbers.map((rowNumber) => ({ rowNumber, field: "*", message }))];
          failed += product.rowNumbers.length;
        }
      }
      if (productId && product?.imageUrls.length) {
        const assetIds: string[] = [];
        for (const url of product.imageUrls) {
          try {
            assetIds.push(await importRemoteImage(deps.db, deps.r2, scope, url));
          } catch (err) {
            groupErrors.push({ rowNumber: product.rowNumbers[0] ?? rows[0]!.rowNumber, field: "image_urls", message: `errors.import.image_failed:${(err as Error).message}` });
          }
        }
        if (assetIds.length) {
          await withTenantTx(deps.db, scope, async (tx) => {
            const existingMedia = await tx.select().from(productMedia).where(eq(productMedia.productId, productId!));
            let position = existingMedia.length;
            for (const assetId of assetIds) {
              await tx.insert(productMedia).values({ id: newId(), ...scope, productId: productId!, assetId, position: position++ });
            }
            await setAssetReferences(tx, scope, { type: "product", id: productId! }, [...existingMedia.map((m) => m.assetId), ...assetIds]);
          });
        }
      }
      await withTenantTx(deps.db, scope, async (tx) => {
        if (groupErrors.length) await recordErrors(tx, scope, jobId, groupErrors, rows);
        await tx.update(importRows).set({ processed: true }).where(and(eq(importRows.jobId, jobId), eq(importRows.groupKey, groupKey)));
      });
    }
    await withTenantTx(deps.db, scope, (tx) =>
      tx
        .update(importJobs)
        .set({
          lastProcessedGroup: keys.at(-1)!.groupKey,
          processedRows: sql`${importJobs.processedRows} + ${processedRows}`,
          createdCount: sql`${importJobs.createdCount} + ${created}`,
          updatedCount: sql`${importJobs.updatedCount} + ${updated}`,
          failedCount: sql`${importJobs.failedCount} + ${failed}`,
        })
        .where(eq(importJobs.id, jobId)),
    );
  }
  return "continue";
}

function csvCell(v: string): string {
  // Neutralize spreadsheet formula injection in the error report.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

async function finishImport(deps: ImportRunDeps, scope: Scope, jobId: string) {
  const errors = await withTenantTx(deps.db, scope, (tx) => tx.select().from(importRowErrors).where(eq(importRowErrors.jobId, jobId)).orderBy(asc(importRowErrors.rowNumber)));
  let reportAssetId: string | null = null;
  if (errors.length) {
    const columns = [...new Set(errors.flatMap((e) => Object.keys(e.raw)))];
    const lines = [["row", "errors", ...columns].map(csvCell).join(";")];
    for (const e of errors) {
      lines.push([String(e.rowNumber), e.errors.map((x) => `${x.field}: ${x.message}`).join(" | "), ...columns.map((c) => e.raw[c] ?? "")].map(csvCell).join(";"));
    }
    const body = Buffer.from(`﻿${lines.join("\r\n")}`, "utf8");
    reportAssetId = newId();
    const objectKey = `stores/${scope.storeId}/exports/import-errors/${jobId}.csv`;
    await deps.r2.put("exports-temporary", objectKey, body, "text/csv");
    await withTenantTx(deps.db, scope, (tx) =>
      tx.insert(contentAssets).values({
        id: reportAssetId!,
        ...scope,
        bucket: "exports-temporary",
        objectKey,
        kind: "data",
        status: "ready",
        contentType: "text/csv",
        extension: "csv",
        byteSize: body.length,
        contentHash: createHash("sha256").update(body).digest("hex"),
        originalFilename: `import-errors-${jobId}.csv`,
        readyAt: new Date(),
      }),
    );
  }
  await withTenantTx(deps.db, scope, async (tx) => {
    const [job] = await tx
      .update(importJobs)
      .set({ status: errors.length ? "completed_with_errors" : "completed", finishedAt: new Date(), errorReportAssetId: reportAssetId })
      .where(eq(importJobs.id, jobId))
      .returning();
    await tx.delete(importRows).where(eq(importRows.jobId, jobId));
    await recordAudit(tx, {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      action: "import.finished",
      resourceType: "import_job",
      resourceId: jobId,
      after: { created: job?.createdCount, updated: job?.updatedCount, failed: job?.failedCount },
    });
  });
}

/** Worker entry: runs one chunk and re-enqueues a continuation with a deterministic id. */
export async function runImportJob(deps: ImportRunDeps, scope: Scope, jobId: string, sequence: number): Promise<void> {
  const outcome = await runImportChunk(deps, scope, jobId);
  if (outcome === "continue") {
    await enqueueJob(deps.queue, {
      id: deterministicId(`import:${jobId}:${sequence + 1}`),
      type: "catalog.import.run",
      payload: { jobId, sequence: sequence + 1 },
      ...scope,
    });
  }
}
