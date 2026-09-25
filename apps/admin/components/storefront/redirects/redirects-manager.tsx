"use client";

import { ArrowRight, FileUp, MoreHorizontal, PencilLine, Plus, Route, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { Redirect } from "@/lib/storefront/types";
import { RedirectDialog } from "./redirect-dialog";
import { ImportRedirectsDialog } from "./import-redirects-dialog";

/** URL redirects of the storefront: manual ones, those created when a page or collection address changed, and imports. */
export function RedirectsManager({ redirects }: { redirects: Redirect[] }) {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Redirect | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<Redirect | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const canWrite = can("storefront:write");
  const refresh = () => startRefresh(() => router.refresh());

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? redirects.filter((r) => r.fromPath.toLowerCase().includes(q) || r.toPath.toLowerCase().includes(q)) : redirects;
  }, [redirects, query]);

  const remove = async () => {
    if (!deleting) return;
    setPending(true);
    setError(null);
    try {
      await bff(`${apiBase}/storefront/redirects/${deleting.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("storefront.redirects.deleted") });
      setDeleting(null);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const columns: Column<Redirect>[] = [
    {
      id: "from",
      header: t("storefront.redirects.columns.from"),
      sortValue: (r) => r.fromPath,
      cell: (r) => <span className="break-all font-mono text-sm">{r.fromPath}</span>,
    },
    {
      id: "to",
      header: t("storefront.redirects.columns.to"),
      sortValue: (r) => r.toPath,
      cell: (r) => (
        <span className="flex items-center gap-1.5 font-mono text-sm">
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle rtl:rotate-180" />
          <span className="break-all">{r.toPath}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("storefront.redirects.columns.type"),
      sortValue: (r) => r.statusCode,
      cell: (r) => <Badge tone={r.statusCode === 301 ? "neutral" : "info"}>{r.statusCode === 301 ? t("storefront.redirects.permanent") : t("storefront.redirects.temporary")}</Badge>,
    },
    {
      id: "source",
      header: t("storefront.redirects.columns.source"),
      sortValue: (r) => r.source,
      cell: (r) => <span className="text-sm text-fg-muted">{t.maybe(`storefront.redirects.sources.${r.source}`) ?? r.source}</span>,
    },
    {
      id: "created",
      header: t("storefront.redirects.columns.created"),
      sortValue: (r) => r.updatedAt ?? r.createdAt,
      cell: (r) => <DateTime value={r.updatedAt ?? r.createdAt} format="date" className="text-sm" />,
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: t("common.actions"),
            srOnlyHeader: true,
            align: "end" as const,
            width: "3rem",
            cell: (r: Redirect) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={t("common.rowActions", { name: r.fromPath })}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setEditing(r)}>
                    <PencilLine aria-hidden="true" />
                    {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleting(r)}>
                    <Trash2 aria-hidden="true" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={t("storefront.redirects.title")}
        meta={t("storefront.redirects.description")}
        actions={
          canWrite ? (
            <>
              <Button onClick={() => setImportOpen(true)}>
                <FileUp aria-hidden="true" />
                {t("storefront.redirects.import")}
              </Button>
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus aria-hidden="true" />
                {t("storefront.redirects.new")}
              </Button>
            </>
          ) : null
        }
      />
      <Card flush>
        {redirects.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("storefront.redirects.searchPlaceholder")}
              aria-label={t("storefront.redirects.searchPlaceholder")}
              className="max-w-sm"
            />
            <span className="text-sm text-fg-muted" aria-live="polite">
              {t("storefront.redirects.count", { count: rows.length })}
            </span>
          </div>
        ) : null}
        <DataTable
          caption={t("storefront.redirects.title")}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sortable
          defaultSort={{ id: "from", direction: "asc" }}
          empty={
            redirects.length === 0 ? (
              <EmptyState
                icon={Route}
                title={t("storefront.redirects.emptyTitle")}
                description={t("storefront.redirects.emptyBody")}
                actions={
                  canWrite ? (
                    <Button variant="primary" onClick={() => setEditing("new")}>
                      <Plus aria-hidden="true" />
                      {t("storefront.redirects.new")}
                    </Button>
                  ) : null
                }
              />
            ) : (
              <EmptyState icon={Route} title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<Button onClick={() => setQuery("")}>{t("states.clearFilters")}</Button>} />
            )
          }
        />
      </Card>
      {editing ? <RedirectDialog open onOpenChange={(o) => !o && setEditing(null)} existing={editing === "new" ? null : editing} onSaved={refresh} /> : null}
      <ImportRedirectsDialog open={importOpen} onOpenChange={setImportOpen} existing={redirects} onDone={refresh} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setError(null);
          }
        }}
        title={t("storefront.redirects.deleteTitle")}
        description={t("storefront.redirects.deleteBody", { from: deleting?.fromPath ?? "" })}
        confirmLabel={t("common.delete")}
        pending={pending}
        onConfirm={() => void remove()}
      >
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {describeError(error).message}
          </p>
        ) : null}
      </AlertDialog>
    </div>
  );
}
