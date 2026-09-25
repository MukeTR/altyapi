"use client";

import { CalendarClock, EyeOff, FilePlus2, FileText, MoreHorizontal, Palette, PencilLine, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { isContentPage, pagePublishPermission, pageWritePermission } from "@/lib/storefront/permissions";
import type { StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { DeletePageDialog, PublishDialog, ScheduleDialog, UnpublishDialog, pageTitleOf } from "../publish-dialogs";
import { NewPageDialog } from "./new-page-dialog";

const TEMPLATE_TYPES = new Set(["product", "collection", "cart", "search", "not_found"]);
/** Where each template is shown on the storefront. */
const TEMPLATE_PATHS: Record<string, string> = { product: "/products/…", collection: "/collections/…", cart: "/cart", search: "/search", not_found: "/…" };
const FILTERS = ["all", "page", "landing", "templates", "scheduled"] as const;
type Filter = (typeof FILTERS)[number];

type DialogState = { kind: "schedule" | "unpublish" | "delete"; page: StorefrontPage } | null;

/**
 * Storefront pages: the home page, content and landing pages and the templates, with their live
 * address, publication state and schedule. Opens the editor, creates pages and publishes.
 */
export function PagesManager({ pages, theme }: { pages: StorefrontPage[]; theme: Pick<StorefrontTheme, "name" | "hasUnpublishedChanges"> | null }) {
  const { t, locale } = useI18n();
  const { basePath, can, store } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [, startRefresh] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // "?new=1" (from the command palette or a link) opens the new-page dialog once, then leaves the URL.
  const wantsNew = params.get("new") === "1";
  const canCreate = can("content:write");
  useEffect(() => {
    if (!wantsNew) return;
    if (canCreate) setNewOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }, [wantsNew, canCreate]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const filterParam = params.get("type");
  const filter: Filter = FILTERS.includes(filterParam as Filter) ? (filterParam as Filter) : "all";

  const refresh = () => startRefresh(() => router.refresh());
  const editorHref = (p: StorefrontPage) => `${basePath}/storefront/editor?page=${p.id}`;

  const rows = useMemo(() => {
    switch (filter) {
      case "page":
      case "landing":
        return pages.filter((p) => p.type === filter);
      case "templates":
        return pages.filter((p) => TEMPLATE_TYPES.has(p.type));
      case "scheduled":
        return pages.filter((p) => p.publishAt || p.unpublishAt || p.status === "scheduled");
      default:
        return [...pages].sort((a, b) => Number(TEMPLATE_TYPES.has(a.type)) - Number(TEMPLATE_TYPES.has(b.type)) || (a.type === "home" ? -1 : b.type === "home" ? 1 : 0));
    }
  }, [pages, filter]);

  const changedCount = pages.filter((p) => p.hasUnpublishedChanges).length;
  const canPublishAny = can("storefront:publish") || can("content:publish");

  const columns: Column<StorefrontPage>[] = [
    {
      id: "title",
      header: t("storefront.pages.columns.title"),
      sortValue: (p) => pageTitleOf(p, locale, store.defaultLocale),
      cell: (p) => (
        <div className="flex min-w-0 flex-col py-1">
          <Link href={editorHref(p)} className="truncate font-medium text-fg no-underline hover:underline">
            {pageTitleOf(p, locale, store.defaultLocale)}
          </Link>
          <span className="text-xs text-fg-subtle">{t.maybe(`editor.pageTypes.${p.type}`) ?? p.type}</span>
        </div>
      ),
    },
    {
      id: "path",
      header: t("storefront.pages.columns.path"),
      sortValue: (p) => p.path ?? "",
      cell: (p) =>
        p.path === null && !p.draftPath ? (
          <span className="flex flex-col">
            <span className="font-mono text-sm">{TEMPLATE_PATHS[p.type] ?? "—"}</span>
            <span className="text-xs text-fg-subtle">{t(p.type === "not_found" ? "storefront.pages.notFoundPath" : "storefront.pages.templatePath")}</span>
          </span>
        ) : (
          <div className="flex flex-col font-mono text-sm">
            <span>{p.livePath ?? p.draftPath}</span>
            {p.livePath && p.draftPath && p.livePath !== p.draftPath ? <span className="text-xs text-fg-subtle">{t("storefront.pages.draftPath", { path: p.draftPath })}</span> : null}
          </div>
        ),
    },
    {
      id: "status",
      header: t("storefront.pages.columns.status"),
      sortValue: (p) => p.status,
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill domain="page" value={p.status} />
          {p.hasUnpublishedChanges && p.status === "published" ? <Badge tone="warning">{t("storefront.pages.unpublishedChanges")}</Badge> : null}
        </div>
      ),
    },
    {
      id: "schedule",
      header: t("storefront.pages.columns.schedule"),
      sortValue: (p) => p.publishAt ?? p.unpublishAt ?? "",
      cell: (p) =>
        p.publishAt || p.unpublishAt ? (
          <div className="flex flex-col text-sm">
            {p.publishAt ? (
              <span>
                {t("storefront.pages.publishesAt")} <DateTime value={p.publishAt} />
              </span>
            ) : null}
            {p.unpublishAt ? (
              <span className="text-fg-muted">
                {t("storefront.pages.unpublishesAt")} <DateTime value={p.unpublishAt} />
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-fg-subtle">{t("common.none")}</span>
        ),
    },
    {
      id: "updated",
      header: t("storefront.pages.columns.updated"),
      sortValue: (p) => p.updatedAt,
      cell: (p) => <DateTime value={p.updatedAt} format="relative" className="text-sm" />,
    },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      width: "3rem",
      cell: (p) => {
        const title = pageTitleOf(p, locale, store.defaultLocale);
        const canPublishPage = can(pagePublishPermission(p.type));
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t("common.rowActions", { name: title })}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLinkItem href={editorHref(p)}>
                <PencilLine aria-hidden="true" />
                {can(pageWritePermission(p.type)) ? t("storefront.pages.edit") : t("storefront.pages.view")}
              </DropdownMenuLinkItem>
              {isContentPage(p.type) && canPublishPage ? (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "schedule", page: p })}>
                  <CalendarClock aria-hidden="true" />
                  {t("storefront.pages.schedule")}
                </DropdownMenuItem>
              ) : null}
              {isContentPage(p.type) && canPublishPage && p.status === "published" ? (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "unpublish", page: p })}>
                  <EyeOff aria-hidden="true" />
                  {t("storefront.pages.unpublish")}
                </DropdownMenuItem>
              ) : null}
              {isContentPage(p.type) && can("content:write") ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger" disabled={p.status === "published"} onSelect={() => setDialog({ kind: "delete", page: p })}>
                    <Trash2 aria-hidden="true" />
                    {p.status === "published" ? t("storefront.pages.deleteUnpublishFirst") : t("storefront.pages.delete")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = (
    <div className="-mx-4">
      {changedCount > 0 && filter === "all" ? <p className="px-4 pb-2 text-sm text-fg-muted">{t("storefront.pages.changedCount", { count: changedCount })}</p> : null}
      <DataTable
        caption={t("storefront.pages.title")}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        sortable
        empty={
          pages.length === 0 ? (
            <EmptyState icon={FileText} title={t("storefront.pages.emptyTitle")} description={t("storefront.pages.emptyBody")} />
          ) : (
            <EmptyState icon={FileText} title={t("storefront.pages.filteredEmptyTitle")} description={t("storefront.pages.filteredEmptyBody")} actions={<ButtonLink href="?">{t("states.clearFilters")}</ButtonLink>} />
          )
        }
      />
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={t("storefront.pages.title")}
        meta={t("storefront.pages.description")}
        actions={
          <>
            {canPublishAny ? (
              <Button onClick={() => setPublishOpen(true)}>
                <Upload aria-hidden="true" />
                {t("storefront.pages.publish")}
              </Button>
            ) : null}
            <ButtonLink href={`${basePath}/storefront/editor`}>
              <PencilLine aria-hidden="true" />
              {t("storefront.pages.openEditor")}
            </ButtonLink>
            {canCreate ? (
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <FilePlus2 aria-hidden="true" />
                {t("storefront.pages.new")}
              </Button>
            ) : null}
          </>
        }
      />

      {theme ? (
        <Card as="section" title={t("storefront.pages.themeTitle", { name: theme.name })} description={t("storefront.pages.themeDescription")} actions={
          <ButtonLink href={`${basePath}/storefront/editor?panel=theme`} size="sm">
            <Palette aria-hidden="true" />
            {t("storefront.pages.editTheme")}
          </ButtonLink>
        }>
          {theme.hasUnpublishedChanges ? (
            <InlineAlert tone="warning">{t("storefront.pages.themeUnpublished")}</InlineAlert>
          ) : (
            <p className="text-base text-fg-muted">{t("storefront.pages.themePublished")}</p>
          )}
        </Card>
      ) : null}

      <Card flush>
        {/* The table is the active tab's panel, so the tab's aria-controls points at it. */}
        <Tabs
          className="px-4 pt-3"
          aria-label={t("storefront.pages.filterLabel")}
          searchParam="type"
          value={filter}
          items={FILTERS.map((f) => ({ value: f, label: t(`storefront.pages.filters.${f}`), content: f === filter ? table : null }))}
        />
      </Card>

      <NewPageDialog open={newOpen} onOpenChange={setNewOpen} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} pages={pages} themeHasChanges={theme?.hasUnpublishedChanges ?? null} onPublished={refresh} />
      {dialog?.kind === "schedule" ? <ScheduleDialog open onOpenChange={(o) => !o && setDialog(null)} page={dialog.page} onSaved={refresh} /> : null}
      {dialog?.kind === "unpublish" ? <UnpublishDialog open onOpenChange={(o) => !o && setDialog(null)} page={dialog.page} onDone={refresh} /> : null}
      {dialog?.kind === "delete" ? <DeletePageDialog open onOpenChange={(o) => !o && setDialog(null)} page={dialog.page} onDeleted={refresh} /> : null}
    </div>
  );
}
