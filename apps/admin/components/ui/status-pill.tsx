"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import type { Messages } from "@/lib/i18n/messages/tr";
import { cn } from "@/lib/cn";
import { TONE_CLASSES, type Tone } from "./badge";

export type StatusDomain = keyof Messages["statuses"];

/** Tone per status value; values missing here (e.g. a new backend state) render neutral. */
const STATUS_TONES: { [D in StatusDomain]?: Record<string, Tone> } = {
  store: { setup: "warning", active: "success", paused: "neutral", closed: "neutral" },
  order: { draft: "neutral", awaiting_payment: "warning", confirmed: "info", processing: "info", partially_fulfilled: "info", fulfilled: "success" },
  payment: { unpaid: "warning", pending: "warning", paid: "success", partially_refunded: "info", failed: "danger" },
  paymentAttempt: { pending: "warning", requires_action: "warning", paid: "success", partially_refunded: "info", failed: "danger" },
  fulfillment: { unfulfilled: "warning", partially_fulfilled: "info", fulfilled: "success" },
  shipment: { in_progress: "info", shipped: "info", delivered: "success" },
  refund: { pending: "warning", succeeded: "success", failed: "danger" },
  return: { requested: "warning", approved: "info", received: "success", refunded: "success" },
  product: { active: "success" },
  domain: { awaiting_dns: "warning", validating: "info", certificate_pending: "info", active: "success", failed: "danger", moved: "warning" },
  ssl: { initializing: "info", pending_validation: "info", pending_issuance: "info", pending_deployment: "info", active: "success", expired: "danger", deleted: "danger" },
  page: { published: "success", scheduled: "info" },
  asset: { uploaded: "info", processing: "info", ready: "success", failed: "danger" },
  import: {
    analyzing: "info",
    awaiting_mapping: "warning",
    previewing: "info",
    ready: "info",
    processing: "info",
    completed: "success",
    completed_with_errors: "warning",
    failed: "danger",
  },
  paymentConnection: { active: "success", error: "danger" },
  paymentMode: { test: "warning", live: "success" },
  integrationConnection: { active: "success", error: "danger" },
  syncRun: { running: "info", succeeded: "success", partial: "warning", failed: "danger" },
  link: { pending: "warning", awaiting_approval: "warning", active: "success" },
  discrepancy: { open: "warning", acknowledged: "info", resolved: "success" },
  suggestion: { new: "info", applied: "success" },
  opportunity: { new: "info", drafted: "success" },
  alertSeverity: { info: "info", warning: "warning", critical: "danger" },
  member: { active: "success", invited: "info" },
  transfer: { in_transit: "info", received: "success" },
  delivery: { sent: "success", failed: "danger" },
  contentEntry: { published: "success", scheduled: "info", draft: "neutral", archived: "neutral" },
  contentType: { active: "success", archived: "neutral" },
  siteModule: { enabled: "success", locked_on: "accent", disabled: "neutral", locked_off: "warning" },
  siteLocation: { active: "success", hidden: "neutral" },
};

export function statusTone(domain: StatusDomain, value: string): Tone {
  return STATUS_TONES[domain]?.[value] ?? "neutral";
}

export interface StatusPillProps {
  domain: StatusDomain;
  value: string;
  /** Hide the leading dot (e.g. in dense tables). */
  noDot?: boolean;
  className?: string;
}

/**
 * Localized status label with a tone. Values like "rollback:12" (a publication reason with a
 * reference) render as "Geri alındı #12". Unknown values show the raw value, so a new backend
 * state never breaks a screen.
 */
export function StatusPill({ domain, value, noDot, className }: StatusPillProps) {
  const { t } = useI18n();
  const [base = value, ref] = value.split(":");
  const label = t.maybe(`statuses.${domain}.${base}`) ?? value;
  const tone = statusTone(domain, base);
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium", TONE_CLASSES[tone], className)}>
      {noDot ? null : <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {label}
      {ref && /^\d+$/.test(ref) ? <span className="tabular">#{ref}</span> : null}
    </span>
  );
}
