import { cn } from "@/lib/cn";

export function Separator({ orientation = "horizontal", decorative = true, className }: { orientation?: "horizontal" | "vertical"; decorative?: boolean; className?: string }) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
    />
  );
}
