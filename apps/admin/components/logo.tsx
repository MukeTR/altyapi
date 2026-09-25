import { cn } from "@/lib/cn";

/** Wordmark; decorative when a visible product name is next to it. */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0">
        <rect width="24" height="24" rx="6" className="fill-accent" />
        <path d="M6 16.5 10.5 7h3L18 16.5h-3l-.9-2.1H9.9L9 16.5H6Zm4.8-4.3h2.4L12 9.3l-1.2 2.9Z" fill="#fff" />
      </svg>
      {withText ? <span className="text-md font-semibold tracking-tight">altyapi</span> : null}
    </span>
  );
}
