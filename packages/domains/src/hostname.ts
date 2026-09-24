import { domainToASCII } from "node:url";
import { isIP } from "node:net";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type HostnameCheck = { ok: true; hostname: string } | { ok: false; reason: string };

/**
 * Normalizes a user-entered or Host-header hostname: lowercases, strips scheme, path,
 * port and trailing dot, converts IDNs to punycode and validates each label.
 */
export function normalizeHostname(input: string): HostnameCheck {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  if (value.startsWith("[")) return { ok: false, reason: "errors.domain.ip_not_allowed" };
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!value) return { ok: false, reason: "errors.domain.empty" };
  if (isIP(value)) return { ok: false, reason: "errors.domain.ip_not_allowed" };
  const ascii = domainToASCII(value);
  if (!ascii || ascii.length > 253) return { ok: false, reason: "errors.domain.invalid" };
  const labels = ascii.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, reason: "errors.domain.invalid" };
  if (/^\d+$/.test(labels[labels.length - 1]!)) return { ok: false, reason: "errors.domain.invalid" };
  return { ok: true, hostname: ascii };
}

/**
 * Splits a hostname into the "www" host that is bound to the store and the apex that
 * redirects to it. Deeper subdomains (shop.example.com) are bound as-is with no apex.
 * The registrable-domain heuristic treats two-label public suffixes such as com.tr as one.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  "com.tr", "net.tr", "org.tr", "gen.tr", "biz.tr", "info.tr", "web.tr", "av.tr", "bel.tr", "tv.tr",
  "co.uk", "org.uk", "com.au", "com.br", "co.jp", "com.cy", "com.de",
]);

export function planHostnames(hostname: string): { routingHostname: string; apexHostname: string | null } {
  const labels = hostname.split(".");
  const suffix2 = labels.slice(-2).join(".");
  const registrableLen = TWO_LEVEL_SUFFIXES.has(suffix2) ? 3 : 2;
  if (labels.length === registrableLen) {
    return { routingHostname: `www.${hostname}`, apexHostname: hostname };
  }
  if (labels.length === registrableLen + 1 && labels[0] === "www") {
    return { routingHostname: hostname, apexHostname: labels.slice(1).join(".") };
  }
  return { routingHostname: hostname, apexHostname: null };
}

export function isPlatformHostname(hostname: string, rootDomain: string): boolean {
  return hostname === rootDomain || hostname.endsWith(`.${rootDomain}`);
}
