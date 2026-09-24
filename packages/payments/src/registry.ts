import type { PaymentMode, PaymentProvider, ProviderName } from "./types";

/**
 * Adapter registry supplied by the application (so this package does not depend on the
 * adapter packages). Each entry validates credentials and builds a provider instance.
 */
export interface ProviderDefinition {
  name: ProviderName;
  parseCredentials(raw: unknown): Record<string, string>;
  displayHint(credentials: Record<string, string>): string;
  create(credentials: Record<string, string>, mode: PaymentMode): PaymentProvider;
  /** Fields the merchant must fill in, for the admin form (labels are i18n keys). */
  credentialFields: { key: string; labelKey: string; secret: boolean }[];
  requiresPhone: boolean;
  supportsPartialRefund: boolean;
  supportsCancel: boolean;
  /** Where the merchant must configure our notification URL in the provider panel. */
  notificationUrlSetting: "provider_panel" | "per_request";
}

export type ProviderRegistry = Record<ProviderName, ProviderDefinition>;
