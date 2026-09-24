import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { listSitemapEntries } from "@altyapi/catalog";
import { channels, and, eq, isNull, or, redirects, siteProfiles, withTenantTx } from "@altyapi/database";
import { listLivePages, loadLiveSnapshot, loadSite, pageContentLocales, pagePath, resolveRoute } from "@altyapi/theme-engine";
import { loadActiveModules } from "@altyapi/site";
import { listLiveEntries, nextScheduleBoundary } from "@altyapi/content";
import { moduleDisabled } from "@altyapi/tenancy";
import { AppError } from "@altyapi/commerce-core";
import { publicTrackingConfig, recordCookieConsent, subscribeNewsletter } from "@altyapi/marketing";
import type { AppDeps } from "../deps";
import { storefrontContext } from "../plugins/storefront-auth";

const siteQuery = z.object({ locale: z.string().max(10).optional(), currency: z.string().length(3).optional() });

/** Shared-cache lifetime of entry lists; shortened to the next scheduled publish or take-down. */
const ENTRY_LIST_TTL_SECONDS = 300;

const entriesQuery = z.object({
  /** Content type key or id. */
  type: z.string().min(1).max(64),
  locale: z.string().max(10).optional(),
  sort: z.enum(["newest", "oldest", "position", "title", "updated"]).optional(),
  /** Taxonomy term entry ids (repeatable): entries classified with any of them. */
  term: z.union([z.uuid(), z.array(z.uuid()).max(20)]).optional(),
  featured: z.stringbool().optional(),
  /** Children of this entry (hierarchical types). */
  parent: z.uuid().optional(),
  /** For taxonomy types: the type whose archive URLs the terms get. */
  archiveOf: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  /** nextCursor of the previous page. */
  cursor: z.string().max(500).optional(),
});

/**
 * Read API consumed by the storefront server. Responses carry shared-cache headers derived
 * from the content; preview responses are never cacheable.
 */
