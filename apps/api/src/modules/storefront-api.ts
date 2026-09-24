import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { listSitemapEntries } from "@altyapi/catalog";
import { channels, and, eq, withTenantTx } from "@altyapi/database";
import { listLivePages, loadLiveSnapshot, loadSite, resolveRoute } from "@altyapi/theme-engine";
import { AppError } from "@altyapi/commerce-core";
import { subscribeNewsletter } from "@altyapi/marketing";
import type { AppDeps } from "../deps";
import { storefrontContext } from "../plugins/storefront-auth";

const siteQuery = z.object({ locale: z.string().max(10).optional(), currency: z.string().length(3).optional() });

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
    reply.header("cache-control", cacheHeader(ctx.preview, 30));
    reply.header("x-content-version", String(site.contentVersion));
    return site;
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
      reply.header("cache-control", cacheHeader(ctx.preview, route.cacheTtlSeconds));
      return route;
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

  app.get("/storefront/v1/sitemap", { config: { rateLimit: false }, schema: { hide: true } }, async (req, reply) => {
    const ctx = await storefrontContext(deps, req);
    const snapshot = await loadLiveSnapshot(deps.db, ctx);
    const store = await withTenantTx(deps.db, ctx, async (tx) => {
      const s = await tx.query.stores.findFirst({ where: (st, { eq: e }) => e(st.id, ctx.storeId) });
      const ch = await tx.query.channels.findFirst({ where: and(eq(channels.storeId, ctx.storeId), eq(channels.isDefault, true)) });
      return { s, channelId: ch?.id ?? null };
    });
    if (!snapshot || !store.s) throw new AppError("not_found", "errors.storefront.not_initialized");
    const entries = await listSitemapEntries(deps.db, {
      ...ctx,
      locale: store.s.defaultLocale,
      defaultLocale: store.s.defaultLocale,
      currency: store.s.defaultCurrency,
      channelId: store.channelId,
    });
    const pages = await listLivePages(deps.db, ctx, snapshot);
    reply.header("cache-control", cacheHeader(false, 3600));
    return {
      defaultLocale: store.s.defaultLocale,
      supportedLocales: store.s.supportedLocales,
      products: entries.products,
      collections: entries.collections,
      pages: pages.filter((p) => !p.seo.noindex).map((p) => ({ type: p.type, handle: p.handle, updatedAt: p.createdAt })),
    };
  });
};
