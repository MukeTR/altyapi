import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assertStoreLocales, conflict, invalid, isValidSlug, newId, notFound, slugify } from "@altyapi/commerce-core";
import { and, asc, eq, ne, siteLocations, sql, withTenantTx, type Database, type DbExecutor, type OpeningHours } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import {
  EMPTY_OPENING_HOURS,
  createSiteLocationSchema,
  locationProblems,
  updateSiteLocationSchema,
  type CreateSiteLocationInput,
  type SiteLocationStatus,
  type UpdateSiteLocationInput,
} from "@altyapi/site";
import { assertCan, tenantScope, type StoreContext } from "../context";
import { bumpStoreVersions, lockSiteProfile } from "./shared";

export type SiteLocationRow = typeof siteLocations.$inferSelect;

/**
 * Branches, offices and service points (K3). Primary-location invariant, kept by every write:
 * hidden locations are never primary, and whenever the store has an active location exactly
 * one active location is primary (the one the imprint and the JSON-LD organization use). The
 * first active location becomes primary on its own; choosing another primary moves the flag.
 */

export async function listLocations(db: Database, ctx: StoreContext, filter: { status?: SiteLocationStatus } = {}): Promise<SiteLocationRow[]> {
  assertCan(ctx, "site:read");
  return withTenantTx(db, tenantScope(ctx), (tx) =>
    tx
      .select()
      .from(siteLocations)
      .where(and(eq(siteLocations.storeId, ctx.storeId), filter.status ? eq(siteLocations.status, filter.status) : undefined))
      .orderBy(asc(siteLocations.position), asc(siteLocations.createdAt)),
  );
}

export async function getLocation(db: Database, ctx: StoreContext, locationId: string): Promise<SiteLocationRow> {
  assertCan(ctx, "site:read");
  const row = await withTenantTx(db, tenantScope(ctx), (tx) => findLocation(tx, ctx.storeId, locationId));
  if (!row) throw notFound("site_location", locationId);
  return row;
}

function findLocation(tx: DbExecutor, storeId: string, locationId: string) {
  return tx.query.siteLocations.findFirst({ where: and(eq(siteLocations.id, locationId), eq(siteLocations.storeId, storeId)) });
}

/** Localized texts must be in the store's languages; the name needs the default language. */
function assertLocationLocales(ctx: StoreContext, name: Record<string, string | undefined> | undefined, hours: OpeningHours | undefined) {
  if (name) {
    assertStoreLocales(name, ctx.store.supportedLocales, "name");
    if (!name[ctx.store.defaultLocale]?.trim()) throw invalid("errors.site.location.name_required", { locale: ctx.store.defaultLocale });
  }
  if (hours) {
    if (hours.note) assertStoreLocales(hours.note, ctx.store.supportedLocales, "openingHours.note");
    hours.specialDays.forEach((d, i) => d.label && assertStoreLocales(d.label, ctx.store.supportedLocales, `openingHours.specialDays.${i}.label`));
  }
}

function assertCrossFields(location: Pick<SiteLocationRow, "address" | "geo" | "serviceArea">) {
  const problems = locationProblems(location);
  if (problems.length) throw invalid(problems[0]!, { problems });
}

async function assertSlugFree(tx: DbExecutor, storeId: string, slug: string, exceptId?: string) {
  if (!isValidSlug(slug)) throw invalid("errors.site.location.invalid_slug", { slug });
  const taken = await tx.query.siteLocations.findFirst({
    where: and(eq(siteLocations.storeId, storeId), eq(siteLocations.slug, slug), exceptId ? ne(siteLocations.id, exceptId) : undefined),
    columns: { id: true },
  });
  if (taken) throw conflict("errors.site.location.slug_taken", { slug });
}

/** Clears the primary flag of every location but `keepId`; runs before setting a new primary (the unique index is not deferrable). */
async function clearPrimary(tx: DbExecutor, storeId: string, keepId: string) {
  await tx
    .update(siteLocations)
    .set({ isPrimary: false })
    .where(and(eq(siteLocations.storeId, storeId), eq(siteLocations.isPrimary, true), ne(siteLocations.id, keepId)));
}

/**
 * Restores the invariant after a write: when no location is primary, the first active one
 * (by position, then age) becomes primary. Returns the primary location id, if any.
 */
