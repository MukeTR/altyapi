"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Chevron drawn for left-to-right pages and mirrored in right-to-left ones. */
function Chevron({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rtl:-scale-x-100">
      <path d={direction === "previous" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

/** Slides visible side by side per screen size: mobile, tablet (≥768px), desktop (≥1024px). */
export interface SlidesPerView {
  mobile: number;
  tablet: number;
  desktop: number;
}

/**
 * Accessible carousel: keyboard arrows, pause on hover/focus, respects reduced motion.
 * Follows the page direction: in right-to-left pages slides advance to the left.
 *
 * One slide is shown at a time unless perView is given; then several slides sit side by side
 * (their count per screen size is applied in CSS, .slider-multi) and the carousel moves one
 * slide per step. Slides outside the visible window are hidden from assistive technology and
 * taken out of the tab order.
 */
export function Slider({
  slides,
  autoplay,
  intervalSeconds,
  showArrows,
  showDots,
  labels,
  label,
  perView,
}: {
  slides: ReactNode[];
  autoplay: boolean;
  intervalSeconds: number;
  showArrows: boolean;
  showDots: boolean;
  labels: { previous: string; next: string; slide: string };
  /** Accessible name of the carousel (usually the section heading). */
  label?: string | undefined;
  perView?: SlidesPerView | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Slides visible at once; measured from CSS after mount for multi-slide carousels (null until then).
  const [visible, setVisible] = useState<number | null>(perView ? null : 1);
  const region = useRef<HTMLDivElement>(null);
  const count = slides.length;
  const positions = Math.max(1, count - (visible ?? 1) + 1);
  const current = Math.min(index, positions - 1);
  const go = useCallback((i: number) => setIndex(((i % positions) + positions) % positions), [positions]);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    const el = region.current;
    if (!perView || !el) return;
    const measure = () => setVisible(Math.max(1, Number.parseInt(getComputedStyle(el).getPropertyValue("--per-view"), 10) || 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [perView]);
  useEffect(() => {
    if (!autoplay || paused || positions < 2 || reduced.current) return;
    const id = setInterval(() => setIndex((i) => (Math.min(i, positions - 1) + 1) % positions), intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [autoplay, paused, positions, intervalSeconds]);
  if (!count) return null;
  const style = perView ? ({ "--pv-m": perView.mobile, "--pv-t": perView.tablet, "--pv-d": perView.desktop } as CSSProperties) : undefined;
  return (
    <div
      ref={region}
      className={`relative overflow-hidden ${perView ? "slider-multi -mx-3" : ""}`}
      style={style}
      role="region"
      aria-roledescription="carousel"
      aria-label={label || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        // Arrow keys follow the reading direction: in right-to-left pages the left arrow moves forward.
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        go(current + ((e.key === "ArrowRight") !== rtl ? 1 : -1));
      }}
    >
      {/* --sf-dir is -1 in right-to-left pages, where the slide track runs from right to left; --per-view is 1 for single-slide carousels. */}
      <div className="flex transition-transform duration-500" style={{ transform: `translateX(calc(var(--sf-dir, 1) * ${-current * 100}% / var(--per-view, 1)))` }}>
        {slides.map((s, i) => {
          // Before the first measurement every slide of a multi-slide carousel stays reachable.
          const hidden = visible !== null && (i < current || i >= current + visible);
          return (
            <div
              key={i}
              className={perView ? "slider-slide shrink-0 px-3" : "w-full shrink-0"}
              role="group"
              aria-roledescription="slide"
              aria-label={`${labels.slide} ${i + 1}/${count}`}
              aria-hidden={hidden}
              inert={hidden}
            >
              {s}
            </div>
          );
        })}
      </div>
      {showArrows && positions > 1 && !perView && (
        <>
          <button type="button" aria-label={labels.previous} onClick={() => go(current - 1)} className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-fg shadow">
            <Chevron direction="previous" />
          </button>
          <button type="button" aria-label={labels.next} onClick={() => go(current + 1)} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-fg shadow">
            <Chevron direction="next" />
          </button>
        </>
      )}
      {/* Side-by-side slides are cards with text: their controls sit below them instead of over them. */}
      {showArrows && positions > 1 && perView && (
        <div className="mt-4 flex justify-end gap-2 px-3">
          <button type="button" aria-label={labels.previous} onClick={() => go(current - 1)} className="rounded-full border border-line bg-surface p-2 text-fg hover:bg-muted">
            <Chevron direction="previous" />
          </button>
          <button type="button" aria-label={labels.next} onClick={() => go(current + 1)} className="rounded-full border border-line bg-surface p-2 text-fg hover:bg-muted">
            <Chevron direction="next" />
          </button>
        </div>
      )}
      {showDots && positions > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {Array.from({ length: positions }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${labels.slide} ${i + 1}`}
              aria-current={i === current}
              onClick={() => go(i)}
              className={`h-2 w-2 rounded-full ${i === current ? "bg-surface" : "bg-surface/50"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
