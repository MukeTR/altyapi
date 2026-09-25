"use client";

import { History, RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { formatNumber } from "@/lib/format";
import type { Publication } from "@/lib/storefront/types";

/** Publication history (newest first) with rollback to an earlier publication. */
export function PublicationsTable({ publications }: { publications: Publication[] }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [, startRefresh] = useTransition();
  const [target, setTarget] = useState<Publication | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const canRollback = can("storefront:publish");
  const active = publications.find((p) => p.isActive);

  const rollback = async () => {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      const pub = await bff<Publication>(`${apiBase}/storefront/publications/${target.id}/rollback`, { method: "POST" });
      toast({ tone: "success", title: t("storefront.publications.rolledBack", { number: target.number, created: pub.number }) });
      setTarget(null);
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const columns: Column<Publication>[] = [
    {
      id: "number",
      header: t("storefront.publications.columns.number"),
      width: "6rem",
      cell: (p) => <span className="font-medium tabular">#{p.number}</span>,
    },
    {
      id: "reason",
      header: t("storefront.publications.columns.reason"),
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill domain="publicationReason" value={p.reason} noDot />
          {p.isActive ? <Badge tone="success">{t("storefront.publications.live")}</Badge> : null}
        </div>
      ),
    },
    {
      id: "pages",
      header: t("storefront.publications.columns.pages"),
      align: "end",
      cell: (p) => formatNumber(p.pageCount, locale),
    },
    {
      id: "created",
      header: t("storefront.publications.columns.created"),
      cell: (p) => <DateTime value={p.createdAt} />,
    },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (p) =>
        canRollback && !p.isActive ? (
          <Button size="sm" onClick={() => setTarget(p)} aria-label={t("storefront.publications.rollbackTo", { number: p.number })}>
            <RotateCcw aria-hidden="true" />
            {t("storefront.publications.rollback")}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <Card flush title={active ? t("storefront.publications.activeTitle", { number: active.number }) : undefined} description={t("storefront.publications.description")}>
        <DataTable
          caption={t("storefront.publications.title")}
          columns={columns}
          rows={publications}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={History}
              title={t("storefront.publications.emptyTitle")}
              description={t("storefront.publications.emptyBody")}
              actions={
                <ButtonLink href={`${basePath}/storefront/editor`} variant="primary">
                  <Upload aria-hidden="true" />
                  {t("storefront.pages.openEditor")}
                </ButtonLink>
              }
            />
          }
          footer={publications.length >= 50 ? <p className="border-t border-border px-4 py-2 text-sm text-fg-muted">{t("storefront.publications.limitNote")}</p> : null}
        />
      </Card>
      <AlertDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setError(null);
          }
        }}
        title={t("storefront.publications.confirmTitle", { number: target?.number ?? 0 })}
        description={t("storefront.publications.confirmBody", { number: target?.number ?? 0 })}
        confirmLabel={t("storefront.publications.rollback")}
        tone="primary"
        pending={pending}
        onConfirm={() => void rollback()}
      >
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {describeError(error).message}
          </p>
        ) : null}
      </AlertDialog>
    </>
  );
}
