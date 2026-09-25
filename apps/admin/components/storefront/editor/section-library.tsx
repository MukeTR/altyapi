"use client";

import { Ban, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { latestDefinitions, MAX_SECTIONS, unavailableReason, type Unavailable } from "@/lib/storefront/sections";
import type { Placement, SectionDefinition, SectionInstance } from "@/lib/storefront/types";
import { useSectionName } from "./section-tree";

/** Category order of the library; categories the API adds later are listed after these. */
const CATEGORY_ORDER = ["hero", "content", "media", "commerce", "social_proof", "marketing", "business", "layout", "template"];

export interface LibraryTarget {
  placement: Placement;
  /** Sections already in the tree the new one joins (singletons and the section limit). */
  sections: readonly SectionInstance[];
  /** Restricts the offered types (global header vs. footer area). */
  accept?: (def: SectionDefinition) => boolean;
  title: string;
}

/**
 * Section library: every section type of the platform grouped by category. Types that cannot be
 * added here stay visible but disabled, with the reason in plain language next to them.
 */
export function SectionLibrary({
  open,
  onOpenChange,
  target,
  definitions,
  storeModules,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LibraryTarget | null;
  definitions: readonly SectionDefinition[];
  storeModules: readonly string[] | null;
  onAdd: (def: SectionDefinition) => void;
}) {
  const { t, locale } = useI18n();
  const nameOf = useSectionName();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    if (!target) return [];
    const q = query.trim().toLocaleLowerCase(locale);
    const items = latestDefinitions(definitions)
      .filter((d) => !target.accept || target.accept(d))
      .map((def) => ({ def, name: nameOf(def, def.type), reason: unavailableReason(def, target.placement, target.sections, storeModules) }))
      .filter((i) => i.reason?.reason !== "template")
      .filter((i) => !q || `${i.name} ${i.def.type} ${t.maybe(`sections.categories.${i.def.category}`) ?? ""}`.toLocaleLowerCase(locale).includes(q));
    const byCategory = new Map<string, typeof items>();
    for (const item of items) byCategory.set(item.def.category, [...(byCategory.get(item.def.category) ?? []), item]);
    return [...byCategory.entries()].sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [definitions, target, storeModules, query, locale, nameOf, t]);

  const reasonText = (r: Unavailable) => {
    switch (r.reason) {
      case "placement":
        return t("editor.library.onlyOn", { pages: r.allowed.map((p) => t.maybe(`editor.placements.${p}`) ?? p).join(", ") });
      case "singleton":
        return t("editor.library.singleton");
      case "module":
        return t("editor.library.module", { module: t.maybe(`editor.modules.${r.module}`) ?? r.module });
      case "limit":
        return t("editor.library.limit", { max: MAX_SECTIONS });
      default:
        return "";
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
      size="lg"
      title={t("editor.library.title")}
      description={target?.title}
    >
      <div className="flex flex-col gap-4">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.library.search")} aria-label={t("editor.library.search")} autoFocus />
        {groups.length === 0 ? <p className="py-6 text-center text-base text-fg-muted">{t("editor.library.empty")}</p> : null}
        {groups.map(([category, items]) => (
          <section key={category} aria-labelledby={`lib-${category}`} className="flex flex-col gap-2">
            <h3 id={`lib-${category}`} className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {t.maybe(`sections.categories.${category}`) ?? category}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map(({ def, name, reason }) => {
                const description = t.maybe(`sections.descriptions.${def.type}`);
                return (
                  <li key={def.type}>
                    <div className={`flex h-full items-start gap-3 rounded-lg border p-3 ${reason ? "border-border bg-surface-muted" : "border-border bg-surface"}`}>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-base font-medium text-fg">{name}</span>
                        {description ? <span className="text-sm text-fg-muted">{description}</span> : null}
                        {reason ? (
                          <span className="flex items-start gap-1.5 text-sm text-fg-muted" id={`lib-reason-${def.type}`}>
                            <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {reasonText(reason)}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant={reason ? "secondary" : "primary"}
                        disabled={Boolean(reason)}
                        aria-label={t("editor.library.addNamed", { name })}
                        {...(reason ? { "aria-describedby": `lib-reason-${def.type}` } : {})}
                        onClick={() => onAdd(def)}
                      >
                        <Plus aria-hidden="true" />
                        {t("editor.library.add")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
