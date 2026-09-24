import { AppError } from "@altyapi/commerce-core";

/**
 * Minimal typed client for Cloudflare for SaaS custom hostnames and Workers KV.
 * https://developers.cloudflare.com/api/resources/custom_hostnames/
 */
export interface CloudflareConfig {
  apiToken: string;
  accountId: string;
  zoneId: string;
  routingKvNamespaceId?: string | undefined;
  baseUrl?: string;
}

export interface CfValidationRecord {
  txt_name?: string;
  txt_value?: string;
  http_url?: string;
  http_body?: string;
  cname?: string;
  cname_target?: string;
  status?: string;
}

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: {
    id?: string;
    status?: string;
    method?: string;
    type?: string;
    validation_records?: CfValidationRecord[];
    validation_errors?: { message: string }[];
  };
  ownership_verification?: { type: string; name: string; value: string };
  ownership_verification_http?: { http_url: string; http_body: string };
  verification_errors?: string[];
  created_at?: string;
}

interface CfEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

export class CloudflareClient {
  private readonly base: string;

  constructor(private readonly cfg: CloudflareConfig) {
    this.base = cfg.baseUrl ?? "https://api.cloudflare.com/client/v4";
  }

  private async request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.apiToken}`,
        ...(body !== undefined ? { "content-type": raw ? "text/plain" : "application/json" } : {}),
      },
      body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: CfEnvelope<T> | undefined;
    try {
      parsed = JSON.parse(text) as CfEnvelope<T>;
    } catch {
      parsed = undefined;
    }
    if (!res.ok || !parsed?.success) {
      const message = parsed?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ?? `HTTP ${res.status}`;
      throw new AppError("dependency_unavailable", "errors.cloudflare.request_failed", { status: res.status, message });
    }
    return parsed.result;
  }

  createCustomHostname(hostname: string): Promise<CfCustomHostname> {
    return this.request("POST", `/zones/${this.cfg.zoneId}/custom_hostnames`, {
      hostname,
      ssl: {
        method: "txt",
        type: "dv",
        settings: { min_tls_version: "1.2", http2: "on" },
        bundle_method: "ubiquitous",
        wildcard: false,
      },
    });
  }

  getCustomHostname(id: string): Promise<CfCustomHostname> {
    return this.request("GET", `/zones/${this.cfg.zoneId}/custom_hostnames/${encodeURIComponent(id)}`);
  }

  /** Re-submitting the SSL settings asks Cloudflare to restart validation. */
  refreshCustomHostname(id: string): Promise<CfCustomHostname> {
    return this.request("PATCH", `/zones/${this.cfg.zoneId}/custom_hostnames/${encodeURIComponent(id)}`, {
      ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2", http2: "on" } },
    });
  }

  async deleteCustomHostname(id: string): Promise<void> {
    await this.request("DELETE", `/zones/${this.cfg.zoneId}/custom_hostnames/${encodeURIComponent(id)}`);
  }

  async putRoutingEntry(key: string, value: string): Promise<void> {
    if (!this.cfg.routingKvNamespaceId) return;
    await this.request(
      "PUT",
      `/accounts/${this.cfg.accountId}/storage/kv/namespaces/${this.cfg.routingKvNamespaceId}/values/${encodeURIComponent(key)}`,
      value,
      true,
    );
  }

  async deleteRoutingEntry(key: string): Promise<void> {
    if (!this.cfg.routingKvNamespaceId) return;
    await this.request(
      "DELETE",
      `/accounts/${this.cfg.accountId}/storage/kv/namespaces/${this.cfg.routingKvNamespaceId}/values/${encodeURIComponent(key)}`,
    );
  }
}
