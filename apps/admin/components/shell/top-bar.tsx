"use client";

import Link from "next/link";
import { ExternalLink, Eye, Menu, Search } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Logo } from "@/components/logo";
import { buttonClasses } from "@/components/ui/button-styles";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { OrgStoreSwitcher } from "./org-store-switcher";
import { useIsMac } from "./use-platform";
import { UserMenu } from "./user-menu";

export interface TopBarProps {
  onOpenMobileNav: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  onCreateStore: () => void;
  onCreateOrganization: () => void;
  onPreview: () => void;
  previewPending: boolean;
  /** Href of Settings › General when that screen exists (the status pill links there). */
  settingsHref: string | null;
}

export function TopBar({ onOpenMobileNav, onOpenPalette, onOpenShortcuts, onCreateStore, onCreateOrganization, onPreview, previewPending, settingsHref }: TopBarProps) {
  const { t } = useI18n();
  const ctx = useStore();
  const isMac = useIsMac();
  const statusLabel = t.maybe(`statuses.store.${ctx.store.status}`) ?? ctx.store.status;
  const status = <StatusPill domain="store" value={ctx.store.status} />;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 sm:gap-2 sm:px-3">
      <Button variant="ghost" size="icon-md" className="lg:hidden" aria-label={t("nav.openMenu")} onClick={onOpenMobileNav}>
        <Menu aria-hidden="true" />
      </Button>
      <Link href={ctx.basePath} className="hidden shrink-0 rounded-md sm:inline-flex" aria-label={`altyapi · ${t("nav.overview")}`}>
        <Logo withText={false} />
      </Link>
      <OrgStoreSwitcher onCreateStore={onCreateStore} onCreateOrganization={onCreateOrganization} />

      <div className="flex flex-1 justify-end md:justify-center md:px-2">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          aria-label={t("shell.searchTrigger")}
          className="inline-flex h-8 items-center gap-2 rounded-md text-fg-subtle transition-colors hover:text-fg max-md:w-8 max-md:justify-center md:w-full md:max-w-[420px] md:border md:border-border-control md:bg-canvas md:px-2.5 md:text-base md:hover:bg-surface-muted"
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="hidden flex-1 truncate text-start md:inline">{t("shell.searchTrigger")}</span>
          <span aria-hidden="true" className="hidden items-center gap-0.5 md:inline-flex">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <span className="hidden lg:inline-flex" title={t("shell.storeStatus", { status: statusLabel })}>
          {settingsHref ? (
            <Link href={settingsHref} aria-label={t("shell.storeStatus", { status: statusLabel })} className="rounded-full no-underline">
              {status}
            </Link>
          ) : (
            <span aria-label={t("shell.storeStatus", { status: statusLabel })}>{status}</span>
          )}
        </span>
        <Tooltip content={new URL(ctx.storefrontUrl).host}>
          <a href={ctx.storefrontUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("ghost", "sm", "max-sm:w-8 max-sm:px-0")}>
            <ExternalLink aria-hidden="true" />
            <span className="max-sm:sr-only">{t("shell.viewStore")}</span>
            <span className="sr-only"> ({t("common.openInNewTab")})</span>
          </a>
        </Tooltip>
        {ctx.can("storefront:read") ? (
          <Button variant="ghost" size="sm" onClick={onPreview} loading={previewPending} className="max-md:hidden">
            <Eye aria-hidden="true" />
            {t("shell.preview")}
            <span className="sr-only"> ({t("common.openInNewTab")})</span>
          </Button>
        ) : null}
        <UserMenu onOpenShortcuts={onOpenShortcuts} />
      </div>
    </header>
  );
}
