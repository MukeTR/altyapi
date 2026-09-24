import {
  and,
  asc,
  businessIdentities,
  desc,
  eq,
  siteLocations,
  type BusinessIdentifiers,
  type GeoPoint,
  type LocalizedText,
  type OpeningHours,
  type ServiceArea,
  type SiteAddress,
  type Transaction,
} from "@altyapi/database";
import type { BusinessLegalForm } from "@altyapi/site";

/**
 * Public view of the business identity (K3) for the storefront: imprint, contact facts and
 * the organization data of structured markup. The tax number is included only when the
 * merchant made it public (a sole proprietor's TCKN is personal data).
 */
export interface PublicBusinessIdentity {
  legalName: string | null;
  tradeName: string | null;
  legalForm: BusinessLegalForm | null;
  mersisNo: string | null;
  tradeRegistryNo: string | null;
  taxOffice: string | null;
  /** Null unless tax_number_public. */
  taxNumber: string | null;
  kepAddress: string | null;
  chamber: string | null;
  chamberRulesUrl: string | null;
  phone: string | null;
  email: string | null;
  address: SiteAddress | null;
  foundingDate: string | null;
  logoAssetId: string | null;
  /** In the page language (default language as fallback). */
  description: string;
  sameAs: string[];
  identifiers: BusinessIdentifiers;
}

/** An active location as the storefront shows it. */
export interface PublicLocation {
  id: string;
  slug: string;
  /** In the page language (default language as fallback). */
  name: string;
  address: SiteAddress | null;
  /** Omitted when the location is shown only as an area (approximate). */
  geo: GeoPoint | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  openingHours: OpeningHours;
  serviceArea: ServiceArea | null;
  isPrimary: boolean;
}

function textIn(map: LocalizedText | undefined | null, locale: string, defaultLocale: string): string {
  if (!map) return "";
  return map[locale]?.trim() || map[defaultLocale]?.trim() || "";
}

/** Business identity of the store, or null until it is first saved. */
export async function loadPublicIdentity(tx: Transaction, storeId: string, locale: string, defaultLocale: string): Promise<PublicBusinessIdentity | null> {
  const [row] = await tx.select().from(businessIdentities).where(eq(businessIdentities.storeId, storeId));
  if (!row) return null;
  return {
    legalName: row.legalName,
    tradeName: row.tradeName,
    legalForm: row.legalForm,
    mersisNo: row.mersisNo,
    tradeRegistryNo: row.tradeRegistryNo,
    taxOffice: row.taxOffice,
    taxNumber: row.taxNumberPublic ? row.taxNumber : null,
    kepAddress: row.kepAddress,
    chamber: row.chamber,
    chamberRulesUrl: row.chamberRulesUrl,
    phone: row.phone,
    email: row.email,
    address: row.address,
    foundingDate: row.foundingDate,
    logoAssetId: row.logoAssetId,
    description: textIn(row.description, locale, defaultLocale),
    sameAs: row.sameAs,
    identifiers: row.identifiers,
  };
}

/** Active locations, the primary one first, then in the merchant's order. */
export async function loadPublicLocations(tx: Transaction, storeId: string, locale: string, defaultLocale: string): Promise<PublicLocation[]> {
  const rows = await tx
    .select()
    .from(siteLocations)
    .where(and(eq(siteLocations.storeId, storeId), eq(siteLocations.status, "active")))
    .orderBy(desc(siteLocations.isPrimary), asc(siteLocations.position), asc(siteLocations.slug));
  return rows.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: textIn(l.name, locale, defaultLocale),
    address: l.address,
    geo: l.geo && !l.geo.approximate ? l.geo : null,
    phone: l.phone,
    email: l.email,
    whatsapp: l.whatsapp,
    openingHours: l.openingHours,
    serviceArea: l.serviceArea,
    isPrimary: l.isPrimary,
  }));
}

/** One-line postal address ("Bağdat Cad. No:12, Caddebostan Mah., Kadıköy, İstanbul 34728, TR"). */
export function addressLine(a: SiteAddress): string {
  return [a.street, a.mahalle, a.ilce, [a.il, a.postalCode].filter(Boolean).join(" "), a.country].filter((p) => p && String(p).trim()).join(", ");
}

/**
 * Link to a location on a map service. The storefront never embeds a map (no third-party
 * script or frame); visitors follow this link. Exact coordinates are used when published,
 * the address otherwise.
 */
export function mapLink(provider: "google" | "apple" | "yandex" | "openstreetmap", location: Pick<PublicLocation, "geo" | "address" | "name">): string | null {
  const q = location.address ? addressLine(location.address) : null;
  const g = location.geo;
  if (!g && !q) return null;
  switch (provider) {
    case "google":
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g ? `${g.lat},${g.lng}` : q!)}`;
    case "apple":
      return g ? `https://maps.apple.com/?ll=${g.lat},${g.lng}&q=${encodeURIComponent(location.name || q || "")}` : `https://maps.apple.com/?q=${encodeURIComponent(q!)}`;
    case "yandex":
      return g ? `https://yandex.com.tr/harita/?pt=${g.lng},${g.lat}&z=16&l=map` : `https://yandex.com.tr/harita/?text=${encodeURIComponent(q!)}`;
    case "openstreetmap":
      return g ? `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(q!)}`;
  }
}
