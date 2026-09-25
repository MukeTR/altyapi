/**
 * Response shapes of the settings endpoints owned by the settings area: organization members,
 * payment providers and connections, and the protected tracking layer. Not exhaustive: the API
 * may add fields.
 */
import type { RoleGrant } from "@/lib/api/types";

export interface Member {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  status: "active" | "invited" | (string & {});
  roles: RoleGrant[];
}

export interface InviteResult {
  memberId: string;
  expiresAt: string;
}

export type PaymentProviderName = "paytr" | "iyzico";

export interface PaymentProviderDefinition {
  name: PaymentProviderName | (string & {});
  /** labelKey is an i18n key such as "payments.paytr.merchant_id". */
  credentialFields: { key: string; labelKey: string; secret: boolean }[];
  requiresPhone: boolean;
  supportsPartialRefund: boolean;
  supportsCancel: boolean;
  /** provider_panel: paste our notification URL into the provider panel; per_request: sent automatically. */
  notificationUrlSetting: "provider_panel" | "per_request" | (string & {});
}

export type PaymentMode = "test" | "live";

export interface PaymentConnection {
  id: string;
  provider: PaymentProviderName | (string & {});
  mode: PaymentMode | (string & {});
  status: "active" | "disabled" | "error" | (string & {});
  /** Masked account hint (e.g. the merchant id's last digits); never a secret. */
  displayHint: string | null;
  priority: number;
  lastVerifiedAt: string | null;
  lastError: string | null;
  capabilities: { partialRefund: boolean; cancel: boolean; requiresPhone: boolean };
  notificationUrl: string;
  notificationUrlSetting: "provider_panel" | "per_request" | (string & {});
  createdAt: string;
  updatedAt: string;
}

export const TRACKING_SECRETS = ["metaCapiAccessToken", "metaTestEventCode", "tiktokAccessToken", "tiktokTestEventCode", "ga4ApiSecret"] as const;
export type TrackingSecret = (typeof TRACKING_SECRETS)[number];

export interface TrackingConfig {
  gtmContainerId: string | null;
  ga4MeasurementId: string | null;
  googleAdsConversionId: string | null;
  googleAdsPurchaseLabel: string | null;
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  metaCapiEnabled: boolean;
  tiktokEventsApiEnabled: boolean;
  ga4MeasurementProtocolEnabled: boolean;
  /** Only whether a value is stored; secret values are never returned. */
  secrets: Record<TrackingSecret, boolean>;
  consentPolicyVersion: string;
  /** 0 until the first save; sent back as expectedVersion. */
  version: number;
  updatedAt: string | null;
}

/** Page size of the conversion delivery log. */
export const DELIVERIES_PAGE = 50;

export interface ConversionDelivery {
  id: string;
  destination: string;
  eventName: string;
  eventId: string | null;
  orderId: string | null;
  status: "sent" | "failed" | "skipped" | (string & {});
  httpStatus: number | null;
  message: string | null;
  createdAt: string;
}
