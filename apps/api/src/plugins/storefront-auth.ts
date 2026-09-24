import type { FastifyRequest } from "fastify";
import { AppError } from "@altyapi/commerce-core";
import { safeEqual } from "@altyapi/auth";
import { eq, stores, withPlatformTx, withTenantTx } from "@altyapi/database";
import { loadActiveModules } from "@altyapi/site";
import { moduleDisabled } from "@altyapi/tenancy";
import { resolveHostname } from "@altyapi/domains";
import { enrichContext } from "@altyapi/observability";
import { verifyPreviewToken } from "@altyapi/theme-engine";
import type { AppDeps } from "../deps";

export interface StorefrontRequestContext {
  organizationId: string;
  storeId: string;
  preview: boolean;
}

/**
 * Identifies the store for Storefront API calls. Production: the storefront server
 * presents the internal key and the store id it verified from the edge signature.
 * Local development: a host header may be resolved directly.
 */
export async function storefrontContext(deps: AppDeps, req: FastifyRequest): Promise<StorefrontRequestContext> {
  const key = req.headers["x-altyapi-storefront-key"];
  if (typeof key !== "string" || !safeEqual(key, deps.env.STOREFRONT_API_SECRET)) {
    throw new AppError("unauthenticated", "errors.storefront.invalid_key");
  }
  let storeId = req.headers["x-altyapi-store-id"];
  const devHost = req.headers["x-altyapi-dev-host"];
  if (typeof storeId !== "string" && typeof devHost === "string" && deps.env.APP_ENV === "local") {
    const resolved = await resolveHostname(deps.db, devHost);
    storeId = resolved?.storeId;
  }
  if (typeof storeId !== "string" || !/^[0-9a-f-]{36}$/.test(storeId)) throw new AppError("not_found", "errors.store.not_found");
  const store = await withPlatformTx(deps.db, (tx) => tx.query.stores.findFirst({ where: eq(stores.id, storeId as string) }));
  if (!store || store.status === "closed") throw new AppError("not_found", "errors.store.not_found");
  const token = req.headers["x-altyapi-preview-token"];
  const preview = typeof token === "string" && verifyPreviewToken(deps.env.APP_SIGNING_SECRET, token, store.id);
  enrichContext({ organizationId: store.organizationId, storeId: store.id, principalType: "system" });
  return { organizationId: store.organizationId, storeId: store.id, preview };
}

/**
 * Storefront context of cart, checkout and order endpoints: only a store whose commerce
 * module is active sells (403 errors.site.module.disabled otherwise).
 */
export async function storefrontCommerceContext(deps: AppDeps, req: FastifyRequest): Promise<StorefrontRequestContext> {
  const ctx = await storefrontContext(deps, req);
  const modules = await withTenantTx(deps.db, ctx, (tx) => loadActiveModules(tx, ctx.storeId));
  if (!modules.includes("commerce")) throw moduleDisabled("commerce");
  return ctx;
}
