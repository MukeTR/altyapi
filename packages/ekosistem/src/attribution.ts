import type { AttributionSnapshot, TouchPoint } from "@altyapi/database";

/**
 * Attribution sanitizer (§7.3, §1). Orders shared with peers carry attribution without
 * personal data: the referrer is reduced to its host, the landing page to its path (no
 * query or fragment), click-id values are dropped and only the ad network remains, UTM
 * values that look like an e-mail address, a phone number or a URL with a query string are
 * dropped, and personal/single-use coupon codes are withheld.
 */

export type ClickChannel = "google" | "meta" | "tiktok" | "microsoft";

export interface SanitizedTouch {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  clickChannel: ClickChannel | null;
}

export interface SanitizedAttribution {
  firstTouch: SanitizedTouch | null;
  lastTouch: SanitizedTouch | null;
  couponCode: string | null;
  affiliateCode: string | null;
}

export interface SanitizeAttributionOptions {
  /** True when the coupon is personal or single-use; such codes are sent as null. */
  isPersonalCoupon?: (code: string) => boolean;
}

const MAX_VALUE_LENGTH = 200;
const MAX_PATH_LENGTH = 1000;

/** Click-id parameter → ad network, in priority order when several are present. */
const CLICK_ID_CHANNELS: ReadonlyArray<readonly [string, ClickChannel]> = [
  ["gclid", "google"],
  ["gbraid", "google"],
  ["wbraid", "google"],
  ["fbclid", "meta"],
  ["ttclid", "tiktok"],
  ["msclkid", "microsoft"],
];
const CLICK_ID_NAMES = new Set(CLICK_ID_CHANNELS.map(([k]) => k));

const EMAIL_RE = /[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}/i;
/** Turkish mobile numbers in their usual spellings: 5xx…, 05xx…, 905xx…, +90 5xx…, 0090 5xx… */
const TR_MOBILE_RE = /(?:^|[^\d])(?:(?:\+|00)?90[\s.-]?)?\(?0?\s?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/;
/** International numbers written with a leading "+" or "00": at least 9 more digits. */
const INTL_PHONE_RE = /(?:^|[^\d])(?:\+|00)\d(?:[\s().-]?\d){8,14}(?!\d)/;
const URL_WITH_QUERY_RE = /(?:https?:\/\/|www\.)\S*\?/i;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value) || /%40/i.test(value);
}

export function looksLikePhone(value: string): boolean {
  return TR_MOBILE_RE.test(value) || INTL_PHONE_RE.test(value);
}

function containsClickId(value: string): boolean {
  const lower = value.toLowerCase();
  for (const name of CLICK_ID_NAMES) if (lower.includes(`${name}=`)) return true;
  return false;
}

/** A free-text value (UTM, coupon, affiliate) safe to share, or null. */
export function sanitizeSharedValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (looksLikeEmail(cleaned) || looksLikePhone(cleaned) || URL_WITH_QUERY_RE.test(cleaned) || containsClickId(cleaned)) return null;
  return cleaned.slice(0, MAX_VALUE_LENGTH);
}

/** Host of a referrer URL (lower-case, no port, no credentials), or null. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (typeof referrer !== "string" || !referrer.trim()) return null;
  let url: URL;
  try {
    url = new URL(referrer.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "android-app:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host && host.length <= 253 ? host : null;
}

/** Path of a landing page without query string or fragment; null when it carries personal data. */
export function landingPath(landing: string | null | undefined): string | null {
  if (typeof landing !== "string" || !landing.trim()) return null;
  const raw = landing.trim();
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      return null;
    }
  } else {
    path = raw.split(/[?#]/, 1)[0] ?? "";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(CONTROL_RE, "");
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Keep the raw path for the personal-data check.
  }
  if (looksLikeEmail(decoded) || looksLikePhone(decoded)) return null;
  return path.slice(0, MAX_PATH_LENGTH);
}

export function clickChannel(clickIds: Record<string, string> | null | undefined): ClickChannel | null {
  if (!clickIds) return null;
  for (const [name, channel] of CLICK_ID_CHANNELS) {
    const v = clickIds[name];
    if (typeof v === "string" && v.length > 0) return channel;
  }
  return null;
}

export function sanitizeTouch(touch: TouchPoint | null | undefined): SanitizedTouch | null {
  if (!touch) return null;
  return {
    utmSource: sanitizeSharedValue(touch.utmSource),
    utmMedium: sanitizeSharedValue(touch.utmMedium),
    utmCampaign: sanitizeSharedValue(touch.utmCampaign),
    utmContent: sanitizeSharedValue(touch.utmContent),
    utmTerm: sanitizeSharedValue(touch.utmTerm),
    referrerHost: referrerHost(touch.referrer),
    landingPath: landingPath(touch.landingPage),
    clickChannel: clickChannel(touch.clickIds),
  };
}

/**
 * Reduces a stored attribution snapshot to what §7.3 allows. Consent state, browser
 * identifiers and request context (IP, user agent, page URL) are never included.
 */
export function sanitizeAttribution(snapshot: AttributionSnapshot | null | undefined, opts: SanitizeAttributionOptions = {}): SanitizedAttribution {
  const s = snapshot ?? {};
  const coupon = sanitizeSharedValue(s.couponCode);
  const personal = coupon !== null && typeof s.couponCode === "string" && (opts.isPersonalCoupon?.(s.couponCode) ?? false);
  return {
    firstTouch: sanitizeTouch(s.firstTouch),
    lastTouch: sanitizeTouch(s.lastTouch),
    couponCode: personal ? null : coupon,
    affiliateCode: sanitizeSharedValue(s.affiliateCode),
  };
}
