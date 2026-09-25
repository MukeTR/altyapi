"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  EyeOff,
  History,
  Layers,
  Monitor,
  MoreHorizontal,
  Redo2,
  RotateCw,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Undo2,
  Upload,
} from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuLinkItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { localeLabel } from "@/lib/locales";
import { previewUrl } from "@/lib/storefront/preview";
import type { Device, StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { pageTitleOf } from "../publish-dialogs";
import { usePreviewToken } from "./preview-pane";
import type { Draft } from "./use-draft";

export interface SaveSummary {
  page: Draft<StorefrontPage>;
  theme: Draft<StorefrontTheme>;
}

const TEMPLATE_TYPES = new Set(["product", "collection", "cart", "search", "not_found"]);

function useTimeFormat() {
  const { locale } = useI18n();
  return (ms: number) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(ms);
}

/** Save state of both drafts in one short, politely announced line. */
function SaveStatus({ save, onRetry }: { save: SaveSummary; onRetry: () => void }) {
  const { t } = useI18n();
  const time = useTimeFormat();
  const drafts = [save.page, save.theme];
  const savedAt = Math.max(...drafts.map((d) => d.savedAt ?? 0));
  let icon = <Check aria-hidden="true" className="size-3.5 text-success" />;
  let text = savedAt ? t("editor.save.savedAt", { time: time(savedAt) }) : t("editor.save.upToDate");
  let tone = "text-fg-muted";
  let retry = false;
  if (drafts.some((d) => d.status === "saving")) {
    icon = <Spinner className="size-3.5" />;
    text = t("editor.save.saving");
  } else if (drafts.some((d) => d.status === "error")) {
    icon = <CircleAlert aria-hidden="true" className="size-3.5" />;
    const issues = drafts.reduce((n, d) => n + d.issues.length, 0);
    text = issues ? t("editor.save.invalid", { count: issues }) : t("editor.save.failed");
    tone = "text-danger";
    retry = issues === 0;
  } else if (drafts.some((d) => d.status === "blocked")) {
    icon = <CircleAlert aria-hidden="true" className="size-3.5" />;
    text = t("editor.save.blocked");
    tone = "text-warning";
  } else if (drafts.some((d) => d.status === "conflict")) {
    icon = <CircleAlert aria-hidden="true" className="size-3.5" />;
    text = t("editor.save.conflict");
    tone = "text-warning";
  } else if (drafts.some((d) => d.status === "dirty")) {
    icon = <span aria-hidden="true" className="size-2 rounded-full bg-warning" />;
    text = t("editor.save.unsaved");
  }
  return (
    <div className={cn("flex min-w-0 max-w-60 items-center gap-1.5 text-sm xl:max-w-80", tone)} title={text}>
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span role="status" aria-live="polite" className="truncate">
        {text}
      </span>
      {retry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export interface EditorTopBarProps {
  page: StorefrontPage;
  pages: readonly StorefrontPage[];
  busy: boolean;
  onSwitchPage: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHistory: () => void;
  device: Device;
  onDevice: (d: Device) => void;
  editLocale: string;
  onEditLocale: (l: string) => void;
  save: SaveSummary;
  onFlush: () => void;
  previewPath: string | null;
  canPublish: boolean;
  onPublish: () => void;
  onSchedule: (() => void) | null;
  onUnpublish: (() => void) | null;
  onOpenTree: () => void;
  onOpenProps: () => void;
}

/** Editor toolbar: page switcher, undo/redo/history, device and language, save state, preview and publish. */
export function EditorTopBar(p: EditorTopBarProps) {
  const { t, locale: ui } = useI18n();
  const { basePath, store, storefrontUrl } = useStore();
  const { toast, toastError } = useToast();
  const getToken = usePreviewToken();
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const title = pageTitleOf(p.page, ui, store.defaultLocale);
  const contentPages = p.pages.filter((x) => !TEMPLATE_TYPES.has(x.type));
  const templates = p.pages.filter((x) => TEMPLATE_TYPES.has(x.type));

  const openPreview = () => {
    if (!p.previewPath) return;
    const tab = window.open("about:blank", "_blank");
    getToken().then(
      (token) => {
        if (tab) {
          tab.opener = null;
          tab.location.href = previewUrl(storefrontUrl, p.previewPath!, token);
        }
      },
      (err) => {
        tab?.close();
        if (err instanceof ApiError) toastError(err.toInfo(), t("editor.preview.tokenFailed"));
      },
    );
  };

  const copyLink = async () => {
    if (!p.previewPath) return;
    try {
      const url = previewUrl(storefrontUrl, p.previewPath, await getToken());
      await navigator.clipboard.writeText(url);
      toast({ tone: "success", title: t("editor.preview.linkCopied"), description: t("editor.preview.linkWarning") });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo(), t("editor.preview.tokenFailed"));
      else toast({ tone: "error", title: t("editor.preview.copyFailed") });
    }
  };

  const pageItem = (x: StorefrontPage) => (
    <DropdownMenuItem key={x.id} onSelect={() => p.onSwitchPage(x.id)} className="h-auto py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 truncate">
          {x.id === p.page.id ? <Check aria-hidden="true" className="!text-accent" /> : null}
          {pageTitleOf(x, ui, store.defaultLocale)}
        </span>
        <span className="text-xs text-fg-subtle">
          {t.maybe(`editor.pageTypes.${x.type}`) ?? x.type}
          {x.draftPath ? ` · ${x.draftPath}` : ""}
          {x.hasUnpublishedChanges ? ` · ${t("storefront.pages.unpublishedChanges")}` : ""}
        </span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1.5 lg:px-3">
      <Tooltip content={t("editor.backToPages")}>
        <ButtonLink href={`${basePath}/storefront`} variant="ghost" size="icon-md" aria-label={t("editor.backToPages")}>
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
        </ButtonLink>
      </Tooltip>
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="sr-only">{t("editor.title")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-w-0 max-w-64 justify-start" disabled={p.busy} aria-label={t("editor.pageSwitcher", { page: title })}>
              <span className="truncate font-semibold">{title}</span>
              <ChevronDown aria-hidden="true" className="text-fg-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] w-80 overflow-y-auto">
            <DropdownMenuLabel>{t("editor.pageGroups.pages")}</DropdownMenuLabel>
            {contentPages.map(pageItem)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("editor.pageGroups.templates")}</DropdownMenuLabel>
            {templates.map(pageItem)}
            <DropdownMenuSeparator />
            <DropdownMenuLinkItem href={`${basePath}/storefront`}>{t("editor.allPages")}</DropdownMenuLinkItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <StatusPill domain="page" value={p.page.status} className="max-sm:hidden" />
        {p.page.hasUnpublishedChanges ? (
          <Badge tone="warning" className="max-xl:hidden">
            {t("storefront.pages.unpublishedChanges")}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-0.5 border-s border-border ps-2">
        <Tooltip content={`${t("editor.undo")} (${mod}Z)`}>
          <span className="inline-flex">
            <Button variant="ghost" size="icon-md" aria-label={t("editor.undo")} aria-keyshortcuts="Control+Z Meta+Z" onClick={p.onUndo} disabled={!p.canUndo}>
              <Undo2 aria-hidden="true" />
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={`${t("editor.redo")} (${mod}⇧Z)`}>
          <span className="inline-flex">
            <Button variant="ghost" size="icon-md" aria-label={t("editor.redo")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" onClick={p.onRedo} disabled={!p.canRedo}>
              <Redo2 aria-hidden="true" />
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={t("editor.historyButton")}>
          <Button variant="ghost" size="icon-md" aria-label={t("editor.historyButton")} onClick={p.onHistory}>
            <History aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>

      <div className="hidden items-center gap-2 border-s border-border ps-2 md:flex">
        <SegmentedControl
          size="sm"
          aria-label={t("editor.devices.label")}
          value={p.device}
          onValueChange={(v) => p.onDevice(v as Device)}
          options={[
            { value: "desktop", label: <Monitor aria-hidden="true" />, "aria-label": t("editor.devices.desktop") },
            { value: "tablet", label: <Tablet aria-hidden="true" />, "aria-label": t("editor.devices.tablet") },
            { value: "mobile", label: <Smartphone aria-hidden="true" />, "aria-label": t("editor.devices.mobile") },
          ]}
        />
        {store.supportedLocales.length > 1 ? (
          <Select
            size="sm"
            aria-label={t("editor.editLocale")}
            value={p.editLocale}
            onValueChange={p.onEditLocale}
            className="w-36"
            options={store.supportedLocales.map((l) => ({ value: l, label: `${localeLabel(l, ui)}${l === store.defaultLocale ? ` (${t("common.default")})` : ""}` }))}
          />
        ) : null}
      </div>

      <div className="ms-auto flex min-w-0 items-center gap-2">
        <div className="hidden min-w-0 lg:block">
          <SaveStatus save={p.save} onRetry={p.onFlush} />
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <Button size="sm" onClick={p.onOpenTree}>
            <Layers aria-hidden="true" />
            {t("editor.tree.short")}
          </Button>
          <Button size="sm" onClick={p.onOpenProps}>
            <SlidersHorizontal aria-hidden="true" />
            {t("editor.props.short")}
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="md" disabled={!p.previewPath} aria-label={t("editor.preview.menu")}>
              <ExternalLink aria-hidden="true" />
              <span className="hidden sm:inline">{t("editor.preview.menu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            <DropdownMenuItem onSelect={openPreview}>
              <ExternalLink aria-hidden="true" />
              {t("editor.preview.openNewTab")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <Copy aria-hidden="true" />
              {t("editor.preview.copyLink")}
            </DropdownMenuItem>
            <DropdownMenuLabel className="font-normal">{t("editor.preview.linkWarning")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">{t("editor.preview.cookieHint")}</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        {p.onSchedule || p.onUnpublish ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-md" aria-label={t("editor.moreActions")}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {p.onSchedule ? (
                <DropdownMenuItem onSelect={p.onSchedule}>
                  <CalendarClock aria-hidden="true" />
                  {t("storefront.pages.schedule")}
                </DropdownMenuItem>
              ) : null}
              {p.onUnpublish ? (
                <DropdownMenuItem onSelect={p.onUnpublish} tone="danger">
                  <EyeOff aria-hidden="true" />
                  {t("storefront.pages.unpublish")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuLinkItem href={`${basePath}/storefront/publications`}>{t("storefront.publications.title")}</DropdownMenuLinkItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {p.canPublish ? (
          <Button variant="primary" onClick={p.onPublish} disabled={p.busy}>
            <Upload aria-hidden="true" />
            {t("editor.publish")}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
