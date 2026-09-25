"use client";

import { Dialog as RDialog } from "radix-ui";
import { Command } from "cmdk";
import {
  Building2,
  Clock,
  ExternalLink,
  Eye,
  Keyboard,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RotateCw,
  Search,
  Store as StoreIcon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { RECORD_SEARCH_PROVIDERS, STORE_COMMANDS, type RecordResult } from "@/lib/commands";
import type { VisibleNavItem } from "@/lib/nav";
import { hasAnyPermission } from "@/lib/permissions";
import type { ThemePreference } from "@/lib/theme";
import { sectionPath, useOrganizationStores } from "./use-organization-stores";
import { useThemePreference, useUiLocaleSwitch } from "./user-menu";

interface NavEntry {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: readonly string[];
}

interface RecentEntry {
  kind: "nav" | "store";
  href: string;
  label: string;
}

const RECENT_LIMIT = 5;

function recentKey(userId: string): string {
  return `altyapi-admin:palette-recent:${userId}`;
}

function readRecent(userId: string): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(recentKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((e) => e && typeof e.href === "string" && typeof e.label === "string") as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function writeRecent(userId: string, entries: RecentEntry[]): void {
  try {
    window.localStorage.setItem(recentKey(userId), JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    // Storage unavailable (private mode, blocked): recents are a convenience only.
  }
}

const itemClass =
  "flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-base text-fg outline-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-muted [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-muted";
const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: readonly VisibleNavItem[];
  onCreateStore: () => void;
  onCreateOrganization: () => void;
  onOpenShortcuts: () => void;
  onPreview: () => void;
}

/** ⌘K: go to any permitted screen, switch store, search records and run commands. */
export function CommandPalette({ open, onOpenChange, nav, onCreateStore, onCreateOrganization, onOpenShortcuts, onPreview }: CommandPaletteProps) {
  const { t, locale } = useI18n();
  const ctx = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [theme, setTheme] = useThemePreference();
  const { change: setLocale } = useUiLocaleSwitch();
  const [, startTransition] = useTransition();
  const stores = useOrganizationStores(ctx.organizations, { organizationId: ctx.organization.id, stores: ctx.stores }, open);
  const section = sectionPath(pathname, ctx.basePath);

  useEffect(() => {
    if (open) {
      setRecent(readRecent(ctx.user.id));
      setQuery("");
    }
  }, [open, ctx.user.id]);

  const navEntries = useMemo<NavEntry[]>(() => {
    const out: NavEntry[] = [];
    for (const item of nav) {
      if (item.children.length === 0) out.push({ id: item.id, label: t(item.label), href: item.href, icon: item.icon, keywords: item.keywords });
      for (const child of item.children) {
        out.push({ id: child.id, label: `${t(item.label)} › ${t(child.label)}`, href: child.href, icon: item.icon, keywords: [...item.keywords, ...child.keywords] });
      }
    }
    return out;
  }, [nav, t]);

  const commands = useMemo(() => STORE_COMMANDS.filter((c) => hasAnyPermission(ctx.permissions, c.anyOf)), [ctx.permissions]);
  const providers = useMemo(() => RECORD_SEARCH_PROVIDERS.filter((p) => hasAnyPermission(ctx.permissions, p.anyOf)), [ctx.permissions]);
  const records = useRecordSearch(query, providers, ctx, open);

  const remember = (entry: RecentEntry) => {
    const next = [entry, ...readRecent(ctx.user.id).filter((e) => e.href !== entry.href)];
    writeRecent(ctx.user.id, next);
  };

  const close = () => onOpenChange(false);
  /** Records the entry in "Recent" and opens `to` (defaults to the entry's own href). */
  const navigate = (entry: RecentEntry, to: string = entry.href) => {
    remember(entry);
    close();
    router.push(to);
  };
  const act = (fn: () => void) => {
    close();
    fn();
  };

  const themeIcons: Record<ThemePreference, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
  const themeLabels: Record<ThemePreference, string> = { system: t("shell.themeSystem"), light: t("shell.themeLight"), dark: t("shell.themeDark") };
  const otherLocale = locale === "tr" ? "en" : "tr";
  const recentVisible = query === "" ? recent.filter((r) => r.kind === "store" || navEntries.some((n) => n.href === r.href)) : [];

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
        <RDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-pop-in"
        >
          <RDialog.Title className="sr-only">{t("shell.command.title")}</RDialog.Title>
          <Command loop label={t("shell.command.title")} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={t("shell.command.placeholder")}
                className="h-12 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-base text-fg-muted">{t("shell.command.empty")}</Command.Empty>

              {recentVisible.length > 0 ? (
                <Command.Group heading={t("shell.command.recent")} className={groupClass}>
                  {recentVisible.map((r) => (
                    <Command.Item key={`recent:${r.href}`} value={`recent:${r.href}`} onSelect={() => navigate(r)} className={itemClass}>
                      <Clock aria-hidden="true" />
                      <span className="truncate">{r.kind === "nav" ? (navEntries.find((n) => n.href === r.href)?.label ?? r.label) : r.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {records.map((group) => (
                <Command.Group key={group.id} heading={group.heading} className={groupClass}>
                  {group.loading ? (
                    <Command.Loading>
                      <div className="flex items-center gap-2 px-2 py-2 text-sm text-fg-muted">
                        <Spinner />
                        {t("common.loading")}
                      </div>
                    </Command.Loading>
                  ) : (
                    group.results.map((r) => (
                      <Command.Item key={r.id} value={`record:${group.id}:${r.id}`} keywords={[query, r.label, r.description ?? ""]} onSelect={() => navigate({ kind: "nav", href: r.href, label: r.label })} className={itemClass}>
                        <group.icon aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                          <span className="truncate">{r.label}</span>
                          {r.description ? <span className="shrink-0 text-sm text-fg-subtle">{r.description}</span> : null}
                        </span>
                      </Command.Item>
                    ))
                  )}
                </Command.Group>
              ))}

              {navEntries.length > 0 ? (
                <Command.Group heading={t("shell.command.navigate")} className={groupClass}>
                  {navEntries.map((n) => (
                    <Command.Item key={n.id} value={`nav:${n.id}`} keywords={[n.label, ...n.keywords]} onSelect={() => navigate({ kind: "nav", href: n.href, label: n.label })} className={itemClass}>
                      <n.icon aria-hidden="true" />
                      <span className="truncate">{n.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group heading={t("shell.command.actions")} className={groupClass}>
                {commands.map((c) => (
                  <Command.Item key={c.id} value={`cmd:${c.id}`} keywords={[t(c.label), ...(c.keywords ?? [])]} onSelect={() => navigate({ kind: "nav", href: `${ctx.basePath}${c.path}`, label: t(c.label) })} className={itemClass}>
                    <c.icon aria-hidden="true" />
                    {t(c.label)}
                  </Command.Item>
                ))}
                <Command.Item value="action:view-store" keywords={[t("shell.viewStore"), ctx.storefrontUrl]} onSelect={() => act(() => window.open(ctx.storefrontUrl, "_blank", "noopener,noreferrer"))} className={itemClass}>
                  <ExternalLink aria-hidden="true" />
                  {t("shell.viewStore")}
                  <Hint>{new URL(ctx.storefrontUrl).host}</Hint>
                </Command.Item>
                {ctx.can("storefront:read") ? (
                  <Command.Item value="action:preview" keywords={[t("shell.preview"), "preview", "önizleme"]} onSelect={() => act(onPreview)} className={itemClass}>
                    <Eye aria-hidden="true" />
                    {t("shell.preview")}
                  </Command.Item>
                ) : null}
                {ctx.organizationPermissions.includes("store:manage") ? (
                  <Command.Item value="action:create-store" keywords={[t("shell.switcher.createStore")]} onSelect={() => act(onCreateStore)} className={itemClass}>
                    <Plus aria-hidden="true" />
                    {t("shell.switcher.createStore")}
                  </Command.Item>
                ) : null}
                <Command.Item value="action:create-organization" keywords={[t("shell.switcher.createOrganization")]} onSelect={() => act(onCreateOrganization)} className={itemClass}>
                  <Building2 aria-hidden="true" />
                  {t("shell.switcher.createOrganization")}
                </Command.Item>
                {(["system", "light", "dark"] as const)
                  .filter((p) => p !== theme)
                  .map((p) => {
                    const Icon = themeIcons[p];
                    return (
                      <Command.Item key={p} value={`action:theme-${p}`} keywords={["theme", "tema", themeLabels[p]]} onSelect={() => act(() => setTheme(p))} className={itemClass}>
                        <Icon aria-hidden="true" />
                        {t("shell.command.themeTo", { theme: themeLabels[p] })}
                      </Command.Item>
                    );
                  })}
                <Command.Item value="action:language" keywords={["language", "dil", "English", "Türkçe"]} onSelect={() => act(() => setLocale(otherLocale))} className={itemClass}>
                  <Languages aria-hidden="true" />
                  {t("shell.command.languageTo", { language: otherLocale === "en" ? "English" : "Türkçe" })}
                </Command.Item>
                <Command.Item value="action:shortcuts" keywords={[t("shell.shortcuts"), "keyboard", "klavye"]} onSelect={() => act(onOpenShortcuts)} className={itemClass}>
                  <Keyboard aria-hidden="true" />
                  {t("shell.shortcuts")}
                  <Hint>?</Hint>
                </Command.Item>
                <Command.Item value="action:logout" keywords={[t("shell.logout"), "logout", "sign out"]} onSelect={() => act(() => startTransition(() => logoutAction()))} className={itemClass}>
                  <LogOut aria-hidden="true" />
                  {t("shell.logout")}
                </Command.Item>
              </Command.Group>

              {ctx.organizations.map((org) => {
                const entry = stores.get(org.id);
                const list = entry.status === "ready" ? entry.stores.filter((s) => s.id !== ctx.store.id) : [];
                if (entry.status === "ready" && list.length === 0) return null;
                return (
                  <Command.Group key={org.id} heading={`${t("shell.command.stores")} · ${org.name}`} className={groupClass}>
                    {entry.status === "loading" ? (
                      <Command.Loading>
                        <div className="flex items-center gap-2 px-2 py-2 text-sm text-fg-muted">
                          <Spinner />
                          {t("shell.command.loadingStores")}
                        </div>
                      </Command.Loading>
                    ) : entry.status === "error" ? (
                      <Command.Item value={`retry:${org.id}`} onSelect={stores.retry} className={cn(itemClass, "text-danger")}>
                        <RotateCw aria-hidden="true" />
                        {t("shell.switcher.loadFailed")} · {t("common.retry")}
                      </Command.Item>
                    ) : (
                      list.map((s) => {
                        const href = `/o/${org.slug}/${s.slug}${org.id === ctx.organization.id ? section : ""}`;
                        return (
                          <Command.Item key={s.id} value={`store:${s.id}`} keywords={[s.name, s.slug, org.name]} onSelect={() => navigate({ kind: "store", href: `/o/${org.slug}/${s.slug}`, label: `${s.name} · ${org.name}` }, href)} className={itemClass}>
                            <StoreIcon aria-hidden="true" />
                            <span className="truncate">{t("shell.command.switchTo", { store: s.name })}</span>
                            <Hint>{s.slug}</Hint>
                          </Command.Item>
                        );
                      })
                    )}
                  </Command.Group>
                );
              })}
            </Command.List>
            <div aria-hidden="true" className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-fg-subtle">
              <span className="inline-flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                {t("shell.command.footerNavigate")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>↵</Kbd>
                {t("shell.command.footerSelect")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd>
                {t("shell.command.footerClose")}
              </span>
            </div>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="ms-auto truncate ps-2 font-mono text-xs text-fg-subtle">{children}</span>;
}

interface RecordGroup {
  id: string;
  heading: string;
  icon: LucideIcon;
  loading: boolean;
  results: RecordResult[];
}

/** Debounced (200 ms), abortable search across the registered record providers. */
function useRecordSearch(query: string, providers: typeof RECORD_SEARCH_PROVIDERS, ctx: ReturnType<typeof useStore>, open: boolean): RecordGroup[] {
  const { t } = useI18n();
  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    const q = query.trim();
    const active = open ? providers.filter((p) => q.length >= (p.minLength ?? 2)) : [];
    if (active.length === 0) {
      setGroups((current) => (current.length === 0 ? current : []));
      return;
    }
    setGroups(active.map((p) => ({ id: p.id, heading: t(p.label), icon: p.icon, loading: true, results: [] })));
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => {
      for (const p of active) {
        p.search(q, ctx, abort.signal).then(
          (results) => !abort.signal.aborted && setGroups((gs) => gs.map((g) => (g.id === p.id ? { ...g, loading: false, results: results.slice(0, 6) } : g))),
          () => !abort.signal.aborted && setGroups((gs) => gs.filter((g) => g.id !== p.id)),
        );
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [query, providers, ctx, open, t]);

  return groups.filter((g) => g.loading || g.results.length > 0);
}
