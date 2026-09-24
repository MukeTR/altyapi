"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Chevron drawn for left-to-right pages and mirrored in right-to-left ones. */
function Chevron({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rtl:-scale-x-100">
      <path d={direction === "previous" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

/**
 * Accessible carousel: keyboard arrows, pause on hover/focus, respects reduced motion.
 * Follows the page direction: in right-to-left pages slides advance to the left.
 */
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
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        // Arrow keys follow the reading direction: in right-to-left pages the left arrow moves forward.
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        go(index + ((e.key === "ArrowRight") !== rtl ? 1 : -1));
      }}
    >
      {/* --sf-dir is -1 in right-to-left pages, where the slide track runs from right to left. */}
      <div className="flex transition-transform duration-500" style={{ transform: `translateX(calc(var(--sf-dir, 1) * ${-index * 100}%))` }}>
        {slides.map((s, i) => (
          <div key={i} className="w-full shrink-0" role="group" aria-roledescription="slide" aria-label={`${labels.slide} ${i + 1}/${count}`} aria-hidden={i !== index} inert={i !== index}>
            {s}
          </div>
        ))}
      </div>
      {showArrows && count > 1 && (
        <>
          <button type="button" aria-label={labels.previous} onClick={() => go(index - 1)} className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-fg shadow">
            <Chevron direction="previous" />
          </button>
          <button type="button" aria-label={labels.next} onClick={() => go(index + 1)} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-fg shadow">
            <Chevron direction="next" />
          </button>
        </>
      )}
      {showDots && count > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
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
