"use client";

import { DataTable, type Column } from "@/components/data/data-table";
import { Bps } from "@/components/data/percent";
import { WMoney } from "@/components/ekosistem/peer-status";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { InlineAlert, type AlertTone } from "@/components/ui/inline-alert";
import type { ProfitCheckLine, ProfitCheckResult } from "@/lib/ekosistem/types";

const LINE_TONE: Record<ProfitCheckLine["status"], Tone> = { ok: "success", below_minimum: "danger", unavailable: "warning", unknown: "neutral" };
const DECISION_TONE: Record<ProfitCheckResult["decision"], AlertTone> = { allow: "success", warn: "warning", block: "danger" };

/** Result of POST …/karmatik/profit-check: the decision under the store policy and each line's floor. */
export function ProfitCheckLines({ result }: { result: ProfitCheckResult }) {
  const { t } = useI18n();
  const columns: Column<ProfitCheckLine>[] = [
    {
      id: "product",
      header: t("karmatik.columns.product"),
      cell: (l) => (
        <span className="flex flex-col">
          <span className="text-fg">{l.productTitle ?? l.sku ?? l.variantId.slice(0, 8)}</span>
          {l.sku ? <span className="font-mono text-xs text-fg-subtle">{l.sku}</span> : null}
        </span>
      ),
    },
    { id: "current", header: t("karmatik.check.current"), align: "end", cell: (l) => <WMoney value={l.currentPrice} /> },
    { id: "proposed", header: t("karmatik.check.proposed"), align: "end", cell: (l) => <WMoney value={l.proposedPrice} /> },
    { id: "discount", header: t("karmatik.check.discount"), align: "end", cell: (l) => <Bps value={l.discountBps} /> },
    { id: "floor", header: t("karmatik.columns.floor"), align: "end", cell: (l) => <WMoney value={l.floorPrice} /> },
    { id: "margin", header: t("karmatik.columns.margin"), align: "end", cell: (l) => <Bps value={l.marginBps} signed /> },
    {
      id: "status",
      header: t("karmatik.check.status"),
      cell: (l) => (
        <span className="flex flex-col items-start gap-0.5">
          <Badge tone={LINE_TONE[l.status]}>{t(`karmatik.check.lineStatus.${l.status}`)}</Badge>
          <span className="text-xs text-fg-muted">{t(`karmatik.check.source.${l.source}`)}</span>
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <InlineAlert tone={DECISION_TONE[result.decision]} title={t(`karmatik.check.decision.${result.decision}`)}>
        {!result.linked
          ? t("karmatik.check.notLinked")
          : result.policy === "ignore"
            ? t("karmatik.check.ignored")
            : result.requiresConfirmation
              ? t("karmatik.check.unavailable")
              : result.overridden
                ? t("karmatik.check.overridden")
                : t(`karmatik.guard.policies.${result.policy}.effect`)}
      </InlineAlert>
      <div className="rounded-md border border-border">
        <DataTable caption={t("karmatik.guard.checkTitle")} columns={columns} rows={result.lines} rowKey={(l) => l.variantId} stickyFirstColumn={false} />
      </div>
    </div>
  );
}
