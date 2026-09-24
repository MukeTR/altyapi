import { z } from "zod";
import type { GeoPoint, ServiceArea, SiteAddress } from "@altyapi/database";
import { countryCode, localizedText, optionalEmail, optionalPhone, optionalText, siteAddressSchema } from "./fields";
import { openingHoursSchema } from "./opening-hours";
import { SITE_LOCATION_STATUSES } from "./types";

export const geoPointSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Shown as an area instead of a pin (home-based businesses); JSON-LD omits the exact point. */
  approximate: z.boolean().default(false),
});

export const serviceAreaSchema = z
  .strictObject({
    places: z
      .array(z.strictObject({ il: z.string().trim().min(1).max(120), ilce: optionalText(120) }))
      .max(100)
      .default([]),
    radiusKm: z.number().positive().max(1000).nullable().optional(),
    countries: z
      .array(countryCode)
      .max(50)
      .transform((codes) => [...new Set(codes)])
      .optional(),
  })
  .refine((a) => a.places.length > 0 || (a.radiusKm ?? 0) > 0 || (a.countries?.length ?? 0) > 0, {
    error: "errors.site.location.empty_service_area",
  });

const locationFields = {
  name: localizedText(120),
  /** URL segment of the location page; derived from the name when omitted. */
  slug: z.string().trim().toLowerCase().max(63).optional(),
  /** Null for a service-area business that does not publish an address. */
  address: siteAddressSchema.nullable().optional(),
  geo: geoPointSchema.nullable().optional(),
  phone: optionalPhone,
  email: optionalEmail,
  /** Number reachable on WhatsApp (E.164). */
  whatsapp: optionalPhone,
  openingHours: openingHoursSchema.optional(),
  serviceArea: serviceAreaSchema.nullable().optional(),
  /** Making a location primary moves the flag from the previous primary location. */
  isPrimary: z.boolean().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(SITE_LOCATION_STATUSES).optional(),
};

export const createSiteLocationSchema = z.strictObject(locationFields);

/** Patch: omitted fields keep their value, null clears nullable ones. */
export const updateSiteLocationSchema = z.strictObject({ ...locationFields, name: localizedText(120).optional() });

export type CreateSiteLocationInput = z.input<typeof createSiteLocationSchema>;
export type UpdateSiteLocationInput = z.input<typeof updateSiteLocationSchema>;

/** The location fields cross-field rules look at, after merging the input into the stored row. */
export interface LocationCrossFields {
  address: SiteAddress | null;
  geo: GeoPoint | null;
  serviceArea: ServiceArea | null;
}

/**
 * Cross-field rules on the merged location; returns error keys (empty when consistent).
 * - A location publishes where it is: an address, a service area, or both.
 * - A service radius is measured around the location's point.
 * The primary-location rules need the other locations and live in the location service.
 */
export function locationProblems(location: LocationCrossFields): string[] {
  const problems: string[] = [];
  if (!location.address && !location.serviceArea) problems.push("errors.site.location.address_or_service_area_required");
  if (location.serviceArea?.radiusKm && !location.geo) problems.push("errors.site.location.radius_requires_geo");
  return problems;
}
