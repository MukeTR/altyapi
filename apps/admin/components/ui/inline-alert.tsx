import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; icon: typeof Info }> = {
  info: { box: "border-info/30 bg-info-bg text-info", icon: Info },
  success: { box: "border-success/30 bg-success-bg text-success", icon: CircleCheck },
  warning: { box: "border-warning/30 bg-warning-bg text-warning", icon: TriangleAlert },
  danger: { box: "border-danger/30 bg-danger-bg text-danger", icon: CircleAlert },
};

export interface InlineAlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** role=alert for errors that appear after a user action; status for passive notices. */
  live?: "alert" | "status" | "off";
  className?: string;
  id?: string;
  tabIndex?: number;
}

/** Callout inside a page or form (protected layer notices, sandbox mode, profit guard, errors). */
export function InlineAlert({ tone = "info", title, children, actions, live = "off", className, id, tabIndex }: InlineAlertProps) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div
      id={id}
      tabIndex={tabIndex}
      role={live === "off" ? undefined : live}
      className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-base", box, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-fg [&_a]:text-link">{children}</div> : null}
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
