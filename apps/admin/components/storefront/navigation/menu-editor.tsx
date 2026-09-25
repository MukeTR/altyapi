"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CircleAlert, GripVertical, History, IndentDecrease, IndentIncrease, ListTree, MoreHorizontal, Plus, Save, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorSummary } from "@/components/ui/form-section";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import {
  canIndent,
  canOutdent,
  countItems,
  depthOf,
  findItem,
  indent,
  invalidItems,
  MAX_CHILDREN,
  MAX_NAV_DEPTH,
  MAX_TOP_ITEMS,
  moveWithinLevel,
  outdent,
  removeItem,
  reorderLevel,
  setChildren,
  updateItem,
} from "@/lib/storefront/navigation";
import { newId } from "@/lib/storefront/sections";
import type { CollectionSummary, NavItem, NavigationMenu, StorefrontPage } from "@/lib/storefront/types";
import { SortableList } from "../editor/section-tree";
import { HistoryDrawer } from "../history-drawer";
import { PublishDialog } from "../publish-dialogs";
import { NavLinkField, useLinkSummary } from "./nav-link-field";

/** Entry ids linked anywhere in the menu (their titles are shown in the tree). */
function collectEntryIds(items: readonly NavItem[]): string[] {
  return items.flatMap((i) => [...(i.link.type === "entry" && i.link.entryId ? [i.link.entryId] : []), ...collectEntryIds(i.children ?? [])]);
}

interface TreeProps {
  items: NavItem[];
  parent: string | null;
  all: NavItem[];
  selected: string | null;
  invalid: ReadonlySet<string>;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onChange: (items: NavItem[]) => void;
  onAddChild: (parent: string) => void;
  labelOf: (item: NavItem) => string;
  summaryOf: (item: NavItem) => string;
}

