import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-styles";
import { Spinner } from "./spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy while keeping its width. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Icon-only buttons must pass aria-label (and should sit in a Tooltip). */
export function Button({ variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

type LinkProps = ComponentProps<typeof Link>;

export interface ButtonLinkProps extends Omit<LinkProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

/** An in-app link styled as a button. */
export function ButtonLink({ variant = "secondary", size = "md", className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export interface ExternalButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Text announced after the label, e.g. "(opens in a new tab)". */
  newTabLabel?: string;
}

/** A link to another site, opened in a new tab, styled as a button. */
export function ExternalButtonLink({ variant = "secondary", size = "md", className, children, newTabLabel, ...rest }: ExternalButtonLinkProps) {
  return (
    <a target="_blank" rel="noopener noreferrer" className={cn(buttonClasses(variant, size, className))} {...rest}>
      {children}
      {newTabLabel ? <span className="sr-only"> ({newTabLabel})</span> : null}
    </a>
  );
}
