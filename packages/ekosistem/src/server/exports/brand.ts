import { and, contentAssets, eq, isNull, storeBrandProfiles, stores, withTenantTx, type BrandCompetitor } from "@altyapi/database";
import { publicObjectUrl } from "@altyapi/storage";
import { EkosistemError } from "../../errors";
import { loadStoreIdentity, storeUrl, type EkosistemServerDeps, type LinkRow } from "../common";
import { loadStorefrontFacts } from "./storefront";

/** GET /ekosistem/v1/brand (§7.1): one record describing the linked store's brand. */
export interface BrandItem {
  ref: string;
  name: string;
  description: string | null;
  locale: string;
  locales: string[];
  country: string;
  currency: string;
  canonicalUrl: string;
  domains: string[];
  logoUrl: string | null;
  socialProfiles: string[];
  topics: string[];
  competitors: BrandCompetitor[];
  updatedAt: string;
}

export async function exportBrand(deps: EkosistemServerDeps, link: LinkRow): Promise<BrandItem> {
  const scope = { organizationId: link.organizationId, storeId: link.storeId };
  const facts = await loadStorefrontFacts(deps.db, scope);
  return withTenantTx(deps.db, scope, async (tx) => {
    const identity = await loadStoreIdentity(tx, link.storeId, deps.storeRootDomain);
    if (!identity) throw new EkosistemError("link_invalid");
    const [profile] = await tx.select().from(storeBrandProfiles).where(eq(storeBrandProfiles.storeId, link.storeId));
    const [store] = await tx.select({ updatedAt: stores.updatedAt }).from(stores).where(eq(stores.id, link.storeId));
    // The logo is the one the live theme shows (theme settings → brand.logoAssetId).
    const logoAssetId = facts.snapshot?.themeSettings.brand.logoAssetId ?? null;
    let logoUrl: string | null = null;
    if (logoAssetId && deps.mediaBaseUrl) {
      const [asset] = await tx
        .select({ objectKey: contentAssets.objectKey })
        .from(contentAssets)
        .where(and(eq(contentAssets.id, logoAssetId), eq(contentAssets.storeId, link.storeId), eq(contentAssets.status, "ready"), isNull(contentAssets.deletedAt)));
      if (asset) logoUrl = publicObjectUrl(deps.mediaBaseUrl, asset.objectKey);
    }
    const updatedAt = [profile?.updatedAt, store?.updatedAt].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date();
    return {
      ref: identity.storeId,
      name: identity.name,
      description: profile?.description ?? null,
      locale: identity.defaultLocale,
      locales: identity.supportedLocales,
      country: identity.countryCode,
      currency: identity.defaultCurrency,
      canonicalUrl: storeUrl(identity.canonicalHost, ""),
      domains: identity.domains,
      logoUrl,
      socialProfiles: profile?.socialProfiles ?? [],
      topics: profile?.topics ?? [],
      competitors: (profile?.competitors ?? []).map((c) => ({ name: c.name, website: c.website ?? null, aliases: c.aliases ?? [] })),
      updatedAt: updatedAt.toISOString(),
    };
  });
}
