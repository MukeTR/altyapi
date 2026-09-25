import { cn } from "@/lib/cn";

/** Shared look of text-like controls (input, textarea, select trigger, combobox trigger). */
export function controlClasses(opts: { size?: "sm" | "md" | "lg"; invalid?: boolean; className?: string } = {}): string {
  const size = opts.size ?? "md";
  return cn(
    "w-full min-w-0 rounded-md border bg-surface text-fg shadow-xs transition-colors",
    "placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
    opts.invalid ? "border-danger" : "border-border-control",
    size === "sm" ? "h-7 px-2 text-sm" : size === "lg" ? "h-9 px-3 text-base" : "h-8 px-2.5 text-base",
    opts.className,
  );
}
