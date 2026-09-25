"use client";

import { Link2Off, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { AdminLink, CircuitState, Freshness, LocalVariant, Peer, WireMoney } from "@/lib/ekosistem/types";
import type { Permission } from "@/lib/permissions";

/** Ecosystem money (minor units + currency) with the shared Money formatter; null renders "—". */
export function WMoney({ value, className }: { value: WireMoney | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (!value) return <span className={className ?? "text-fg-subtle"}>{t("common.none")}</span>;
  return <Money amount={value.amount} currency={value.currency} {...(className ? { className } : {})} />;
}

/** A pulled row's local product: title and SKU with a link to the product, or the peer's refs. */
export function VariantCell({ variant, fallback }: { variant: LocalVariant | null; fallback: (string | null | undefined)[] }) {
  const { t } = useI18n();
  const { basePath, can } = useStore();
  if (!variant) {
    return (
      <span className="flex flex-col">
        <span className="text-fg-muted">{t("ekosistem.unmatched")}</span>
        <span className="font-mono text-xs text-fg-subtle">{fallback.filter(Boolean).join(" · ")}</span>
      </span>
    );
  }
  const title = variant.productTitle ?? variant.sku ?? variant.variantId.slice(0, 8);
  return (
    <span className="flex min-w-0 flex-col">
      {can("catalog:read") ? (
        <Link href={`${basePath}/products/${variant.productId}`} className="block max-w-72 truncate font-medium text-fg">
          {title}
        </Link>
      ) : (
        <span className="block max-w-72 truncate font-medium text-fg">{title}</span>
      )}
      <span className="font-mono text-xs text-fg-subtle">{[variant.sku, variant.barcode].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

/**
 * Shown by Kârmatik and Yanıt screens while the store has no active link: the latest link state
 * (pending, revoked…) and the way to connect, which is the real link flow in Apps › Ecosystem.
 */
export function NotLinked({ peer, link, configured }: { peer: Peer; link: AdminLink | null; configured: boolean }) {
  const { t } = useI18n();
  const { basePath, can } = useStore();
  const peerName = t(`ekosistem.peers.${peer}.name`);
  const canManage = can(`${peer}:manage` as Permission);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState
        icon={Link2Off}
        title={t("ekosistem.notLinked.title", { peer: peerName })}
        description={configured ? t(`ekosistem.peers.${peer}.notLinkedBody`) : t("ekosistem.notConfigured", { peer: peerName })}
        actions={
          <>
            {link ? <StatusPill domain="link" value={link.status} /> : null}
            <ButtonLink href={`${basePath}/apps/ekosistem`} variant={canManage && configured ? "primary" : "secondary"}>
              {canManage && configured ? t("ekosistem.notLinked.connect", { peer: peerName }) : t("ekosistem.notLinked.view")}
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}

/**
 * Body of a Kârmatik/Yanıt list page when the list request failed: no active link renders the
 * NotLinked state, anything else the ErrorState.
 */
export function PeerListError({ peer, error }: { peer: Peer; error: ApiErrorInfo }) {
  if (error.messageKey === "errors.ekosistem.no_active_link") return <NotLinked peer={peer} link={null} configured />;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <ErrorState error={error} />
    </div>
  );
}

/** How fresh each resource pulled from the peer is, and whether calls are paused. */
export function FreshnessCard({ freshness, circuit, nextPullAt, className }: { freshness: Freshness[]; circuit: CircuitState; nextPullAt: string | null; className?: string }) {
  const { t } = useI18n();
  return (
    <Card title={t("ekosistem.freshness.title")} description={t("ekosistem.freshness.description")} {...(className ? { className } : {})}>
      <div className="flex flex-col gap-3">
        {circuit === "open" ? (
          <InlineAlert tone="warning" title={t("ekosistem.freshness.circuitTitle")}>
            {t("ekosistem.freshness.circuitBody")}
          </InlineAlert>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {freshness.map((f) => (
            <li key={f.resource} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <span className="flex min-w-0 flex-col">
                <span className="text-base text-fg">{t.maybe(`ekosistem.resources.${f.resource}`) ?? f.resource}</span>
                {!f.allowed ? <span className="text-xs text-fg-muted">{t("ekosistem.freshness.notGranted")}</span> : null}
                {f.error ? (
                  <span className="flex items-center gap-1 text-xs text-danger">
                    <TriangleAlert aria-hidden="true" className="size-3" />
                    <span className="break-all">{f.error}</span>
                  </span>
                ) : null}
              </span>
              <span className="flex flex-col items-end text-sm text-fg-muted">
                {f.asOf ? (
                  <span>
                    {t("ekosistem.freshness.asOf")} <DateTime value={f.asOf} format="relative" />
                  </span>
                ) : f.allowed ? (
                  <span>{t("ekosistem.freshness.notPulled")}</span>
                ) : null}
                {f.nextDueAt ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <RefreshCw aria-hidden="true" className="size-3" />
                    <DateTime value={f.nextDueAt} format="relative" />
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {nextPullAt ? (
          <p className="text-xs text-fg-subtle">
            {t("ekosistem.freshness.next")} <DateTime value={nextPullAt} />
          </p>
        ) : null}
      </div>
    </Card>
  );
}
