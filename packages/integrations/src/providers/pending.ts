import { z } from "zod";
import type { ProviderDefinition } from "../types";

/**
 * Providers whose API documentation could not be obtained. They are listed so merchants
 * see the path forward, but cannot be connected: no endpoint is implemented from guesses.
 * Until then these merchants use the marketplace (read-only) or feed connectors.
 */
const none = { readOrders: false, readListings: false, writeStock: false, writePrice: false };

export const entegraProvider: ProviderDefinition = {
  id: "entegra",
  name: "Entegra",
  kind: "integrator",
  docs: {
    status: "pending",
    sources: ["https://documenter.getpostman.com/view/23999845/2s84LKWZug"],
    notes: [
      "REST API; e-posta/şifre ile JWT access + refresh token (refresh her yenilemede değişir), kullanıcı başına saatlik istek limiti.",
      "Postman dokümanı bu ortamdan erişilemedi; uç noktalar dokümandan doğrulanınca bağlayıcı etkinleşir. V2 uç noktaları tercih edilecek, sipariş silme gibi yıkıcı uç noktalar kullanılmayacak.",
    ],
  },
  capabilities: none,
  credentialsSchema: z.object({ email: z.email(), password: z.string().min(4).max(200) }),
  settingsSchema: z.object({}),
  credentialFields: ["email", "password"],
  defaultPollMinutes: 10,
  hosts: [],
};

export const sopyoProvider: ProviderDefinition = {
  id: "sopyo",
  name: "Sopyo",
  kind: "integrator",
  docs: {
    status: "pending",
    sources: ["https://apidocs.sopyo.com (erişilemiyor)"],
    notes: ["Basic Auth + firma_no; stok/fiyat güncelleme uç noktaları eski dokümanda vardı. Doküman sunucusu yanıt vermediği için yazılı teyit bekleniyor."],
  },
  capabilities: none,
  credentialsSchema: z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(200), companyNo: z.string().min(1).max(50) }),
  settingsSchema: z.object({}),
  credentialFields: ["username", "password", "companyNo"],
  defaultPollMinutes: 15,
  hosts: [],
};

export const prapazarProvider: ProviderDefinition = {
  id: "prapazar",
  name: "PraPazar",
  kind: "integrator",
  docs: {
    status: "pending",
    sources: ["https://prapazar.com (API duyurusu)"],
    notes: ["API duyurulmuş ancak kamuya açık doküman yok; firmadan doküman talep edilmeli."],
  },
  capabilities: none,
  credentialsSchema: z.object({}),
  settingsSchema: z.object({}),
  credentialFields: [],
  defaultPollMinutes: 15,
  hosts: [],
};

export const n11Provider: ProviderDefinition = {
  id: "n11",
  name: "n11",
  kind: "marketplace",
  docs: {
    status: "pending",
    sources: ["https://magazadestek.n11.com (RestAPI makaleleri)"],
    notes: [
      "REST API: appkey/appsecret başlıkları, GET /rest/delivery/v1/shipmentPackages (dakikada 1000 istek).",
      "Yanıt alan şeması bu ortamdan doğrulanamadı; doğrulanınca salt-okuma bağlayıcısı etkinleşir.",
    ],
  },
  capabilities: none,
  credentialsSchema: z.object({ appKey: z.string().min(4).max(200), appSecret: z.string().min(4).max(200) }),
  settingsSchema: z.object({}),
  credentialFields: ["appKey", "appSecret"],
  defaultPollMinutes: 15,
  hosts: [],
};
