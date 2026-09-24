/**
 * Carrier adapter contract. Implementations wrap a carrier API (create shipment, label,
 * tracking, cancel); the "manual" carriers below only build tracking links from numbers the
 * merchant enters, for carriers without an API connection.
 */
export interface ShipmentParty {
  name: string;
  phone: string | null;
  email: string | null;
  address: { line1: string; line2?: string | null; district?: string | null; city: string; province?: string | null; postalCode?: string | null; countryCode: string };
}

export interface CreateShipmentInput {
  reference: string;
  sender: ShipmentParty;
  recipient: ShipmentParty;
  parcels: { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number; desi?: number }[];
  /** Cash-on-delivery is not supported by the platform (payments are online only). */
  declaredValue: { amount: bigint; currency: string };
  contents: string;
}

export interface CreatedShipment {
  providerShipmentId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  label: { contentType: "application/pdf" | "image/png" | "application/zpl"; bytes: Uint8Array } | null;
}

export type TrackingStatus = "created" | "in_transit" | "out_for_delivery" | "delivered" | "failed" | "returned" | "cancelled";

export interface TrackingResult {
  status: TrackingStatus;
  events: { at: string; status: TrackingStatus; description: string; location: string | null }[];
  deliveredAt: string | null;
}

export interface ShippingCarrierAdapter {
  readonly code: string;
  readonly name: string;
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  getLabel(providerShipmentId: string): Promise<CreatedShipment["label"]>;
  track(providerShipmentId: string): Promise<TrackingResult>;
  cancel(providerShipmentId: string): Promise<{ ok: boolean; message: string | null }>;
}

/** Tracking URL templates for Turkish and international carriers ({n} = tracking number). */
export const CARRIER_TRACKING_URLS: Record<string, { name: string; url: string }> = {
  yurtici: { name: "Yurtiçi Kargo", url: "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={n}" },
  aras: { name: "Aras Kargo", url: "https://kargotakip.araskargo.com.tr/mainpage.aspx?code={n}" },
  mng: { name: "MNG Kargo", url: "https://www.mngkargo.com.tr/gonderi-takip/?takipNo={n}" },
  ptt: { name: "PTT Kargo", url: "https://gonderitakip.ptt.gov.tr/Track/Verify?q={n}" },
  surat: { name: "Sürat Kargo", url: "https://suratkargo.com.tr/KargoTakip/?kargotakipno={n}" },
  hepsijet: { name: "HepsiJet", url: "https://www.hepsijet.com/gonderi-takibi/{n}" },
  trendyol_express: { name: "Trendyol Express", url: "https://kargotakip.trendyol.com/?orderNumber={n}" },
  ups: { name: "UPS", url: "https://www.ups.com/track?tracknum={n}" },
  dhl: { name: "DHL", url: "https://www.dhl.com/tr-tr/home/tracking.html?tracking-id={n}" },
  fedex: { name: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
};

export function trackingUrlFor(carrierCode: string | null, trackingNumber: string | null): string | null {
  if (!carrierCode || !trackingNumber) return null;
  const c = CARRIER_TRACKING_URLS[carrierCode];
  return c ? c.url.replace("{n}", encodeURIComponent(trackingNumber)) : null;
}

export type CarrierRegistry = Record<string, ShippingCarrierAdapter>;
