"use client";

/**
 * Storefront event bus. Components emit events here; the tracking layer (pixels and
 * analytics, subject to consent) subscribes to "sf:track", so components never talk to
 * vendors directly. Events emitted before the layer attaches are buffered and replayed.
 */
export interface TrackEvent {
  name: string;
  properties?: Record<string, unknown>;
}

interface TrackWindow {
  __sfTrackBuffer?: TrackEvent[];
  __sfTrackLive?: boolean;
}

export function track(name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const w = window as unknown as TrackWindow;
  const detail = { name, properties };
  if (!w.__sfTrackLive) {
    w.__sfTrackBuffer = [...(w.__sfTrackBuffer ?? []), detail].slice(-50);
    return;
  }
  window.dispatchEvent(new CustomEvent<TrackEvent>("sf:track", { detail }));
}

/** Called once by the subscriber: returns buffered events and switches to live dispatch. */
export function goLive(): TrackEvent[] {
  const w = window as unknown as TrackWindow;
  const buffered = w.__sfTrackBuffer ?? [];
  w.__sfTrackBuffer = [];
  w.__sfTrackLive = true;
  return buffered;
}

/** Called when the subscriber detaches: events are buffered again until the next goLive. */
export function goIdle() {
  (window as unknown as TrackWindow).__sfTrackLive = false;
}
