"use client";

/**
 * Storefront event bus. Components emit events here; the analytics collector (and pixel
 * adapters, subject to consent) subscribe to "sf:track". Emitting has no effect until a
 * subscriber is attached, so components never talk to vendors directly.
 */
export interface TrackEvent {
  name: string;
  properties?: Record<string, unknown>;
}

export function track(name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TrackEvent>("sf:track", { detail: { name, properties } }));
}
