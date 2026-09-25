"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Horizontal scroll container that shows a soft edge shadow on the side(s) with hidden content,
 * so an overflowing table is visibly scrollable. The container is focusable only while it
 * overflows, which lets keyboard users scroll it with the arrow keys.
 */
export function ScrollX({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // scrollLeft is negative in RTL layouts; compare magnitudes.
    const pos = Math.abs(el.scrollLeft);
    const next = { start: max > 1 && pos > 1, end: max > 1 && pos < max - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  const overflowing = edges.start || edges.end;
  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        onScroll={measure}
        tabIndex={overflowing ? 0 : undefined}
        role={overflowing ? "region" : undefined}
        aria-label={overflowing ? label : undefined}
        className="overflow-x-auto rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {children}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 start-0 w-6 rounded-s-[inherit] bg-gradient-to-r from-fg/10 to-transparent transition-opacity rtl:bg-gradient-to-l",
          edges.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 end-0 w-6 rounded-e-[inherit] bg-gradient-to-l from-fg/10 to-transparent transition-opacity rtl:bg-gradient-to-r",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
