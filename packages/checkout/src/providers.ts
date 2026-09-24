import { IyzicoProvider, iyzicoCredentialsSchema, type IyzicoCredentials } from "@altyapi/payment-iyzico";
import { PaytrProvider, paytrCredentialsSchema, type PaytrCredentials } from "@altyapi/payment-paytr";
import type { ProviderRegistry } from "@altyapi/payments";

/** Registry of the payment providers merchants can connect (their own accounts). */
export function createProviderRegistry(): ProviderRegistry {
  return {
    paytr: {
      name: "paytr",
      parseCredentials: (raw) => paytrCredentialsSchema.parse(raw),
      displayHint: (c) => `Mağaza no ${c.merchantId}`,
      create: (c, mode) => new PaytrProvider(c as unknown as PaytrCredentials, mode),
      credentialFields: [
        { key: "merchantId", labelKey: "payments.paytr.merchant_id", secret: false },
        { key: "merchantKey", labelKey: "payments.paytr.merchant_key", secret: true },
        { key: "merchantSalt", labelKey: "payments.paytr.merchant_salt", secret: true },
      ],
      requiresPhone: true,
      supportsPartialRefund: true,
      supportsCancel: true,
      notificationUrlSetting: "provider_panel",
    },
    iyzico: {
      name: "iyzico",
      parseCredentials: (raw) => iyzicoCredentialsSchema.parse(raw),
      displayHint: (c) => `API anahtarı …${String(c.apiKey).slice(-4)}`,
      create: (c, mode) => new IyzicoProvider(c as unknown as IyzicoCredentials, mode),
      credentialFields: [
        { key: "apiKey", labelKey: "payments.iyzico.api_key", secret: false },
        { key: "secretKey", labelKey: "payments.iyzico.secret_key", secret: true },
      ],
      requiresPhone: false,
      supportsPartialRefund: true,
      supportsCancel: true,
      notificationUrlSetting: "per_request",
    },
  };
}
