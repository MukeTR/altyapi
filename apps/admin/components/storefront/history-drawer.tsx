"use client";

import { History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { HistoryItem, HistoryList, HistoryMoveResult, HistoryResource } from "@/lib/storefront/types";

/** Label of a revision: its source, plus what the label refers to ("restore:5", "navigation:main"). */
export function useRevisionLabel() {
  const { t } = useI18n();
  return (item: Pick<HistoryItem, "source" | "label">) => {
    const [kind, ref] = (item.label ?? "").split(":");
    if (kind === "restore" && ref) return t("storefront.history.restoredFrom", { revision: ref });
    if (kind === "navigation" && ref) return t("storefront.history.navigationChange", { handle: ref });
    if (kind === "baseline") return t("storefront.history.baseline");
    return t.maybe(`storefront.history.sources.${item.source}`) ?? item.source;
  };
}

/**
 * Draft history of a page, the theme or a menu: every saved revision, newest first. Restoring
 * copies an older revision into a new one (nothing is lost, and it can be undone). The live site
 * changes only when the draft is published.
 */
export function HistoryDrawer({
  open,
  onOpenChange,
  resource,
  resourceId,
  endpoint,
  title,
  canRestore,
  beforeRestore,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: HistoryResource;
  resourceId: string;
  /** API path of the history when it is not the storefront one (content entries: …/content/entries/:id/history). */
  endpoint?: string;
  title: string;
  canRestore: boolean;
  /** Saves pending edits first; resolve false to cancel. */
  beforeRestore?: () => Promise<boolean>;
  onRestored: (result: HistoryMoveResult) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { apiBase, user } = useStore();
  const { toast, toastError } = useToast();
  const labelOf = useRevisionLabel();
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; data: HistoryList } | { status: "error"; error: ApiErrorInfo }>({ status: "loading" });
  const [busy, setBusy] = useState<number | null>(null);

  const historyPath = endpoint ?? `${apiBase}/storefront/history/${resource}/${resourceId}`;
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await bff<HistoryList>(historyPath) });
    } catch (err) {
      if (err instanceof ApiError) setState({ status: "error", error: err.toInfo() });
      else throw err;
    }
  }, [historyPath]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (revision: number) => {
    if (state.status !== "ready") return;
    setBusy(revision);
    try {
      if (beforeRestore && !(await beforeRestore())) return;
      const current = await bff<HistoryList>(historyPath);
      const result = await bff<HistoryMoveResult>(`${historyPath}/restore`, {
        method: "POST",
        body: { revision, expectedRevision: current.currentRevision },
      });
      await onRestored(result);
      toast({ tone: "success", title: t("storefront.history.restored", { revision }) });
      await load();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo(), t("storefront.history.restoreFailed"));
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const who = (item: HistoryItem) =>
    item.agentId ? t("storefront.history.byAgent") : item.principalType === "system" ? t("storefront.history.bySystem") : item.principalId === user.id ? t("storefront.history.byYou") : t("storefront.history.byOther");

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={t("storefront.history.title")} description={title} width={480}>
      {state.status === "loading" ? (
        <div className="p-5">
          <SkeletonText lines={8} />
        </div>
      ) : state.status === "error" ? (
        <ErrorState error={state.error} compact onRetry={() => void load()} />
      ) : state.data.items.length === 0 ? (
        <EmptyState icon={History} title={t("storefront.history.emptyTitle")} description={t("storefront.history.emptyBody")} />
      ) : (
        <ol aria-label={t("storefront.history.title")} className="flex flex-col divide-y divide-border">
          {state.data.items.map((item) => (
            <li key={item.revision} className="flex items-start gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-base text-fg">
                  <span className="font-medium tabular">#{item.revision}</span>
                  <span>{labelOf(item)}</span>
                  {item.isCurrent ? <Badge tone="accent">{t("storefront.history.current")}</Badge> : null}
                </span>
                <span className="text-sm text-fg-muted">
                  <DateTime value={item.createdAt} format="relative" /> · {who(item)}
                </span>
              </div>
              {canRestore && !item.isCurrent ? (
                <Button size="sm" onClick={() => void restore(item.revision)} loading={busy === item.revision} disabled={busy !== null}>
                  <RotateCcw aria-hidden="true" />
                  {t("storefront.history.restore")}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
