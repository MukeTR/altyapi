"use client";

import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { Building2, Check, ChevronsUpDown, Plus, RotateCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { sectionPath, useOrganizationStores } from "./use-organization-stores";

const itemClass = "flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-base text-fg outline-none data-[selected=true]:bg-surface-muted";

export interface OrgStoreSwitcherProps {
  onCreateStore: () => void;
  onCreateOrganization: () => void;
}

/** Organization and store picker in the top bar. Switching keeps the current section when possible. */
export function OrgStoreSwitcher({ onCreateStore, onCreateOrganization }: OrgStoreSwitcherProps) {
  const { t } = useI18n();
  const ctx = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const stores = useOrganizationStores(ctx.organizations, { organizationId: ctx.organization.id, stores: ctx.stores }, open);
  const canCreateStore = ctx.organizationPermissions.includes("store:manage");
  const section = sectionPath(pathname, ctx.basePath);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("shell.switcher.triggerLabel", { organization: ctx.organization.name, store: ctx.store.name })}
          className="inline-flex h-8 min-w-0 max-w-[min(46vw,340px)] items-center gap-1.5 rounded-md px-2 text-base hover:bg-surface-muted"
        >
          <span className="hidden truncate text-fg-muted sm:inline">{ctx.organization.name}</span>
          <span aria-hidden="true" className="hidden text-fg-subtle sm:inline">
            /
          </span>
          <span className="truncate font-medium text-fg">{ctx.store.name}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={8} aria-label={t("shell.switcher.label")} className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-md data-[state=open]:animate-pop-in">
          <Command loop label={t("shell.switcher.label")}>
            <Command.Input placeholder={t("shell.switcher.placeholder")} className="h-10 w-full border-b border-border bg-transparent px-3 text-base text-fg outline-none placeholder:text-fg-subtle" />
            <Command.List className="max-h-80 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-sm text-fg-muted">{t("common.noResults")}</Command.Empty>
              {ctx.organizations.map((org) => {
                const entry = stores.get(org.id);
                return (
                  <Command.Group
                    key={org.id}
                    heading={
                      <span className="flex items-center gap-1.5">
                        <Building2 aria-hidden="true" className="size-3.5" />
                        {org.name}
                      </span>
                    }
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
                  >
                    {entry.status === "loading" ? (
                      <Command.Loading>
                        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-fg-muted">
                          <Spinner />
                          {t("shell.switcher.loadingStores")}
                        </div>
                      </Command.Loading>
                    ) : entry.status === "error" ? (
                      <Command.Item value={`retry-${org.id}`} onSelect={stores.retry} className={cn(itemClass, "text-danger")}>
                        <RotateCw aria-hidden="true" className="size-4" />
                        {t("shell.switcher.loadFailed")} · {t("common.retry")}
                      </Command.Item>
                    ) : entry.stores.length === 0 ? (
                      <Command.Item value={`org-${org.id}`} keywords={[org.name, org.slug]} onSelect={() => go(`/o/${org.slug}`)} className={cn(itemClass, "text-fg-muted")}>
                        {t("shell.switcher.noStores")}
                      </Command.Item>
                    ) : (
                      entry.stores.map((s) => {
                        const current = s.id === ctx.store.id;
                        return (
                          <Command.Item
                            key={s.id}
                            value={`store-${s.id}`}
                            keywords={[s.name, s.slug, org.name]}
                            onSelect={() => (current ? setOpen(false) : go(`/o/${org.slug}/${s.slug}${org.id === ctx.organization.id ? section : ""}`))}
                            className={itemClass}
                          >
                            <span className="flex size-4 shrink-0 items-center justify-center">{current ? <Check aria-hidden="true" className="size-4 text-accent" /> : null}</span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{s.name}</span>
                              <span className="truncate font-mono text-xs text-fg-subtle">{s.slug}</span>
                            </span>
                            <StatusPill domain="store" value={s.status} noDot />
                            {current ? <span className="sr-only">({t("shell.switcher.current")})</span> : null}
                          </Command.Item>
                        );
                      })
                    )}
                  </Command.Group>
                );
              })}
              <Command.Group className="-mx-1 mt-1 border-t border-border px-1 pt-1">
              {canCreateStore ? (
                <Command.Item
                  value="create-store"
                  keywords={[t("shell.switcher.createStore")]}
                  onSelect={() => {
                    setOpen(false);
                    onCreateStore();
                  }}
                  className={itemClass}
                >
                  <Plus aria-hidden="true" className="size-4 text-fg-muted" />
                  {t("shell.switcher.createStoreIn", { organization: ctx.organization.name })}
                </Command.Item>
              ) : null}
              <Command.Item
                value="create-organization"
                keywords={[t("shell.switcher.createOrganization")]}
                onSelect={() => {
                  setOpen(false);
                  onCreateOrganization();
                }}
                className={itemClass}
              >
                <Building2 aria-hidden="true" className="size-4 text-fg-muted" />
                {t("shell.switcher.createOrganization")}
              </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
