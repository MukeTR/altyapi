import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon-md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg shadow-xs hover:bg-accent-hover",
  secondary: "border border-border-control bg-surface text-fg shadow-xs hover:bg-surface-muted",
  ghost: "text-fg-muted hover:bg-surface-muted hover:text-fg",
  danger: "bg-danger-solid text-white shadow-xs hover:bg-danger-solid-hover",
  link: "h-auto px-0 text-link underline-offset-2 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-base",
  lg: "h-9 px-4 text-base",
  "icon-sm": "size-7",
  "icon-md": "size-8",
};

/** Class names for anything that looks like a button (<button>, <Link>, <a>). */
export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cn(
    "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium no-underline transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    variant === "link" ? "" : SIZES[size],
    className,
  );
}
