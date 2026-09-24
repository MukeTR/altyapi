"use client";

import { useEffect, useState } from "react";

export function AnnouncementBar({
  messages,
  rotateSeconds,
  dismissible,
  scheme,
  closeLabel,
  sectionId,
}: {
  messages: { text: string; href: string | null }[];
  rotateSeconds: number;
  dismissible: boolean;
  scheme: string;
  closeLabel: string;
  sectionId: string;
}) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`sf_ann_${sectionId}`) === "1") setDismissed(true);
    } catch {
      // storage unavailable: keep visible
    }
    if (messages.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), rotateSeconds * 1000);
    return () => clearInterval(id);
  }, [messages.length, rotateSeconds, sectionId]);
  if (dismissed || !messages.length) return null;
  const m = messages[index]!;
  return (
    <div data-scheme={scheme} className="relative px-10 py-2 text-center text-sm" role="region" aria-live="polite">
      {m.href ? <a href={m.href} className="underline-offset-2 hover:underline">{m.text}</a> : <span>{m.text}</span>}
      {dismissible && (
        <button
          type="button"
          aria-label={closeLabel}
          className="absolute end-3 top-1/2 -translate-y-1/2 px-2"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(`sf_ann_${sectionId}`, "1");
            } catch {
              // ignore
            }
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
