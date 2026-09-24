"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Accessible carousel: keyboard arrows, pause on hover/focus, respects reduced motion. */
export function Slider({
  slides,
  autoplay,
  intervalSeconds,
  showArrows,
  showDots,
  labels,
}: {
  slides: ReactNode[];
  autoplay: boolean;
  intervalSeconds: number;
  showArrows: boolean;
  showDots: boolean;
  labels: { previous: string; next: string; slide: string };
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    if (!autoplay || paused || count < 2 || reduced.current) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [autoplay, paused, count, intervalSeconds]);
  if (!count) return null;
  return (
    <div
      className="relative overflow-hidden"
      role="region"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(index - 1);
        if (e.key === "ArrowRight") go(index + 1);
      }}
    >
      <div className="flex transition-transform duration-500" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((s, i) => (
          <div key={i} className="w-full shrink-0" role="group" aria-roledescription="slide" aria-label={`${labels.slide} ${i + 1}/${count}`} aria-hidden={i !== index} inert={i !== index}>
            {s}
          </div>
        ))}
      </div>
      {showArrows && count > 1 && (
        <>
          <button type="button" aria-label={labels.previous} onClick={() => go(index - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 px-3 py-2 text-fg shadow">
            ‹
          </button>
          <button type="button" aria-label={labels.next} onClick={() => go(index + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 px-3 py-2 text-fg shadow">
            ›
          </button>
        </>
      )}
      {showDots && count > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${labels.slide} ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={`h-2 w-2 rounded-full ${i === index ? "bg-surface" : "bg-surface/50"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