export const storefrontApiRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const cacheHeader = (preview: boolean, ttl: number) =>
    preview || ttl <= 0 ? "private, no-store" : `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 10}`;

  app.get("/storefront/v1/site", { config: { rateLimit: false }, schema: { hide: true, querystring: siteQuery } }, async (req, reply) => {
    const ctx = await storefrontContext(deps, req);
    const site = await loadSite(deps.db, ctx, {
      locale: req.query.locale,
      currency: req.query.currency,
      preview: ctx.preview,
      mediaBaseUrl: deps.env.MEDIA_PUBLIC_BASE_URL ?? null,
    });
    if (!site) throw new AppError("not_found", "errors.storefront.not_initialized");
    // Tracking comes from the protected tracking layer, never from the theme or preview draft.
    const tracking = await withTenantTx(deps.db, ctx, (tx) => publicTrackingConfig(tx, ctx.storeId));
    reply.header("cache-control", cacheHeader(ctx.preview, 30));
    reply.header("x-content-version", String(site.contentVersion));
    return { ...site, tracking };
  });

  app.get(
    "/storefront/v1/route",
    {
      config: { rateLimit: false },
      schema: { hide: true, querystring: siteQuery.extend({ path: z.string().min(1).max(2000) }).catchall(z.union([z.string(), z.array(z.string())])) },
    },
    async (req, reply) => {
      const ctx = await storefrontContext(deps, req);
      const { path, locale, currency, ...rest } = req.query as Record<string, string | string[]> & { path: string; locale?: string; currency?: string };
      const site = await loadSite(deps.db, ctx, { locale, currency, preview: ctx.preview, mediaBaseUrl: deps.env.MEDIA_PUBLIC_BASE_URL ?? null });
      if (!site) throw new AppError("not_found", "errors.storefront.not_initialized");
      const route = await resolveRoute(deps.db, ctx, site, {
        path: path.startsWith("/") ? path : `/${path}`,
        query: rest,
        locale,
        currency,
        preview: ctx.preview,
        mediaBaseUrl: site.mediaBaseUrl,
      });
      // A private route (cart, checkout, portal) is per visitor: never kept by a shared cache.
      reply.header("cache-control", route.cacheClass === "private" ? "private, no-store" : cacheHeader(ctx.preview, route.cacheTtlSeconds));
      return route;
    },
  );

  /**
   * The store's gone rules (redirects without a target: a content type prefix removed while
   * entries were live under it), for the storefront proxy. A request under one of them is
   * resolved through /storefront/v1/route and answered with 410 when the resolver confirms it.
   */
  app.get("/storefront/v1/gone", { config: { rateLimit: false }, schema: { hide: true } }, async (req, reply) => {
    const ctx = await storefrontContext(deps, req);
    const rules = await withTenantTx(deps.db, ctx, (tx) =>
      tx
        .select({ fromPath: redirects.fromPath, matchType: redirects.matchType })
        .from(redirects)
        .where(and(eq(redirects.storeId, ctx.storeId), or(eq(redirects.statusCode, 410), isNull(redirects.toPath)))),
    );
    reply.header("cache-control", cacheHeader(ctx.preview, 30));
    return { rules };
  });

  /**
   * Live entries of a content type as cards, one keyset page at a time: the next pages of an
   * index or an entry list loaded in the browser. Same data and language rules as the rendered
   * index (published languages only, or the default-language fallback when the site's
   * untranslated policy is fallback_noindex). Preview shows live entries too.
   */
  app.get(
    "/storefront/v1/entries",
    { config: { rateLimit: false }, schema: { hide: true, querystring: entriesQuery } },
    async (req, reply) => {
      const ctx = await storefrontContext(deps, req);
      const q = req.query;
      const store = await withTenantTx(deps.db, ctx, async (tx) => {
        const s = await tx.query.stores.findFirst({ where: (st, { eq: e }) => e(st.id, ctx.storeId) });
        const [profile] = await tx.select({ untranslatedPolicy: siteProfiles.untranslatedPolicy }).from(siteProfiles).where(eq(siteProfiles.storeId, ctx.storeId));
        return { s, untranslatedPolicy: profile?.untranslatedPolicy ?? "hide", modules: await loadActiveModules(tx, ctx.storeId) };
      });
      if (!store.s) throw new AppError("not_found", "errors.store.not_found");
      if (!store.modules.includes("content")) throw moduleDisabled("content");
      const { defaultLocale, supportedLocales } = store.s;
      const locale = q.locale && supportedLocales.includes(q.locale) ? q.locale : defaultLocale;
      const now = new Date();
      const [page, boundary] = await Promise.all([
        listLiveEntries(deps.db, ctx, {
          type: q.type,
          locale,
          defaultLocale,
          fallback: store.untranslatedPolicy === "fallback_noindex",
          mediaBaseUrl: deps.env.MEDIA_PUBLIC_BASE_URL ?? null,
          preview: ctx.preview,
          supportedLocales,
          modules: store.modules,
          archiveOf: q.archiveOf,
          terms: q.term === undefined ? undefined : Array.isArray(q.term) ? q.term : [q.term],
          featured: q.featured,
          parentId: q.parent,
          sort: q.sort,
          limit: q.limit,
          cursor: q.cursor,
        }),
        nextScheduleBoundary(deps.db, ctx, { types: [q.type] }, now),
      ]);
      const untilBoundary = boundary ? Math.ceil((boundary.getTime() - now.getTime()) / 1000) : ENTRY_LIST_TTL_SECONDS;
      reply.header("cache-control", cacheHeader(ctx.preview, Math.max(5, Math.min(ENTRY_LIST_TTL_SECONDS, untilBoundary))));
      reply.header("x-content-version", String(store.s.contentVersion));
      return { locale, items: page.items, nextCursor: page.nextCursor };
    },
  );

  app.post(
    "/storefront/v1/newsletter",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (r) => String(r.headers["x-altyapi-client-ip"] ?? r.ip) } }, schema: { hide: true } },
    async (req, reply) => {
      const ctx = await storefrontContext(deps, req);
      const store = await withTenantTx(deps.db, ctx, (tx) => tx.query.stores.findFirst({ where: (st, { eq: e }) => e(st.id, ctx.storeId) }));
      const ip = req.headers["x-altyapi-client-ip"];
      const ua = req.headers["x-altyapi-client-ua"];
      const result = await subscribeNewsletter(deps.db, ctx, req.body, {
        ip: typeof ip === "string" ? ip : null,
        userAgent: typeof ua === "string" ? ua : null,
        hashSecret: deps.env.APP_SIGNING_SECRET,
        countryCode: store?.countryCode ?? "TR",
      });
      return reply.status(201).send({ status: result.status });
    },
  );

  app.post(
    "/storefront/v1/consent",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r) => String(r.headers["x-altyapi-client-ip"] ?? r.ip) } }, schema: { hide: true } },
    async (req, reply) => {
      const ctx = await storefrontContext(deps, req);
      const ip = req.headers["x-altyapi-client-ip"];
      const ua = req.headers["x-altyapi-client-ua"];
      const result = await recordCookieConsent(deps.db, ctx, req.body, {
        ip: typeof ip === "string" ? ip : null,
        userAgent: typeof ua === "string" ? ua : null,
        hashSecret: deps.env.APP_SIGNING_SECRET,
      });
      return reply.status(201).send(result);
    },
  );

  app.get("/storefront/v1/sitemap", { config: { rateLimit: false }, schema: { hide: true } }, async (req, reply) => {
    const ctx = await storefrontContext(deps, req);
    const snapshot = await loadLiveSnapshot(deps.db, ctx);
    const store = await withTenantTx(deps.db, ctx, async (tx) => {
      const s = await tx.query.stores.findFirst({ where: (st, { eq: e }) => e(st.id, ctx.storeId) });
      const ch = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ctx.storeId), eq(channels.isDefault, true)) });
      const [profile] = await tx.select({ pageUrlStyle: siteProfiles.pageUrlStyle }).from(siteProfiles).where(eq(siteProfiles.storeId, ctx.storeId));
      return { s, channelId: ch?.id ?? null, pageUrlStyle: profile?.pageUrlStyle ?? "prefixed", modules: await loadActiveModules(tx, ctx.storeId) };
    });
    if (!snapshot || !store.s) throw new AppError("not_found", "errors.storefront.not_initialized");
    // Product and collection URLs exist only while the catalog module is on.
    const entries = store.modules.includes("catalog")
      ? await listSitemapEntries(deps.db, {
          ...ctx,
          locale: store.s.defaultLocale,
          defaultLocale: store.s.defaultLocale,
          currency: store.s.defaultCurrency,
          channelId: store.channelId,
        })
      : { products: [], collections: [] };
    const pages = await listLivePages(deps.db, ctx, snapshot);
    const { supportedLocales, defaultLocale } = store.s;
    reply.header("cache-control", cacheHeader(false, 3600));
    return {
      defaultLocale: store.s.defaultLocale,
      supportedLocales: store.s.supportedLocales,
      products: entries.products,
      collections: entries.collections,
      // updatedAt is when the live version started serving (a rollback counts); locales are the languages with content of their own.
      pages: pages
        .filter((p) => !p.seo.noindex)
        .map((p) => ({
          type: p.type,
          handle: p.handle,
          // Where the page is served (/pages/{handle} or /{handle}, per the site's page URL style).
          path: pagePath(p.type, p.handle, store.pageUrlStyle) ?? "/",
          updatedAt: p.liveSince,
          locales: pageContentLocales(p, supportedLocales, defaultLocale),
        })),
    };
  });
};
