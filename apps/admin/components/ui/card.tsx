import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons or links on the header's inline end. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Remove body padding (tables that span the card). */
  flush?: boolean;
  /** Denser padding for list pages (16px) vs forms (20px). */
  padding?: "list" | "form";
  as?: "section" | "div" | "article";
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

/** Bordered surface. As a section it is labelled by its title for landmark navigation. */
export function Card({ title, description, actions, footer, flush, padding = "list", as: As = "section", className, bodyClassName, children }: CardProps) {
  const titleId = useId();
  const pad = padding === "form" ? "p-5" : "p-4";
  const hasHeader = Boolean(title || description || actions);
  return (
    <As aria-labelledby={title && As === "section" ? titleId : undefined} className={cn("min-w-0 rounded-lg border border-border bg-surface", className)}>
      {hasHeader ? (
        <header className={cn("flex flex-wrap items-start justify-between gap-3", padding === "form" ? "px-5 pt-5" : "px-4 pt-4", flush && "pb-3")}>
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2 id={titleId} className="text-md font-semibold text-fg">
                {title}
              </h2>
            ) : null}
            {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? <div className={cn(flush ? "" : pad, hasHeader && !flush && "pt-3", bodyClassName)}>{children}</div> : null}
      {footer ? <footer className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border", padding === "form" ? "px-5 py-3" : "px-4 py-3")}>{footer}</footer> : null}
    </As>
  );
}
