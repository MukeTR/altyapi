"use client";

import { CircleAlert, Lock, RotateCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { CopyButton } from "./copy-button";

export interface ErrorStateProps {
  /** API failure to describe; null/undefined for an unexpected (non-API) error. */
  error?: ApiErrorInfo | null;
  /** Error digest from an error boundary, used as the support code when there is no correlation id. */
  digest?: string | undefined;
  title?: ReactNode;
  /** Retry handler; defaults to re-fetching the route's server data (router.refresh()). */
  onRetry?: () => void;
  /** Hide the retry button (e.g. nothing can change by retrying). */
  noRetry?: boolean;
  /** role=alert when the error replaces content after a user action. */
  announce?: boolean;
  /** Smaller variant for cards. */
  compact?: boolean;
  /** Render the title as a heading of this level (when the error is the page's main content). */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/**
 * Localized explanation of a failure with retry and the support code. 403 responses render the
 * "no permission" variant without a retry button, since retrying cannot help.
 */
export function ErrorState({ error, digest, title, onRetry, noRetry, announce, compact, headingLevel, className }: ErrorStateProps) {
  const { t, describeError } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const forbidden = error?.status === 403 && error.code === "forbidden";
  const network = error?.status === 0;
  const described = error ? describeError(error) : null;
  const supportCode = described?.correlationId ?? digest ?? null;
  const Icon = forbidden ? Lock : network ? WifiOff : CircleAlert;

  const heading = title ?? (forbidden ? t("states.forbiddenTitle") : network ? t("states.networkTitle") : t("states.errorTitle"));
  const body = forbidden ? t("states.forbiddenBody") : network ? t("states.networkBody") : (described?.message ?? t("states.unexpected"));
  const Heading = headingLevel ? (`h${headingLevel}` as const) : "p";

  const retry = () => {
    if (onRetry) onRetry();
    else startTransition(() => router.refresh());
  };

  return (
    <div
      role={announce ? "alert" : undefined}
      className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "px-4 py-6" : "px-6 py-12", className)}
    >
      <span className={cn("inline-flex items-center justify-center rounded-full", compact ? "size-8" : "mb-1 size-10", forbidden ? "bg-surface-muted text-fg-muted" : "bg-danger-bg text-danger")}>
        <Icon aria-hidden="true" className={compact ? "size-4" : "size-5"} />
      </span>
      <Heading className={cn("font-semibold text-fg", compact ? "text-base" : "text-md")}>{heading}</Heading>
      <p className="max-w-md text-base text-fg-muted">{body}</p>
      {forbidden && described?.permission ? (
        <p className="text-sm text-fg-subtle">{t("states.forbiddenPermission", { permission: described.permission })}</p>
      ) : null}
      {!forbidden && !noRetry ? (
        <Button size={compact ? "sm" : "md"} onClick={retry} loading={pending} className="mt-2">
          <RotateCw aria-hidden="true" />
          {t("common.retry")}
        </Button>
      ) : null}
      {supportCode ? (
        <p className="mt-1 inline-flex items-center gap-1 text-sm text-fg-subtle">
          {t("common.supportCode")}: <code className="font-mono text-xs">{supportCode}</code>
          <CopyButton value={supportCode} label={t("common.supportCode")} />
        </p>
      ) : null}
    </div>
  );
}
