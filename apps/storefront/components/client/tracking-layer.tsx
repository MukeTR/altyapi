"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { minorToDecimal } from "@/lib/format";
import { currentConsent, type ConsentState } from "@/lib/client/consent";
import { captureTouch } from "@/lib/client/attribution";
import { goIdle, goLive, type TrackEvent } from "@/lib/client/track";
import type { PublicTracking } from "@/lib/tracking-types";

/**
 * Protected tracking layer. Configured in tracking settings (never in the theme) and
 * rendered by the storefront shell, so design edits, publishes and rollbacks cannot change
 * it. Vendor scripts load only after consent: Google Analytics with analytics consent;
 * Meta, TikTok and Google Ads with marketing consent (Google Consent Mode v2 signals).
 */

type Fn = (...args: unknown[]) => void;
interface VendorWindow {
  dataLayer?: unknown[];
  gtag?: Fn;
  fbq?: Fn & { callMethod?: Fn; queue?: unknown[]; loaded?: boolean; version?: string; push?: Fn };
  _fbq?: unknown;
  ttq?: unknown[] & Record<string, unknown>;
  TiktokAnalyticsObject?: string;
}

const w = () => window as unknown as VendorWindow;

function injectScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function consentSignals(c: Pick<ConsentState, "analytics" | "marketing" | "personalization">) {
  const g = (v: boolean) => (v ? "granted" : "denied");
  return {
    analytics_storage: g(c.analytics),
    ad_storage: g(c.marketing),
    ad_user_data: g(c.marketing),
    ad_personalization: g(c.marketing),
    personalization_storage: g(c.personalization),
    functionality_storage: "granted",
    security_storage: "granted",
  };
}

function ensureGtag(c: ConsentState) {
  const win = w();
  win.dataLayer = win.dataLayer ?? [];
  if (!win.gtag) {
    // gtag must queue the `arguments` object itself.
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments);
    };
    win.gtag("consent", "default", { ...consentSignals({ analytics: false, marketing: false, personalization: false }), wait_for_update: 500 });
    win.gtag("js", new Date());
  }
  win.gtag("consent", "update", consentSignals(c));
}

