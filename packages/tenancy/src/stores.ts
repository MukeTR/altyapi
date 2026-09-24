import { z } from "zod";
import { conflict, currencySchema, invalid, isValidSlug, newId, notFound, slugify } from "@altyapi/commerce-core";
import { and, channels, eq, inArray, sql, storeDomains, stores, withTenantTx, type Database } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { assertCan, can, type OrganizationContext, type StoreContext, type StoreSnapshot } from "./context";

/** Subdomains that can never be used as store slugs on the platform root domain. */
export const RESERVED_STORE_SLUGS = new Set([
  "www", "api", "admin", "app", "panel", "dashboard", "mail", "smtp", "stores", "store", "cdn", "static",
  "assets", "media", "img", "status", "docs", "help", "support", "blog", "auth", "login", "mcp", "edge",
  "karmatik", "yanit", "altyapi", "billing", "checkout", "pay", "payments",
]);

export const SUPPORTED_LOCALES = ["tr", "en"] as const;

export const createStoreSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().optional(),
  defaultLocale: z.enum(SUPPORTED_LOCALES).default("tr"),
  defaultCurrency: currencySchema.default("TRY"),
  timezone: z.string().default("Europe/Istanbul"),
  countryCode: z.string().length(2).toUpperCase().default("TR"),
  contactEmail: z.email().optional(),
});

export const updateStoreSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  defaultLocale: z.enum(SUPPORTED_LOCALES).optional(),
  supportedLocales: z.array(z.enum(SUPPORTED_LOCALES)).min(1).optional(),
  supportedCurrencies: z.array(currencySchema).min(1).optional(),
  timezone: z.string().optional(),
  contactEmail: z.email().nullable().optional(),
  status: z.enum(["setup", "active", "paused"]).optional(),
});

function toSnapshot(row: typeof stores.$inferSelect): StoreSnapshot {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    defaultLocale: row.defaultLocale,
    supportedLocales: row.supportedLocales,
    defaultCurrency: row.defaultCurrency,
    supportedCurrencies: row.supportedCurrencies,
    timezone: row.timezone,
    countryCode: row.countryCode,
    routingVersion: row.routingVersion,
    contentVersion: row.contentVersion,
  };
}

function assertTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw invalid("errors.store.invalid_timezone", { timezone: tz });
  }
}

export async function createStore(
  db: Database,
  ctx: OrganizationContext,
  input: z.infer<typeof createStoreSchema>,
  platform: { rootDomain: string },
): Promise<StoreSnapshot> {
  assertCan(ctx, "store:manage");
  const slug = input.slug ?? slugify(input.name);
  if (!isValidSlug(slug) || slug.length < 3) throw invalid("errors.store.invalid_slug", { slug });
  if (RESERVED_STORE_SLUGS.has(slug)) throw conflict("errors.store.slug_reserved", { slug });
  assertTimezone(input.timezone);

  const storeId = newId();
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId }, async (tx) => {
    const taken = await tx.query.stores.findFirst({ where: eq(stores.slug, slug) });
    if (taken) throw conflict("errors.store.slug_taken", { slug });

    const [row] = await tx
      .insert(stores)
      .values({
        id: storeId,
        organizationId: ctx.organizationId,
        slug,
        name: input.name,
        defaultLocale: input.defaultLocale,
        supportedLocales: [input.defaultLocale],
        defaultCurrency: input.defaultCurrency,
        supportedCurrencies: [input.defaultCurrency],
        timezone: input.timezone,
        countryCode: input.countryCode,
        contactEmail: input.contactEmail ?? null,
      })
      .returning();

    await tx.insert(channels).values({
      id: newId(),
      organizationId: ctx.organizationId,
      storeId,
      type: "online_store",
      handle: "online-store",
      name: "Online Store",
      currency: input.defaultCurrency,
      isDefault: true,
    });

    // The platform subdomain is covered by the wildcard certificate, so it is active immediately.
    const hostname = `${slug}.${platform.rootDomain}`;
    await tx.insert(storeDomains).values({
      id: newId(),
      organizationId: ctx.organizationId,
      storeId,
      hostname,
      kind: "platform_subdomain",
      status: "active",
      isCanonical: true,
      activatedAt: new Date(),
      sslStatus: "active",
      verificationStatus: "active",
    });

    await appendEvent(tx, {
      type: "store.created",
      organizationId: ctx.organizationId,
      storeId,
      aggregateType: "store",
      aggregateId: storeId,
      payload: { storeId, slug, name: input.name },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId,
      action: "store.created",
      resourceType: "store",
      resourceId: storeId,
      after: { slug, name: input.name, hostname },
    });
    return toSnapshot(row!);
  });
}

