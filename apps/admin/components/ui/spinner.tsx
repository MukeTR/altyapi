import { cn } from "@/lib/cn";

/** Decorative spinner; the busy state itself is announced by the owning control (aria-busy). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={cn("size-4 animate-spin-slow", className)}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
