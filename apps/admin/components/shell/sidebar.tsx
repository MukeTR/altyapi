"use client";

import Link from "next/link";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { VisibleNavItem } from "@/lib/nav";

interface NavListProps {
  main: readonly VisibleNavItem[];
  bottom: readonly VisibleNavItem[];
  activeHref: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
}

const itemBase =
  "relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-base no-underline transition-colors [&>svg]:size-4 [&>svg]:shrink-0";
const itemIdle = "text-fg-muted hover:bg-surface-muted hover:text-fg";
const itemActive =
  "bg-surface font-medium text-fg shadow-xs before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-accent";

function NavLink({ item, active, collapsed, onNavigate }: { item: VisibleNavItem; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const link = (
    <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={cn(itemBase, active ? itemActive : itemIdle, collapsed && "justify-center px-0")}>
      <Icon aria-hidden="true" />
      <span className={cn("truncate", collapsed && "sr-only")}>{t(item.label)}</span>
    </Link>
  );
  return collapsed ? (
    <Tooltip content={t(item.label)} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function NavGroup({ item, activeHref, collapsed, onNavigate }: { item: VisibleNavItem; activeHref: string | null; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const listId = useId();
  const containsActive = item.children.some((c) => c.href === activeHref);
  const [open, setOpen] = useState(containsActive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  if (collapsed) return <NavLink item={item} active={containsActive} collapsed onNavigate={onNavigate} />;

  const Icon = item.icon;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cn(itemBase, itemIdle, containsActive && "text-fg")}
      >
        <Icon aria-hidden="true" />
        <span className="flex-1 truncate text-start">{t(item.label)}</span>
        <ChevronDown aria-hidden="true" className={cn("!size-3.5 text-fg-subtle transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
      </button>
      <ul id={listId} hidden={!open} className="mt-0.5 flex flex-col gap-0.5">
        {item.children.map((child) => {
          const active = child.href === activeHref;
          return (
            <li key={child.id}>
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn("relative flex h-7 items-center rounded-md ps-[34px] pe-2 text-base no-underline transition-colors", active ? itemActive : itemIdle)}
              >
                <span className="truncate">{t(child.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Navigation items; used by the desktop sidebar and the mobile drawer. */
export function NavList({ main, bottom, activeHref, collapsed, onNavigate }: NavListProps) {
  const render = (item: VisibleNavItem) =>
    item.children.length > 0 ? (
      <NavGroup item={item} activeHref={activeHref} collapsed={collapsed} onNavigate={onNavigate} />
    ) : (
      <NavLink item={item} active={item.href === activeHref} collapsed={collapsed} onNavigate={onNavigate} />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {main.map((item) => (
          <li key={item.id}>{render(item)}</li>
        ))}
      </ul>
      {bottom.length > 0 ? (
        <ul className="flex flex-col gap-0.5 border-t border-border p-2">
          {bottom.map((item) => (
            <li key={item.id}>{render(item)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface SidebarProps {
  main: readonly VisibleNavItem[];
  bottom: readonly VisibleNavItem[];
  activeHref: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** 240px sidebar (56px icon rail when collapsed); hidden below lg, where the drawer takes over. */
export function Sidebar({ main, bottom, activeHref, collapsed, onToggleCollapsed }: SidebarProps) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("nav.label")} className={cn("hidden shrink-0 flex-col border-e border-border bg-canvas lg:flex", collapsed ? "w-14" : "w-60")}>
      <NavList main={main} bottom={bottom} activeHref={activeHref} collapsed={collapsed} />
      <div className={cn("flex border-t border-border p-2", collapsed ? "justify-center" : "justify-end")}>
        <Tooltip content={collapsed ? t("nav.expand") : t("nav.collapse")} side="right">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-4 rtl:-scale-x-100" /> : <PanelLeftClose aria-hidden="true" className="size-4 rtl:-scale-x-100" />}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
