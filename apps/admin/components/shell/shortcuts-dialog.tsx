"use client";

import { Fragment } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { VisibleNavItem } from "@/lib/nav";
import { useIsMac } from "./use-platform";

export function ShortcutsDialog({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (open: boolean) => void; nav: readonly VisibleNavItem[] }) {
  const { t } = useI18n();
  const isMac = useIsMac();
  const mod = isMac ? "⌘" : "Ctrl";
  const goTo = nav.filter((i) => i.goKey);
  const rows = (items: { keys: string[][]; label: string }[]) => (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
      {items.map((row) => (
        <Fragment key={row.label}>
          <dt className="text-base text-fg">{row.label}</dt>
          <dd className="flex items-center gap-1 text-xs text-fg-subtle">
            {row.keys.map((combo, i) => (
              <Fragment key={i}>
                {i > 0 ? <span>{t("shell.shortcutsDialog.then")}</span> : null}
                {combo.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </Fragment>
            ))}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("shell.shortcutsDialog.title")} description={t("shell.shortcutsDialog.description")}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("shell.shortcutsDialog.global")}</h3>
          {rows([
            { keys: [[mod, "K"]], label: t("shell.shortcutsDialog.openPalette") },
            { keys: [["/"]], label: t("shell.shortcutsDialog.focusSearch") },
            { keys: [["?"]], label: t("shell.shortcutsDialog.showShortcuts") },
            { keys: [["Esc"]], label: t("shell.shortcutsDialog.closeLayer") },
          ])}
        </section>
        {goTo.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("shell.shortcutsDialog.goTo")}</h3>
            {rows(goTo.map((i) => ({ keys: [["G"], [i.goKey!.toUpperCase()]], label: t("shell.shortcutsDialog.goToItem", { item: t(i.label) }) })))}
          </section>
        ) : null}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("shell.shortcutsDialog.forms")}</h3>
          {rows([
            { keys: [[mod, "S"]], label: t("shell.shortcutsDialog.save") },
            { keys: [[mod, "Enter"]], label: t("shell.shortcutsDialog.submitDialog") },
          ])}
        </section>
      </div>
    </Dialog>
  );
}
