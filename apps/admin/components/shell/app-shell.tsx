"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { setSidebarCollapsedAction } from "@/app/actions/preferences";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Drawer } from "@/components/ui/drawer";
import { activeHref, NAV_BOTTOM, NAV_MAIN, resolveNav } from "@/lib/nav";
import { CommandPalette } from "./command-palette";
import { CreateOrganizationDialog, CreateStoreDialog } from "./create-dialogs";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { NavList, Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { useGlobalShortcuts } from "./use-global-shortcuts";
import { usePreviewLink } from "./use-preview-link";

export interface AppShellProps {
  initialCollapsed: boolean;
  rootDomain: string;
  children: ReactNode;
}

/**
 * Admin chrome for every store screen: top bar, sidebar (a drawer below lg), command palette,
 * keyboard shortcuts and the create-store / create-organization dialogs.
 */
export function AppShell({ initialCollapsed, rootDomain, children }: AppShellProps) {
  const { t } = useI18n();
  const ctx = useStore();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const preview = usePreviewLink();

  const modules = ctx.store.modules;
  const main = useMemo(() => resolveNav(NAV_MAIN, ctx.permissions, ctx.basePath, modules), [ctx.permissions, ctx.basePath, modules]);
  const bottom = useMemo(() => resolveNav(NAV_BOTTOM, ctx.permissions, ctx.basePath, modules), [ctx.permissions, ctx.basePath, modules]);
  const all = useMemo(() => [...main, ...bottom], [main, bottom]);
  const current = activeHref(pathname, all, ctx.basePath);
  const settingsHref = bottom.find((i) => i.id === "settings")?.children.find((c) => c.id === "settings.general")?.href ?? null;

  useEffect(() => setMobileOpen(false), [pathname]);

  useGlobalShortcuts(all, {
    togglePalette: () => setPaletteOpen((o) => !o),
    openPalette: () => setPaletteOpen(true),
    openShortcuts: () => setShortcutsOpen(true),
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    void setSidebarCollapsedAction(next);
  };

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        onOpenMobileNav={() => setMobileOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onCreateStore={() => setCreateStoreOpen(true)}
        onCreateOrganization={() => setCreateOrgOpen(true)}
        onPreview={preview.open}
        previewPending={preview.pending}
        settingsHref={settingsHref}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar main={main} bottom={bottom} activeHref={current} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-4 outline-none lg:px-6 lg:py-6">
          {children}
        </main>
      </div>

      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="start" width={280} title={t("nav.label")}>
        <nav aria-label={t("nav.label")} className="flex h-full flex-col">
          <NavList main={main} bottom={bottom} activeHref={current} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </nav>
      </Drawer>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nav={all}
        onCreateStore={() => setCreateStoreOpen(true)}
        onCreateOrganization={() => setCreateOrgOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onPreview={preview.open}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} nav={all} />
      <CreateStoreDialog open={createStoreOpen} onOpenChange={setCreateStoreOpen} rootDomain={rootDomain} />
      <CreateOrganizationDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </div>
  );
}
