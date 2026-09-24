import type { PeerProduct } from "./constants";

/**
 * Peer base addresses come only from a static per-environment map (§2); request data can
 * never choose where altyapi sends a signed request. Production bases must be https and
 * must not point at localhost; plain http and localhost are accepted only in development
 * (APP_ENV=local).
 */

export interface EkosistemEnv {
  APP_ENV: string;
  API_URL: string;
  EKOSISTEM_PUBLIC_BASE?: string | undefined;
  EKOSISTEM_PEER_BASE_KARMATIK?: string | undefined;
  EKOSISTEM_PEER_BASE_YANIT?: string | undefined;
}

export type PeerBases = Readonly<Record<PeerProduct, string | null>>;

export interface PeerBaseProblem {
  variable: string;
  reason: string;
}

export function isDevelopmentEnv(appEnv: string): boolean {
  return appEnv === "local" || appEnv === "development";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(h) || h.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Validates one base URL; returns the normalised base (no trailing slash) or a reason. */
export function checkPeerBase(value: string, appEnv: string): { ok: true; base: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  const dev = isDevelopmentEnv(appEnv);
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) return { ok: false, reason: dev ? "must use http or https" : "must use https" };
  if (url.username || url.password) return { ok: false, reason: "must not contain credentials" };
  if (url.search || url.hash) return { ok: false, reason: "must not contain a query string or fragment" };
  if (isLoopback(url.hostname) && !dev) return { ok: false, reason: "localhost is only allowed when APP_ENV=local" };
  if (/\/ekosistem(\/|$)/.test(url.pathname)) return { ok: false, reason: "must not include /ekosistem/v1 (it is appended per request)" };
  return { ok: true, base: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

const PEER_VARS: Record<PeerProduct, keyof EkosistemEnv> = {
  karmatik: "EKOSISTEM_PEER_BASE_KARMATIK",
  yanit: "EKOSISTEM_PEER_BASE_YANIT",
};

/** Resolves the peer map; bases violating the policy are dropped and reported. */
export function resolvePeerBases(env: EkosistemEnv): { bases: PeerBases; problems: PeerBaseProblem[] } {
  const problems: PeerBaseProblem[] = [];
  const bases: Record<PeerProduct, string | null> = { karmatik: null, yanit: null };
  for (const peer of Object.keys(PEER_VARS) as PeerProduct[]) {
    const variable = PEER_VARS[peer];
    const value = env[variable];
    if (!value) continue;
    const checked = checkPeerBase(value, env.APP_ENV);
    if (checked.ok) bases[peer] = checked.base;
    else problems.push({ variable, reason: checked.reason });
  }
  const own = env.EKOSISTEM_PUBLIC_BASE;
  if (own) {
    const checked = checkPeerBase(own, env.APP_ENV);
    if (!checked.ok) problems.push({ variable: "EKOSISTEM_PUBLIC_BASE", reason: checked.reason });
  }
  return { bases, problems };
}

/** altyapi's own public base (the part before /ekosistem/v1); defaults to API_URL. */
export function ekosistemPublicBase(env: EkosistemEnv): string {
  const raw = env.EKOSISTEM_PUBLIC_BASE ?? env.API_URL;
  const checked = checkPeerBase(raw, env.APP_ENV);
  return checked.ok ? checked.base : raw.replace(/\/+$/, "");
}
