import type { Database } from "@altyapi/database";
import { CloudflareClient } from "./cloudflare";
import type { DomainDeps } from "./service";

export interface DomainEnv {
  CLOUDFLARE_API_TOKEN?: string | undefined;
  CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  CLOUDFLARE_ZONE_ID?: string | undefined;
  CLOUDFLARE_KV_ROUTING_NAMESPACE_ID?: string | undefined;
  STORE_ROOT_DOMAIN: string;
  CUSTOM_DOMAIN_CNAME_TARGET: string;
  CUSTOM_DOMAIN_APEX_A_RECORDS: string[];
}

/** Returns null when Cloudflare credentials are not configured; callers surface that explicitly. */
export function createCloudflareClient(env: DomainEnv): CloudflareClient | null {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  return new CloudflareClient({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    zoneId: env.CLOUDFLARE_ZONE_ID,
    routingKvNamespaceId: env.CLOUDFLARE_KV_ROUTING_NAMESPACE_ID,
  });
}

export function createDomainDeps(env: DomainEnv, db: Database): DomainDeps {
  return {
    db,
    cloudflare: createCloudflareClient(env),
    platform: {
      rootDomain: env.STORE_ROOT_DOMAIN,
      cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
      apexARecords: env.CUSTOM_DOMAIN_APEX_A_RECORDS,
    },
  };
}
