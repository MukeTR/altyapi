export type DomainStatus = "pending" | "awaiting_dns" | "validating" | "certificate_pending" | "active" | "failed" | "moved" | "disabled";

export interface DnsInstruction {
  type: string;
  name: string;
  value: string;
  /** routing | apex_redirect | ownership_verification | ssl_validation */
  purpose: string;
}

/** A hostname of the store (GET/POST domains). */
export interface Domain {
  id: string;
  hostname: string;
  kind: "platform_subdomain" | "custom";
  status: DomainStatus | (string & {});
  isCanonical: boolean;
  /** Set on an apex that only redirects to its www hostname. */
  redirectToHostname: string | null;
  sslStatus: string | null;
  dnsInstructions: DnsInstruction[];
  verificationErrors: string[];
  failureReason: string | null;
  lastCheckedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

/** States in which the platform is still working on the domain (worth polling). */
export const IN_PROGRESS: readonly string[] = ["pending", "awaiting_dns", "validating", "certificate_pending"];

/**
 * What the merchant typed, reduced to a hostname: scheme, path, port and a trailing dot are
 * removed. The API normalizes and validates it again (IDN, apex vs www).
 */
export function normalizeHostnameInput(input: string): string {
  let v = input.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "");
  v = v.split(/[/?#]/)[0] ?? "";
  v = v.replace(/:\d+$/, "").replace(/\.$/, "");
  return v;
}
