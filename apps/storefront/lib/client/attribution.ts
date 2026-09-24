"use client";

import { readConsent, readCookie } from "./consent";

/**
 * Marketing attribution (UTM, click ids) and browser identifiers for conversion APIs.
 * Nothing is collected or sent without consent; the server applies the same rules again.
 */
interface Touch {
  at: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
  clickIds?: Record<string, string>;
}

const FIRST_KEY = "sf_first_touch";
const LAST_KEY = "sf_last_touch";
const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid"] as const;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Records the landing touch (only once consent for analytics or marketing exists). */
export function captureTouch() {
  const consent = readConsent();
  if (!consent || !(consent.analytics || consent.marketing)) return;
  const url = new URL(window.location.href);
  const q = url.searchParams;
  const clickIds: Record<string, string> = {};
  for (const k of CLICK_IDS) {
    const v = q.get(k);
    if (v) clickIds[k] = v.slice(0, 500);
  }
  const hasCampaign = q.has("utm_source") || Object.keys(clickIds).length > 0;
  const externalReferrer = document.referrer && !document.referrer.startsWith(url.origin) ? document.referrer.slice(0, 1000) : null;
  if (!hasCampaign && !externalReferrer) return;
  const touch: Touch = {
    at: new Date().toISOString(),
    utmSource: q.get("utm_source"),
    utmMedium: q.get("utm_medium"),
    utmCampaign: q.get("utm_campaign"),
    utmContent: q.get("utm_content"),
    utmTerm: q.get("utm_term"),
    referrer: externalReferrer,
    landingPage: `${url.pathname}${url.search}`.slice(0, 1000),
    ...(Object.keys(clickIds).length ? { clickIds } : {}),
  };
  const local = storage("local");
  if (local && !local.getItem(FIRST_KEY)) local.setItem(FIRST_KEY, JSON.stringify(touch));
  local?.setItem(LAST_KEY, JSON.stringify(touch));
  if (clickIds.ttclid) storage("session")?.setItem("sf_ttclid", clickIds.ttclid);
}

export function clearTouches() {
  storage("local")?.removeItem(FIRST_KEY);
  storage("local")?.removeItem(LAST_KEY);
  storage("session")?.removeItem("sf_ttclid");
}

function parseTouch(key: string): Touch | null {
  try {
    const raw = storage("local")?.getItem(key);
    return raw ? (JSON.parse(raw) as Touch) : null;
  } catch {
    return null;
  }
}

function gaClientId(): string | null {
  const ga = readCookie("_ga");
  const parts = ga?.split(".") ?? [];
  return parts.length >= 4 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : null;
}

/** Sends consent, touches and identifiers to the cart before an order is created. */
export async function syncAttribution(): Promise<void> {
  const consent = readConsent();
  const c = { analytics: Boolean(consent?.analytics), marketing: Boolean(consent?.marketing) };
  const body = {
    consent: c,
    firstTouch: c.analytics || c.marketing ? parseTouch(FIRST_KEY) : null,
    lastTouch: c.analytics || c.marketing ? parseTouch(LAST_KEY) : null,
    identifiers: {
      fbp: c.marketing ? readCookie("_fbp") : null,
      fbc: c.marketing ? readCookie("_fbc") : null,
      ttp: c.marketing ? readCookie("_ttp") : null,
      ttclid: c.marketing ? (storage("session")?.getItem("sf_ttclid") ?? null) : null,
      gaClientId: c.analytics ? gaClientId() : null,
    },
  };
  await fetch("/api/cart/attribution", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}
