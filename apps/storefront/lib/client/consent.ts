"use client";

/**
 * Visitor consent state, kept in a first-party cookie so the server and every tab agree.
 * "necessary" is always on; the other categories default to off until the visitor chooses.
 */
export interface ConsentState {
  policyVersion: string;
  analytics: boolean;
  marketing: boolean;
  personalization: boolean;
  decidedAt: number;
}

export const CONSENT_COOKIE = "altyapi_consent";
const ANON_COOKIE = "altyapi_aid";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string, maxAge: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function readConsent(): ConsentState | null {
  const raw = readCookie(CONSENT_COOKIE);
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const v = p.get("v");
  if (!v) return null;
  return { policyVersion: v, analytics: p.get("a") === "1", marketing: p.get("m") === "1", personalization: p.get("p") === "1", decidedAt: Number(p.get("t")) || 0 };
}

/** Consent that is valid for the current policy version, or null when the visitor must be asked. */
export function currentConsent(policyVersion: string): ConsentState | null {
  const c = readConsent();
  return c && c.policyVersion === policyVersion ? c : null;
}

export function anonymousId(): string {
  let id = readCookie(ANON_COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    writeCookie(ANON_COOKIE, id, ONE_YEAR);
  }
  return id;
}

export function saveConsent(state: Omit<ConsentState, "decidedAt">): ConsentState {
  const full = { ...state, decidedAt: Math.floor(Date.now() / 1000) };
  const value = new URLSearchParams({ v: full.policyVersion, a: full.analytics ? "1" : "0", m: full.marketing ? "1" : "0", p: full.personalization ? "1" : "0", t: String(full.decidedAt) });
  writeCookie(CONSENT_COOKIE, value.toString(), ONE_YEAR / 2);
  window.dispatchEvent(new CustomEvent<ConsentState>("sf:consent", { detail: full }));
  return full;
}

export function openConsentPreferences() {
  window.dispatchEvent(new Event("sf:open-consent"));
}