/** Stores the principal can see: all stores for org-wide grants, otherwise only granted stores. */
export async function listStores(db: Database, ctx: OrganizationContext): Promise<StoreSnapshot[]> {
  const orgWide = ctx.principal.kind === "system" || ctx.principal.grants.some((g) => g.storeId === null);
  const storeIds = ctx.principal.grants.flatMap((g) => (g.storeId ? [g.storeId] : []));
  if (!orgWide && storeIds.length === 0) return [];
  return withTenantTx(db, { organizationId: ctx.organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(stores)
      .where(
        orgWide
          ? eq(stores.organizationId, ctx.organizationId)
          : and(eq(stores.organizationId, ctx.organizationId), inArray(stores.id, storeIds)),
      )
      .orderBy(stores.name);
    return rows.map(toSnapshot);
  });
}

/**
 * Resolves a store inside an organization and builds the StoreContext. Fails closed:
 * a store in another organization, or one the principal has no grant for, is "not found".
 */
export async function loadStoreContext(db: Database, ctx: OrganizationContext, storeId: string): Promise<StoreContext> {
  const row = await withTenantTx(db, { organizationId: ctx.organizationId, storeId }, (tx) =>
    tx.query.stores.findFirst({ where: and(eq(stores.id, storeId), eq(stores.organizationId, ctx.organizationId)) }),
  );
  if (!row || !can(ctx, "store:read", storeId)) throw notFound("store", storeId);
  return { ...ctx, storeId, store: toSnapshot(row) };
}

export async function updateStoreSettings(
  db: Database,
  ctx: StoreContext,
  input: z.infer<typeof updateStoreSettingsSchema>,
): Promise<StoreSnapshot> {
  assertCan(ctx, "settings:write");
  if (input.timezone) assertTimezone(input.timezone);
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const before = await tx.query.stores.findFirst({ where: eq(stores.id, ctx.storeId) });
    if (!before) throw notFound("store", ctx.storeId);
    const supportedLocales = input.supportedLocales ?? before.supportedLocales;
    const defaultLocale = input.defaultLocale ?? before.defaultLocale;
    if (!supportedLocales.includes(defaultLocale)) {
      throw invalid("errors.store.default_locale_not_supported");
    }
    const supportedCurrencies = input.supportedCurrencies ?? before.supportedCurrencies;
    if (!supportedCurrencies.includes(before.defaultCurrency)) {
      throw invalid("errors.store.default_currency_required");
    }
    const [after] = await tx
      .update(stores)
      .set({
        name: input.name ?? before.name,
        defaultLocale,
        supportedLocales,
        supportedCurrencies,
        timezone: input.timezone ?? before.timezone,
        contactEmail: input.contactEmail === undefined ? before.contactEmail : input.contactEmail,
        status: input.status ?? before.status,
        // status affects routing (paused stores render a maintenance page); content changes bust storefront cache
        routingVersion: input.status && input.status !== before.status ? sql`${stores.routingVersion} + 1` : before.routingVersion,
        contentVersion: sql`${stores.contentVersion} + 1`,
      })
      .where(eq(stores.id, ctx.storeId))
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "store.settings_updated",
      resourceType: "store",
      resourceId: ctx.storeId,
      before: pickChanged(before, input),
      after: pickChanged(after!, input),
    });
    return toSnapshot(after!);
  });
}

function pickChanged(row: Record<string, unknown>, input: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(input).map((k) => [k, row[k]]));
}
