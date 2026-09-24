import type { DnsInstruction } from "@altyapi/database";
import type { CfCustomHostname } from "./cloudflare";

export type DomainStatus =
  | "pending"
  | "awaiting_dns"
  | "validating"
  | "certificate_pending"
  | "active"
  | "failed"
  | "moved"
  | "disabled";

export interface MappedStatus {
  status: DomainStatus;
  sslStatus: string | null;
  verificationStatus: string | null;
  errors: string[];
}

const DNS_MISSING = /(cname|dns|not found|no record|does not point|missing)/i;

/**
 * Maps Cloudflare's (hostname status, ssl status) pair onto the platform lifecycle.
 * Cloudflare hostname statuses: pending, active, moved, deleted, blocked, pending_*.
 * SSL statuses: initializing, pending_validation, pending_issuance, pending_deployment, active, ...
 */
export function mapCloudflareStatus(cf: CfCustomHostname): MappedStatus {
  const ssl = cf.ssl?.status ?? null;
  const errors = [
    ...(cf.verification_errors ?? []),
    ...(cf.ssl?.validation_errors ?? []).map((e) => e.message),
  ];
  const base = { sslStatus: ssl, verificationStatus: cf.status, errors };

  if (cf.status === "moved") return { status: "moved", ...base };
  if (cf.status === "blocked" || cf.status === "deleted" || cf.status === "pending_deletion") {
    return { status: "failed", ...base };
  }
  if (ssl && /(expired|deleted|timed_out|validation_timed_out|issuance_timed_out|deployment_timed_out)/.test(ssl)) {
    return { status: "failed", ...base };
  }
  if (cf.status === "active") {
    return { status: ssl === "active" ? "active" : "certificate_pending", ...base };
  }
  // Hostname still pending: distinguish "records not there yet" from "records seen, validating".
  if (ssl === "pending_issuance" || ssl === "pending_deployment") return { status: "certificate_pending", ...base };
  if (errors.length === 0 || errors.some((e) => DNS_MISSING.test(e))) return { status: "awaiting_dns", ...base };
  return { status: "validating", ...base };
}

export function buildDnsInstructions(
  cf: CfCustomHostname | null,
  opts: { hostname: string; cnameTarget: string; isApex: boolean; apexARecords: string[] },
): DnsInstruction[] {
  const out: DnsInstruction[] = [];
  if (opts.isApex) {
    if (opts.apexARecords.length > 0) {
      for (const ip of opts.apexARecords) {
        out.push({ type: ip.includes(":") ? "AAAA" : "A", name: opts.hostname, value: ip, purpose: "apex_redirect" });
      }
    } else {
      // Requires CNAME flattening / ALIAS support at the DNS provider.
      out.push({ type: "CNAME", name: opts.hostname, value: opts.cnameTarget, purpose: "apex_redirect" });
    }
  } else {
    out.push({ type: "CNAME", name: opts.hostname, value: opts.cnameTarget, purpose: "routing" });
  }
  if (cf?.ownership_verification?.name && cf.ownership_verification.value) {
    out.push({
      type: "TXT",
      name: cf.ownership_verification.name,
      value: cf.ownership_verification.value,
      purpose: "ownership_verification",
    });
  }
  for (const r of cf?.ssl?.validation_records ?? []) {
    if (r.txt_name && r.txt_value) out.push({ type: "TXT", name: r.txt_name, value: r.txt_value, purpose: "ssl_validation" });
  }
  return out;
}

/** Poll schedule after each check: fast at first, then hourly, then every 6 hours. */
const BACKOFF_SECONDS = [60, 120, 300, 600, 1800, 3600, 3600, 3600];
export const MAX_CHECK_WINDOW_MS = 7 * 24 * 3600_000;

export function nextCheckDelayMs(attempts: number): number {
  return (BACKOFF_SECONDS[attempts] ?? 6 * 3600) * 1000;
}