function loadGoogle(t: PublicTracking, c: ConsentState, loaded: Set<string>) {
  const wantsGa = Boolean(t.ga4MeasurementId && c.analytics);
  const wantsAds = Boolean(t.googleAdsConversionId && c.marketing);
  const wantsGtm = Boolean(t.gtmContainerId && (c.analytics || c.marketing));
  if (!wantsGa && !wantsAds && !wantsGtm) return;
  ensureGtag(c);
  const gtag = w().gtag!;
  if (wantsGa && !loaded.has("ga4")) {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(t.ga4MeasurementId!)}`, "sf-gtag");
    gtag("config", t.ga4MeasurementId, { send_page_view: false });
    loaded.add("ga4");
  }
  if (wantsAds && !loaded.has("ads")) {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(t.googleAdsConversionId!)}`, "sf-gtag");
    gtag("config", t.googleAdsConversionId);
    loaded.add("ads");
  }
  if (wantsGtm && !loaded.has("gtm")) {
    w().dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
    injectScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(t.gtmContainerId!)}`, "sf-gtm");
    loaded.add("gtm");
  }
}

function loadMeta(pixelId: string, loaded: Set<string>) {
  if (loaded.has("meta")) return;
  const win = w();
  if (!win.fbq) {
    // Equivalent of Meta's base pixel code: a queue until fbevents.js takes over.
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue!.push(args);
    } as NonNullable<VendorWindow["fbq"]>;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    win.fbq = n;
    if (!win._fbq) win._fbq = n;
    injectScript("https://connect.facebook.net/en_US/fbevents.js", "sf-meta");
  }
  win.fbq!("init", pixelId);
  loaded.add("meta");
}

function loadTikTok(pixelCode: string, loaded: Set<string>) {
  if (loaded.has("tiktok")) return;
  const win = w();
  // Equivalent of TikTok's base pixel code (method stubs queued until events.js loads).
  win.TiktokAnalyticsObject = "ttq";
  const ttq = (win.ttq = win.ttq ?? ([] as unknown as NonNullable<VendorWindow["ttq"]>));
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
  const defer = (target: Record<string, unknown> & unknown[], method: string) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  ttq.methods = methods;
  ttq.setAndDefer = defer;
  for (const m of methods) defer(ttq, m);
  const i = ((ttq._i as Record<string, unknown[] & Record<string, unknown>>) ??= {});
  ttq.instance = (id: string) => {
    const inst = (i[id] ?? []) as unknown[] & Record<string, unknown>;
    for (const m of methods) defer(inst, m);
    return inst;
  };
  const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
  i[pixelCode] = Object.assign([] as unknown[], { _u: src }) as unknown as unknown[] & Record<string, unknown>;
  ((ttq._t as Record<string, number>) ??= {})[pixelCode] = Date.now();
  ((ttq._o as Record<string, unknown>) ??= {})[pixelCode] = {};
  injectScript(`${src}?sdkid=${encodeURIComponent(pixelCode)}&lib=ttq`, "sf-tiktok");
  loaded.add("tiktok");
}

interface Item {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const money = (minor: unknown, currency: string) => (typeof minor === "string" && /^-?\d+$/.test(minor) ? Number(minorToDecimal(minor, currency)) : undefined);

function items(p: Record<string, unknown>, currency: string): Item[] {
  const raw = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  return raw.map((i) => ({
    id: String(i.itemId ?? i.variantId ?? i.productId ?? ""),
    name: String(i.title ?? ""),
    price: money(i.unitPrice, currency) ?? 0,
    quantity: Number(i.quantity ?? 1),
  }));
}

function randomEventId(name: string) {
  return `${name}:${crypto.getRandomValues(new Uint32Array(2)).join("")}`;
}

/** Maps storefront events to vendor events. The purchase id matches the server-side conversion. */
function dispatch(t: PublicTracking, loaded: Set<string>, e: TrackEvent) {
  const p = e.properties ?? {};
  const currency = String(p.currency ?? "TRY");
  const list = items(p, currency);
  const value = money(p.value, currency);
  const gtag = w().gtag;
  const fbq = w().fbq;
  const ttq = w().ttq as unknown as { track?: Fn } | undefined;
  const ga = (name: string, params: Record<string, unknown>) => loaded.has("ga4") && gtag?.("event", name, { send_to: t.ga4MeasurementId, ...params });
  const meta = (name: string, params: Record<string, unknown>, eventID: string) => loaded.has("meta") && fbq?.("track", name, params, { eventID });
  const tiktok = (name: string, params: Record<string, unknown>, eventId: string) => loaded.has("tiktok") && ttq?.track?.(name, params, { event_id: eventId });
  const gaItems = list.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity }));
  const metaParams = { currency, value, content_type: "product", content_ids: list.map((i) => i.id), contents: list.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })) };
  const ttParams = { currency, value, content_type: "product", contents: list.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity, price: i.price })) };

  if (loaded.has("gtm")) w().dataLayer!.push({ event: `sf_${e.name}`, sf: p, ecommerce: { currency, value, items: gaItems } });

  switch (e.name) {
    case "product_viewed": {
      const id = randomEventId("view");
      ga("view_item", { currency, value, items: gaItems });
      meta("ViewContent", metaParams, id);
      tiktok("ViewContent", ttParams, id);
      break;
    }
    case "product_added_to_cart": {
      const id = randomEventId("atc");
      ga("add_to_cart", { currency, value, items: gaItems });
      meta("AddToCart", metaParams, id);
      tiktok("AddToCart", ttParams, id);
      break;
    }
    case "checkout_started": {
      const id = randomEventId("checkout");
      ga("begin_checkout", { currency, value, items: gaItems });
      meta("InitiateCheckout", { ...metaParams, num_items: list.reduce((s, i) => s + i.quantity, 0) }, id);
      tiktok("InitiateCheckout", ttParams, id);
      break;
    }
    case "payment_info_submitted": {
      const id = randomEventId("payment");
      ga("add_payment_info", { currency, value, payment_type: p.provider });
      meta("AddPaymentInfo", { currency, value }, id);
      tiktok("AddPaymentInfo", { currency, value }, id);
      break;
    }
    case "order_completed": {
      const id = `purchase:${String(p.orderId)}`;
      ga("purchase", { transaction_id: p.orderNumber, currency, value, tax: money(p.tax, currency), shipping: money(p.shipping, currency), items: gaItems });
      if (loaded.has("ads") && t.googleAdsPurchaseLabel) {
        gtag?.("event", "conversion", { send_to: `${t.googleAdsConversionId}/${t.googleAdsPurchaseLabel}`, value, currency, transaction_id: p.orderNumber });
      }
      meta("Purchase", { ...metaParams, order_id: p.orderNumber }, id);
      tiktok("CompletePayment", { ...ttParams, order_id: p.orderNumber }, id);
      break;
    }
    case "lead_submitted": {
      const id = randomEventId("lead");
      ga("generate_lead", { lead_source: p.source });
      meta("Lead", {}, id);
      tiktok("SubmitForm", {}, id);
      break;
    }
  }
}

export function TrackingLayer({ tracking }: { tracking: PublicTracking }) {
  const loaded = useRef(new Set<string>());
  const pathname = usePathname();

  // Apply consent: load what is allowed; a withdrawal reloads the page so loaded tags stop.
  useEffect(() => {
    const apply = (c: ConsentState | null) => {
      if (!c) return;
      const had = loaded.current;
      const revoked = (had.has("ga4") && !c.analytics) || ((had.has("meta") || had.has("tiktok") || had.has("ads")) && !c.marketing) || (had.has("gtm") && !c.analytics && !c.marketing);
      if (revoked) {
        w().gtag?.("consent", "update", consentSignals(c));
        if (had.has("meta")) w().fbq?.("consent", "revoke");
        window.location.reload();
        return;
      }
      if (w().gtag) w().gtag!("consent", "update", consentSignals(c));
      loadGoogle(tracking, c, had);
      if (tracking.metaPixelId && c.marketing) loadMeta(tracking.metaPixelId, had);
      if (tracking.tiktokPixelId && c.marketing) loadTikTok(tracking.tiktokPixelId, had);
      captureTouch();
    };
    apply(currentConsent(tracking.consentPolicyVersion));
    const onConsent = (e: Event) => apply((e as CustomEvent<ConsentState>).detail);
    const onTrack = (e: Event) => dispatch(tracking, loaded.current, (e as CustomEvent<TrackEvent>).detail);
    window.addEventListener("sf:consent", onConsent);
    window.addEventListener("sf:track", onTrack);
    for (const e of goLive()) dispatch(tracking, loaded.current, e);
    return () => {
      goIdle();
      window.removeEventListener("sf:consent", onConsent);
      window.removeEventListener("sf:track", onTrack);
    };
  }, [tracking]);

  // Page views on every client-side navigation.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // Consent handlers run first on mount; defer so vendors initialized in this tick receive the view.
    const id = window.setTimeout(() => {
      const l = loaded.current;
      if (l.has("ga4")) w().gtag?.("event", "page_view", { send_to: tracking.ga4MeasurementId, page_location: window.location.href, page_title: document.title });
      if (l.has("gtm")) w().dataLayer!.push({ event: "sf_page_view", page_path: pathname });
      if (l.has("meta")) w().fbq?.("track", "PageView");
      if (l.has("tiktok")) (w().ttq as unknown as { page?: Fn }).page?.();
    }, 0);
    return () => window.clearTimeout(id);
  }, [pathname, tracking]);

  return null;
}
