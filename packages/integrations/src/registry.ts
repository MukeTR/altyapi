import { dopigoProvider } from "./providers/dopigo";
import { feedProvider } from "./providers/feed";
import { hepsiburadaProvider } from "./providers/hepsiburada";
import { entegraProvider, n11Provider, prapazarProvider, sopyoProvider } from "./providers/pending";
import { stockmountProvider } from "./providers/stockmount";
import { trendyolProvider } from "./providers/trendyol";
import type { ProviderDefinition, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, ProviderDefinition<any, any>> = {
  stockmount: stockmountProvider,
  dopigo: dopigoProvider,
  entegra: entegraProvider,
  sopyo: sopyoProvider,
  prapazar: prapazarProvider,
  trendyol: trendyolProvider,
  hepsiburada: hepsiburadaProvider,
  n11: n11Provider,
  feed: feedProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function providerView(p: ProviderDefinition<any, any>) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    available: p.docs.status === "verified" && Boolean(p.create),
    docs: p.docs,
    capabilities: p.capabilities,
    credentialFields: p.credentialFields,
    defaultPollMinutes: p.defaultPollMinutes,
  };
}
