"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { VisibilityRules } from "@altyapi/database";

function device(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

function globMatch(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(path);
}

/** Session-scoped UTM values so targeting survives navigation within the visit. */
function utm(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const fromUrl: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
    const v = params.get(k);
    if (v) fromUrl[k] = v.toLowerCase();
  }
  try {
    if (Object.keys(fromUrl).length) sessionStorage.setItem("sf_utm", JSON.stringify(fromUrl));
    return Object.keys(fromUrl).length ? fromUrl : (JSON.parse(sessionStorage.getItem("sf_utm") ?? "{}") as Record<string, string>);
  } catch {
    return fromUrl;
  }
}

export function evaluateRules(rules: VisibilityRules, ctx: { locale: string; segmentIds: string[] }): boolean {
  const path = window.location.pathname;
  if (rules.devices?.length && !rules.devices.includes(device())) return false;
  if (rules.routes?.length && !rules.routes.some((r) => globMatch(r, path))) return false;
  if (rules.excludeRoutes?.some((r) => globMatch(r, path))) return false;
  if (rules.locales?.length && !rules.locales.includes(ctx.locale)) return false;
  if (rules.utm) {
    const u = utm();
    const check = (vals: string[] | undefined, v: string | undefined) => !vals?.length || (v !== undefined && vals.map((x) => x.toLowerCase()).includes(v));
    if (!check(rules.utm.source, u.utm_source) || !check(rules.utm.medium, u.utm_medium) || !check(rules.utm.campaign, u.utm_campaign)) return false;
  }
  if (rules.referrerContains?.length && !rules.referrerContains.some((r) => document.referrer.includes(r))) return false;
  // Segment targeting requires a known customer in one of the segments.
  if (rules.segmentIds?.length && !rules.segmentIds.some((s) => ctx.segmentIds.includes(s))) return false;
  return true;
}

/**
 * Client-side targeting (device, route, locale, UTM, referrer, segment). Content stays hidden
 * until evaluated so visitors never see a flash of untargeted marketing content.
 */
export function VisibilityGate({ rules, locale, children }: { rules: VisibilityRules; locale: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const segmentIds = (window as unknown as { __sfSegments?: string[] }).__sfSegments ?? [];
    setVisible(evaluateRules(rules, { locale, segmentIds }));
  }, [rules, locale]);
  return <div hidden={!visible}>{children}</div>;
}