async function settlePrimary(tx: DbExecutor, storeId: string): Promise<string | null> {
  const primary = await tx.query.siteLocations.findFirst({
    where: and(eq(siteLocations.storeId, storeId), eq(siteLocations.isPrimary, true)),
    columns: { id: true },
  });
  if (primary) return primary.id;
  const [next] = await tx
    .select({ id: siteLocations.id })
    .from(siteLocations)
    .where(and(eq(siteLocations.storeId, storeId), eq(siteLocations.status, "active")))
    .orderBy(asc(siteLocations.position), asc(siteLocations.createdAt))
    .limit(1);
  if (!next) return null;
  await tx.update(siteLocations).set({ isPrimary: true }).where(eq(siteLocations.id, next.id));
  return next.id;
}

async function afterWrite(
  tx: DbExecutor,
  ctx: StoreContext,
  locationId: string,
  change: "created" | "updated" | "deleted",
  audit: { before?: unknown; after?: unknown },
) {
  const primaryLocationId = await settlePrimary(tx, ctx.storeId);
  // Locations render on the storefront (contact facts, hours, map, JSON-LD).
  const { contentVersion } = await bumpStoreVersions(tx, ctx.storeId, { modules: false });
  await appendEvent(tx, {
    type: "site.locations_changed",
    ...tenantScope(ctx),
    aggregateType: "site_location",
    aggregateId: locationId,
    payload: { locationId, change, primaryLocationId, contentVersion },
  });
  await recordAudit(tx, {
    ...tenantScope(ctx),
    action: `site.location_${change}`,
    resourceType: "site_location",
    resourceId: locationId,
    ...audit,
    metadata: { primaryLocationId },
  });
}

export async function createLocation(db: Database, ctx: StoreContext, input: CreateSiteLocationInput): Promise<SiteLocationRow> {
  assertCan(ctx, "site:write");
  const data = createSiteLocationSchema.parse(input);
  assertLocationLocales(ctx, data.name, data.openingHours);
  const status = data.status ?? "active";
  if (data.isPrimary && status !== "active") throw invalid("errors.site.location.primary_hidden");
  const values = {
    address: data.address ?? null,
    geo: data.geo ?? null,
    serviceArea: data.serviceArea ?? null,
  };
  assertCrossFields(values);
  const slug = data.slug || slugify(data.name[ctx.store.defaultLocale as keyof typeof data.name] ?? "");

  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    await assertSlugFree(tx, ctx.storeId, slug);
    const id = newId();
    if (data.isPrimary) await clearPrimary(tx, ctx.storeId, id);
    const position =
      data.position ??
      (await tx
        .select({ next: sql<number>`coalesce(max(${siteLocations.position}) + 1, 0)::int` })
        .from(siteLocations)
        .where(eq(siteLocations.storeId, ctx.storeId))
        .then((r) => r[0]?.next ?? 0));
    const [row] = await tx
      .insert(siteLocations)
      .values({
        id,
        ...tenantScope(ctx),
        name: data.name as Record<string, string>,
        slug,
        ...values,
        phone: data.phone ?? null,
        email: data.email ?? null,
        whatsapp: data.whatsapp ?? null,
        openingHours: data.openingHours ?? EMPTY_OPENING_HOURS,
        isPrimary: data.isPrimary ?? false,
        position,
        status,
      })
      .returning();
    await afterWrite(tx, ctx, id, "created", { after: row });
    return (await findLocation(tx, ctx.storeId, id))!;
  });
}

const PATCHABLE = [
  "name",
  "slug",
  "address",
  "geo",
  "phone",
  "email",
  "whatsapp",
  "openingHours",
  "serviceArea",
  "isPrimary",
  "position",
  "status",
] as const satisfies readonly (keyof SiteLocationRow)[];