function ItemRow({ item, index, count, ...p }: TreeProps & { item: NavItem; index: number; count: number }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !p.canEdit });
  const label = p.labelOf(item);
  const depth = depthOf(p.all, item.id);
  const isSelected = p.selected === item.id;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-80")}>
      <div className={cn("group/row flex min-h-10 items-center gap-1 rounded-md pe-1", isSelected ? "bg-accent-subtle" : "hover:bg-surface-muted")}>
        {p.canEdit ? (
          <button type="button" {...attributes} {...listeners} aria-label={t("editor.tree.dragHandle", { name: label })} className="inline-flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-fg-subtle hover:text-fg">
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <button type="button" aria-current={isSelected || undefined} onClick={() => p.onSelect(item.id)} className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-start">
          <span className={cn("flex items-center gap-1.5 truncate font-medium", isSelected ? "text-accent-subtle-fg" : "text-fg")}>
            {label}
            {p.invalid.has(item.id) ? (
              <span className="inline-flex text-danger">
                <CircleAlert aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("storefront.menus.itemInvalid")}</span>
              </span>
            ) : null}
          </span>
          <span className="w-full truncate text-xs text-fg-muted">{p.summaryOf(item)}</span>
        </button>
        {p.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t("common.rowActions", { name: label })} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg">
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled={index === 0} onSelect={() => p.onChange(moveWithinLevel(p.all, item.id, -1))}>
                <ArrowUp aria-hidden="true" />
                {t("editor.tree.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => p.onChange(moveWithinLevel(p.all, item.id, 1))}>
                <ArrowDown aria-hidden="true" />
                {t("editor.tree.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canIndent(p.all, item.id)} onSelect={() => p.onChange(indent(p.all, item.id))}>
                <IndentIncrease aria-hidden="true" className="rtl:-scale-x-100" />
                {t("storefront.menus.indent")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canOutdent(p.all, item.id)} onSelect={() => p.onChange(outdent(p.all, item.id))}>
                <IndentDecrease aria-hidden="true" className="rtl:-scale-x-100" />
                {t("storefront.menus.outdent")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={depth >= MAX_NAV_DEPTH || (item.children?.length ?? 0) >= MAX_CHILDREN} onSelect={() => p.onAddChild(item.id)}>
                <Plus aria-hidden="true" />
                {t("storefront.menus.addChild")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => p.onChange(removeItem(p.all, item.id))}>
                <Trash2 aria-hidden="true" />
                {item.children?.length ? t("storefront.menus.deleteWithChildren", { count: countItems(item.children) }) : t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {item.children?.length ? (
        <div className="ms-5 border-s border-border ps-2">
          <Level {...p} items={item.children} parent={item.id} />
        </div>
      ) : null}
    </li>
  );
}

function Level(p: TreeProps) {
  const ids = p.items.map((i) => i.id);
  const names = new Map(p.items.map((i) => [i.id, p.labelOf(i)]));
  return (
    <SortableList ids={ids} names={names} disabled={!p.canEdit} onReorder={(next) => p.onChange(reorderLevel(p.all, p.parent, next))}>
      <ul className="flex flex-col gap-0.5">
        {p.items.map((item, i) => (
          <ItemRow key={item.id} {...p} item={item} index={i} count={p.items.length} />
        ))}
      </ul>
    </SortableList>
  );
}

/**
 * Editor of one navigation menu: a tree up to three levels, reordered by dragging (pointer or
 * keyboard) or from each item's menu, with the selected item's label and link on the side.
 * Menus are drafts; they go live the next time the theme is published.
 */
export function MenuEditor({ menu, pages, usage }: { menu: NavigationMenu; pages: StorefrontPage[]; usage: string[] }) {
  const { t, describeError } = useI18n();
  const { apiBase, basePath, can, store } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const canEdit = can("storefront:write");
  const [saved, setSaved] = useState(menu);
  const [name, setName] = useState(menu.name);
  const [items, setItems] = useState<NavItem[]>(menu.items);
  const [selected, setSelected] = useState<string | null>(menu.items[0]?.id ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);

  useEffect(() => {
    // Collections exist only with the catalog module (and catalog:read).
    if (!can("catalog:read") || (store.modules && !store.modules.includes("catalog"))) return;
    bff<{ items: CollectionSummary[] }>(`${apiBase}/collections`).then(
      (r) => setCollections(r.items),
      (err) => setCollectionsError(err instanceof ApiError ? describeError(err.toInfo()).message : t("states.networkBody")),
    );
  }, [apiBase, can, describeError, t, store.modules]);

  const dirty = name !== saved.name || JSON.stringify(items) !== JSON.stringify(saved.items);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const invalid = useMemo(() => new Set(invalidItems(items, store.defaultLocale)), [items, store.defaultLocale]);
  const entryIds = useMemo(() => collectEntryIds(items), [items]);
  const summaryOf = useLinkSummary(pages, collections, entryIds);
  const labelOf = (item: NavItem) => item.label[store.defaultLocale] || Object.values(item.label).find(Boolean) || t("storefront.menus.untitled");
  const current = selected ? findItem(items, selected) : undefined;

  const addItem = (parent: string | null) => {
    const item: NavItem = { id: newId(), label: {}, link: { type: "page", pageId: "" } };
    if (parent === null) setItems((list) => [...list, item]);
    else setItems((list) => setChildren(list, parent, [...(findItem(list, parent)?.children ?? []), item]));
    setSelected(item.id);
  };

  const save = async () => {
    setShowErrors(true);
    if (!name.trim() || invalid.size > 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await bff<NavigationMenu>(`${apiBase}/storefront/navigations/${menu.handle}`, { method: "PUT", body: { name: name.trim(), items } });
      setSaved(res);
      setName(res.name);
      setItems(res.items);
      setShowErrors(false);
      toast({ tone: "success", title: t("storefront.menus.saved"), description: t("storefront.menus.savedHint") });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  const errorItems = showErrors ? [...invalid].map((id) => ({ fieldId: `nav-item-${id}`, label: labelOf(findItem(items, id)!), message: t("storefront.menus.itemInvalid") })) : [];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={saved.name}
        breadcrumbs={[{ label: t("storefront.menus.title"), href: `${basePath}/storefront/navigation` }]}
        meta={<span className="font-mono">{menu.handle}</span>}
        status={dirty ? <Badge tone="warning">{t("storefront.menus.unsaved")}</Badge> : null}
        actions={
          <>
            <Button onClick={() => setHistoryOpen(true)}>
              <History aria-hidden="true" />
              {t("editor.historyButton")}
            </Button>
            {can("storefront:publish") ? (
              <Button onClick={() => setPublishOpen(true)} disabled={dirty}>
                <Upload aria-hidden="true" />
                {t("storefront.menus.publishTheme")}
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="primary" onClick={() => void save()} loading={pending} disabled={!dirty}>
                <Save aria-hidden="true" />
                {t("common.save")}
              </Button>
            ) : null}
          </>
        }
      />
      {!canEdit ? <InlineAlert tone="info">{t("storefront.menus.readOnly")}</InlineAlert> : null}
      {error ? (
        <InlineAlert tone="danger" live="alert" title={describeError(error).message}>
          {describeError(error).correlationId ? (
            <span className="text-sm text-fg-muted">
              {t("common.supportCode")}: <code className="font-mono">{describeError(error).correlationId}</code>
            </span>
          ) : null}
        </InlineAlert>
      ) : null}
      {errorItems.length ? <ErrorSummary items={errorItems} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Card title={t("storefront.menus.settings")} padding="form">
            <div className="flex flex-col gap-4">
              <Field label={t("storefront.menus.name")} required error={showErrors && !name.trim() ? t("ui.field.requiredValue") : null}>
                <Input value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
              </Field>
              <p className="text-sm text-fg-muted">{usage.length ? t("storefront.menus.usedIn", { places: usage.join(", ") }) : t("storefront.menus.notUsed")}</p>
            </div>
          </Card>
          <Card
            title={t("storefront.menus.items")}
            description={t("storefront.menus.itemsHint", { max: MAX_NAV_DEPTH })}
            actions={
              canEdit ? (
                <Button size="sm" onClick={() => addItem(null)} disabled={items.length >= MAX_TOP_ITEMS}>
                  <Plus aria-hidden="true" />
                  {t("storefront.menus.addItem")}
                </Button>
              ) : null
            }
          >
            {items.length === 0 ? (
              <EmptyState icon={ListTree} title={t("storefront.menus.emptyTitle")} description={t("storefront.menus.emptyBody")} className="py-6" />
            ) : (
              <Level items={items} parent={null} all={items} selected={selected} invalid={showErrors ? invalid : new Set()} canEdit={canEdit} onSelect={setSelected} onChange={setItems} onAddChild={addItem} labelOf={labelOf} summaryOf={(i) => summaryOf(i.link)} />
            )}
          </Card>
        </div>
        <div className="lg:sticky lg:top-0 lg:self-start">
          <Card title={current ? t("storefront.menus.itemSettings") : t("storefront.menus.noItemSelected")} padding="form">
            {current ? (
              <div id={`nav-item-${current.id}`} tabIndex={-1} className="flex flex-col gap-4 outline-none">
                <LocalizedTextField
                  label={t("storefront.menus.label")}
                  locales={store.supportedLocales}
                  defaultLocale={store.defaultLocale}
                  value={current.label}
                  maxLength={80}
                  required
                  disabled={!canEdit}
                  errors={showErrors && !(current.label[store.defaultLocale] ?? "").trim() ? { [store.defaultLocale]: t("ui.field.requiredValue") } : {}}
                  onChange={(label) => setItems((list) => updateItem(list, current.id, (i) => ({ ...i, label })))}
                />
                <fieldset disabled={!canEdit} className="flex flex-col gap-3">
                  <NavLinkField value={current.link} pages={pages} collections={collections} collectionsError={collectionsError} showErrors={showErrors} onChange={(link) => setItems((list) => updateItem(list, current.id, (i) => ({ ...i, link })))} />
                </fieldset>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button size="sm" onClick={() => addItem(current.id)} disabled={depthOf(items, current.id) >= MAX_NAV_DEPTH || (current.children?.length ?? 0) >= MAX_CHILDREN}>
                      <Plus aria-hidden="true" />
                      {t("storefront.menus.addChild")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setItems((list) => removeItem(list, current.id));
                        setSelected(null);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("common.delete")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-base text-fg-muted">{t("storefront.menus.selectHint")}</p>
            )}
          </Card>
        </div>
      </div>
      {historyOpen ? (
        <HistoryDrawer
          open
          onOpenChange={setHistoryOpen}
          resource="navigation"
          resourceId={menu.id}
          title={saved.name}
          canRestore={canEdit}
          beforeRestore={async () => {
            if (!dirty) return true;
            toast({ tone: "error", title: t("storefront.menus.saveFirst") });
            return false;
          }}
          onRestored={async () => {
            const res = await bff<{ items: NavigationMenu[] }>(`${apiBase}/storefront/navigations`);
            const fresh = res.items.find((m) => m.handle === menu.handle);
            if (fresh) {
              setSaved(fresh);
              setName(fresh.name);
              setItems(fresh.items);
            }
            router.refresh();
          }}
        />
      ) : null}
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} pages={pages} themeHasChanges onPublished={() => router.refresh()} />
    </div>
  );
}
