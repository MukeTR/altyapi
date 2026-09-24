import type { SiteDto } from "@altyapi/theme-engine";

/** Browser-safe identifiers from the protected tracking layer (never from the theme). */
export interface PublicTracking {
  gtmContainerId: string | null;
  ga4MeasurementId: string | null;
  googleAdsConversionId: string | null;
  googleAdsPurchaseLabel: string | null;
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  consentPolicyVersion: string;
}

export type StorefrontSite = SiteDto & { tracking?: PublicTracking };

export function hasTrackers(t: PublicTracking): boolean {
  return Boolean(t.gtmContainerId || t.ga4MeasurementId || t.googleAdsConversionId || t.metaPixelId || t.tiktokPixelId);
}