export async function updateLocation(db: Database, ctx: StoreContext, locationId: string, input: UpdateSiteLocationInput): Promise<SiteLocationRow> {
  assertCan(ctx, "site:write");
  const patch = updateSiteLocationSchema.parse(input);
  assertLocationLocales(ctx, patch.name, patch.openingHours);

  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    const before = await findLocation(tx, ctx.storeId, locationId);
    if (!before) throw notFound("site_location", locationId);

    const next: SiteLocationRow = { ...before };
    for (const f of PATCHABLE) {
      if (patch[f] !== undefined) (next as Record<string, unknown>)[f] = patch[f];
    }
    if (patch.slug === "") next.slug = before.slug;
    assertCrossFields(next);

    // Primary rules: a hidden location cannot be chosen; the primary flag is moved, never
    // dropped; hiding the primary needs another primary first unless no other active location
    // exists (then the store simply has no primary until one becomes active).
    if (patch.isPrimary === true && next.status !== "active") throw invalid("errors.site.location.primary_hidden");
    if (before.isPrimary && patch.isPrimary === false) throw invalid("errors.site.location.primary_required");
    if (before.isPrimary && next.status !== "active") {
      const otherActive = await tx.query.siteLocations.findFirst({
        where: and(eq(siteLocations.storeId, ctx.storeId), eq(siteLocations.status, "active"), ne(siteLocations.id, locationId)),
        columns: { id: true },
      });
      if (otherActive) throw invalid("errors.site.location.primary_hidden");
      next.isPrimary = false;
    }

    const changed = PATCHABLE.filter((f) => !isDeepStrictEqual(before[f], next[f]));
    if (!changed.length) return before;
    if (changed.includes("slug")) await assertSlugFree(tx, ctx.storeId, next.slug, locationId);
    if (next.isPrimary && !before.isPrimary) await clearPrimary(tx, ctx.storeId, locationId);

    await tx
      .update(siteLocations)
      .set(Object.fromEntries(changed.map((f) => [f, next[f]])))
      .where(eq(siteLocations.id, locationId));
    await afterWrite(tx, ctx, locationId, "updated", {
      before: Object.fromEntries(changed.map((f) => [f, before[f]])),
      after: Object.fromEntries(changed.map((f) => [f, next[f]])),
    });
    return (await findLocation(tx, ctx.storeId, locationId))!;
  });
}

/** Removes a location; when it was primary, the next active location becomes primary. */
export async function deleteLocation(db: Database, ctx: StoreContext, locationId: string): Promise<void> {
  assertCan(ctx, "site:write");
  await withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    const before = await findLocation(tx, ctx.storeId, locationId);
    if (!before) throw notFound("site_location", locationId);
    await tx.delete(siteLocations).where(eq(siteLocations.id, locationId));
    await afterWrite(tx, ctx, locationId, "deleted", { before });
  });
}

/** The new display order: every location of the store exactly once. */
export const reorderSiteLocationsSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(500),
});

export type ReorderSiteLocationsInput = z.input<typeof reorderSiteLocationsSchema>;

/**
 * Sets the display order of the store's locations (site:write). `ids` must list every location
 * once; positions become 0..n-1 in that order. Order is what the storefront lists and what
 * decides which active location is promoted when the store has no primary yet. The storefront
 * renders the order, so a change bumps the content version; each moved location announces
 * site.locations_changed and the reorder is audited once with the full before/after order.
 */
export async function reorderLocations(db: Database, ctx: StoreContext, input: ReorderSiteLocationsInput): Promise<SiteLocationRow[]> {
  assertCan(ctx, "site:write");
  const { ids } = reorderSiteLocationsSchema.parse(input);
  const ordered = (tx: DbExecutor) =>
    tx
      .select()
      .from(siteLocations)
      .where(eq(siteLocations.storeId, ctx.storeId))
      .orderBy(asc(siteLocations.position), asc(siteLocations.createdAt));

  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    const rows = await ordered(tx);
    const known = new Set(rows.map((r) => r.id));
    if (new Set(ids).size !== ids.length || ids.length !== rows.length || ids.some((id) => !known.has(id))) {
      throw invalid("errors.site.location.reorder_mismatch", { expected: rows.length, received: ids.length });
    }
    const target = new Map(ids.map((id, i) => [id, i]));
    const moved = rows.filter((r) => r.position !== target.get(r.id));
    if (!moved.length) return rows;

    for (const r of moved) {
      await tx.update(siteLocations).set({ position: target.get(r.id)! }).where(eq(siteLocations.id, r.id));
    }
    const primaryLocationId = await settlePrimary(tx, ctx.storeId);
    const { contentVersion } = await bumpStoreVersions(tx, ctx.storeId, { modules: false });
    for (const r of moved) {
      await appendEvent(tx, {
        type: "site.locations_changed",
        ...tenantScope(ctx),
        aggregateType: "site_location",
        aggregateId: r.id,
        payload: { locationId: r.id, change: "updated", primaryLocationId, contentVersion },
      });
    }
    await recordAudit(tx, {
      ...tenantScope(ctx),
      action: "site.locations_reordered",
      resourceType: "site_location",
      resourceId: ctx.storeId,
      before: { order: rows.map((r) => r.id) },
      after: { order: ids },
      metadata: { primaryLocationId, moved: moved.map((r) => r.id) },
    });
    return ordered(tx);
  });
}
