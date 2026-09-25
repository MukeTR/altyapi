"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, CircleAlert, Copy, EyeOff, Eye, FileCog, GripVertical, Lock, MoreHorizontal, Palette, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { blockHasIssue, sectionHasIssue, type Issue } from "@/lib/storefront/issues";
import { canAddBlock, definitionOf, instanceSummary, isRequiredOn } from "@/lib/storefront/sections";
import type { BlockInstance, Placement, SectionDefinition, SectionInstance } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";

export type Scope = "page" | "global";
export type GroupKey = "top" | "page" | "bottom";

export type Selection =
  | { kind: "page-settings" }
  | { kind: "theme-settings" }
  | { kind: "section"; scope: Scope; sectionId: string }
  | { kind: "block"; scope: Scope; sectionId: string; blockId: string };

export interface TreeGroup {
  key: GroupKey;
  scope: Scope;
  title: string;
  placement: Placement;
  sections: SectionInstance[];
  canEdit: boolean;
  issues: readonly Issue[];
  /** Why no section can be added here (read-only), or null. */
  addDisabledReason: string | null;
  emptyText: string;
}

export interface TreeActions {
  select: (s: Selection) => void;
  reorder: (group: GroupKey, orderedIds: string[]) => void;
  move: (group: GroupKey, id: string, delta: -1 | 1) => void;
  toggleHidden: (scope: Scope, id: string) => void;
  duplicate: (scope: Scope, id: string) => void;
  remove: (scope: Scope, id: string) => void;
  openLibrary: (group: GroupKey) => void;
  addBlock: (scope: Scope, sectionId: string, blockType: string) => void;
  reorderBlocks: (scope: Scope, sectionId: string, orderedIds: string[]) => void;
  moveBlock: (scope: Scope, sectionId: string, blockId: string, delta: -1 | 1) => void;
  duplicateBlock: (scope: Scope, sectionId: string, blockId: string) => void;
  removeBlock: (scope: Scope, sectionId: string, blockId: string) => void;
  toggleExpanded: (sectionId: string) => void;
}

export function useSectionName() {
  const { locale, t } = useI18n();
  return (def: SectionDefinition | undefined, type: string) => (def ? (def.name[locale] ?? def.name.tr ?? type) : t("editor.tree.unknownSection", { type }));
}

export function useBlockName() {
  const { t } = useI18n();
  return (type: string) => t.maybe(`sections.blocks.${type}`) ?? type;
}

const rowBase = "group/row relative flex min-h-9 items-center gap-1 rounded-md pe-1 text-base";

function TreeButton({ selected, onClick, icon, children }: { selected: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-2 text-start text-base font-medium text-fg hover:bg-surface-muted [&_svg]:size-4 [&_svg]:text-fg-muted",
        selected && "bg-accent-subtle text-accent-subtle-fg [&_svg]:text-accent-subtle-fg",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Left panel of the editor: page settings, the sections of this page between the global header
 * and footer groups, and theme settings. Sections and blocks are reordered by dragging (pointer
 * or keyboard: focus the handle, Space, arrows, Space) or with "Move up/down" in their menu.
 */
export function SectionTree({
  groups,
  definitions,
  selection,
  expanded,
  actions,
  pageLabel,
}: {
  groups: TreeGroup[];
  definitions: readonly SectionDefinition[];
  selection: Selection | null;
  expanded: ReadonlySet<string>;
  actions: TreeActions;
  pageLabel: string;
}) {
  const { t } = useI18n();
  const topGroups = groups.filter((g) => g.key === "top");
  const pageGroup = groups.find((g) => g.key === "page");
  const bottomGroups = groups.filter((g) => g.key === "bottom");
  return (
    <nav aria-label={t("editor.tree.label")} className="flex flex-col gap-4 p-3">
      <TreeButton selected={selection?.kind === "page-settings"} onClick={() => actions.select({ kind: "page-settings" })} icon={<FileCog aria-hidden="true" />}>
        {t("editor.tree.pageSettings")}
      </TreeButton>
      {topGroups.map((g) => (
        <SectionGroup key={g.key} group={g} definitions={definitions} selection={selection} expanded={expanded} actions={actions} />
      ))}
      {pageGroup ? <SectionGroup group={{ ...pageGroup, title: `${pageGroup.title} · ${pageLabel}` }} definitions={definitions} selection={selection} expanded={expanded} actions={actions} /> : null}
      {bottomGroups.map((g) => (
        <SectionGroup key={g.key} group={g} definitions={definitions} selection={selection} expanded={expanded} actions={actions} />
      ))}
      <TreeButton selected={selection?.kind === "theme-settings"} onClick={() => actions.select({ kind: "theme-settings" })} icon={<Palette aria-hidden="true" />}>
        {t("editor.tree.themeSettings")}
      </TreeButton>
    </nav>
  );
}

function useAnnouncements(names: Map<string, string>, ids: string[]): Announcements {
  const { t } = useI18n();
  const pos = (id: string | number) => ids.indexOf(String(id)) + 1;
  return {
    onDragStart: ({ active }) => t("editor.dnd.pickedUp", { name: names.get(String(active.id)) ?? "", position: pos(active.id), total: ids.length }),
    onDragOver: ({ active, over }) => (over ? t("editor.dnd.movedOver", { name: names.get(String(active.id)) ?? "", position: pos(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("editor.dnd.dropped", { name: names.get(String(active.id)) ?? "", position: pos(over.id) }) : undefined),
    onDragCancel: ({ active }) => t("editor.dnd.cancelled", { name: names.get(String(active.id)) ?? "" }),
  };
}

export function SortableList({ ids, names, onReorder, children, disabled }: { ids: string[]; names: Map<string, string>; onReorder: (ids: string[]) => void; children: ReactNode; disabled: boolean }) {
  const { t } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const announcements = useAnnouncements(names, ids);
  // A stable id keeps dnd-kit's accessibility ids equal between server render and hydration.
  const dndId = useId();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    onReorder(next);
  };
  if (disabled) return <>{children}</>;
  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: t("editor.dnd.instructions") } }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

function SectionGroup({ group, definitions, selection, expanded, actions }: { group: TreeGroup; definitions: readonly SectionDefinition[]; selection: Selection | null; expanded: ReadonlySet<string>; actions: TreeActions }) {
  const { t } = useI18n();
  const nameOf = useSectionName();
  const names = new Map(group.sections.map((s) => [s.id, nameOf(definitionOf(definitions, s.type, s.version), s.type)]));
  const ids = group.sections.map((s) => s.id);
  const headingId = `tree-${group.key}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-0.5">
      <h2 id={headingId} className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {group.title}
      </h2>
      {group.sections.length === 0 ? <p className="px-2 py-1.5 text-sm text-fg-muted">{group.emptyText}</p> : null}
      <SortableList ids={ids} names={names} onReorder={(next) => actions.reorder(group.key, next)} disabled={!group.canEdit}>
        <ul className="flex flex-col gap-0.5">
          {group.sections.map((s, i) => (
            <SectionRow
              key={s.id}
              section={s}
              index={i}
              count={group.sections.length}
              group={group}
              def={definitionOf(definitions, s.type, s.version)}
              name={names.get(s.id) ?? s.type}
              selection={selection}
              expanded={expanded.has(s.id)}
              actions={actions}
            />
          ))}
        </ul>
      </SortableList>
      {group.canEdit ? (
        <Button size="sm" variant="ghost" className="mt-0.5 justify-start self-stretch text-link" onClick={() => actions.openLibrary(group.key)} disabled={Boolean(group.addDisabledReason)}>
          <Plus aria-hidden="true" />
          {t("editor.tree.addSection")}
        </Button>
      ) : null}
      {group.addDisabledReason ? <p className="px-2 text-xs text-fg-subtle">{group.addDisabledReason}</p> : null}
    </section>
  );
}

function SectionRow({
  section,
  index,
  count,
  group,
  def,
  name,
  selection,
  expanded,
  actions,
}: {
  section: SectionInstance;
  index: number;
  count: number;
  group: TreeGroup;
  def: SectionDefinition | undefined;
  name: string;
  selection: Selection | null;
  expanded: boolean;
  actions: TreeActions;
}) {
  const { t } = useI18n();
  const { editLocale, defaultLocale } = useEditorContext();
  const blockName = useBlockName();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: !group.canEdit });
  const required = isRequiredOn(def, group.placement);
  const selected = selection?.kind === "section" && selection.sectionId === section.id;
  const hasBlocks = Boolean(def && Object.keys(def.blocks).length > 0);
  const summary = instanceSummary(section.props, editLocale, defaultLocale);
  const hasIssue = sectionHasIssue(group.issues, section.id);
  const blockTypes = def ? Object.keys(def.blocks) : [];
  const blockIds = (section.blocks ?? []).map((b) => b.id);
  const blockNames = new Map(
    (section.blocks ?? []).map((b) => {
      const text = instanceSummary(b.props, editLocale, defaultLocale);
      return [b.id, text ? `${blockName(b.type)} · ${text}` : blockName(b.type)];
    }),
  );

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-80")}>
      <div className={cn(rowBase, selected ? "bg-accent-subtle" : "hover:bg-surface-muted")}>
        {group.canEdit ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t("editor.tree.dragHandle", { name })}
            className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtle hover:text-fg active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        {hasBlocks ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? "editor.tree.collapseBlocks" : "editor.tree.expandBlocks", { name })}
            onClick={() => actions.toggleExpanded(section.id)}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface hover:text-fg"
          >
            {expanded ? <ChevronDown aria-hidden="true" className="size-3.5" /> : <ChevronRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={() => actions.select({ kind: "section", scope: group.scope, sectionId: section.id })}
          className={cn("flex min-w-0 flex-1 flex-col items-start py-1 text-start", selected ? "text-accent-subtle-fg" : "text-fg")}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className={cn("truncate font-medium", section.disabled && "text-fg-muted line-through decoration-fg-subtle")}>{name}</span>
            {required ? (
              <Tooltip content={t("editor.tree.requiredHint")}>
                <span tabIndex={-1} className="inline-flex">
                  <Lock aria-hidden="true" className="size-3 text-fg-subtle" />
                  <span className="sr-only">{t("editor.tree.required")}</span>
                </span>
              </Tooltip>
            ) : null}
            {section.disabled ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-fg-muted">
                <EyeOff aria-hidden="true" className="size-3" />
                {t("editor.tree.hidden")}
              </span>
            ) : null}
            {hasIssue ? (
              <span className="inline-flex shrink-0 items-center text-danger">
                <CircleAlert aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("editor.tree.hasErrors")}</span>
              </span>
            ) : null}
          </span>
          {summary ? <span className="w-full truncate text-xs text-fg-muted">{summary}</span> : null}
        </button>
        {group.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("common.rowActions", { name })}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-100 hover:bg-surface hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:data-[state=open]:opacity-100"
              >
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent aria-label={t("common.rowActions", { name })}>
              <DropdownMenuLabel>{name}</DropdownMenuLabel>
              <DropdownMenuItem disabled={index === 0} onSelect={() => actions.move(group.key, section.id, -1)}>
                <ArrowUp aria-hidden="true" />
                {t("editor.tree.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => actions.move(group.key, section.id, 1)}>
                <ArrowDown aria-hidden="true" />
                {t("editor.tree.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={required || Boolean(def?.singleton)} onSelect={() => actions.duplicate(group.scope, section.id)}>
                <Copy aria-hidden="true" />
                {t("editor.tree.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={required} onSelect={() => actions.toggleHidden(group.scope, section.id)}>
                {section.disabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                {section.disabled ? t("editor.tree.show") : t("editor.tree.hide")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" disabled={required} onSelect={() => actions.remove(group.scope, section.id)}>
                <Trash2 aria-hidden="true" />
                {t("editor.tree.delete")}
              </DropdownMenuItem>
              {required ? <DropdownMenuLabel className="max-w-56 font-normal">{t("editor.tree.requiredHint")}</DropdownMenuLabel> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {hasBlocks && expanded ? (
        <div className="ms-7 flex flex-col gap-0.5 border-s border-border ps-1.5 pt-0.5">
          <SortableList ids={blockIds} names={blockNames} onReorder={(next) => actions.reorderBlocks(group.scope, section.id, next)} disabled={!group.canEdit}>
            <ul className="flex flex-col gap-0.5">
              {(section.blocks ?? []).map((b, j) => (
                <BlockRow key={b.id} block={b} index={j} count={blockIds.length} section={section} group={group} name={blockNames.get(b.id) ?? b.type} selection={selection} actions={actions} />
              ))}
            </ul>
          </SortableList>
          {(section.blocks ?? []).length === 0 ? <p className="px-2 py-1 text-xs text-fg-muted">{t("editor.tree.noBlocks")}</p> : null}
          {group.canEdit ? (
            blockTypes.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="justify-start text-link" disabled={!canAddBlock(def, section)}>
                    <Plus aria-hidden="true" />
                    {t("editor.tree.addBlock")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {blockTypes.map((bt) => (
                    <DropdownMenuItem key={bt} onSelect={() => actions.addBlock(group.scope, section.id, bt)}>
                      {blockName(bt)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button size="sm" variant="ghost" className="justify-start text-link" disabled={!canAddBlock(def, section)} onClick={() => blockTypes[0] && actions.addBlock(group.scope, section.id, blockTypes[0])}>
                <Plus aria-hidden="true" />
                {blockTypes[0] ? t("editor.tree.addBlockNamed", { name: blockName(blockTypes[0]) }) : t("editor.tree.addBlock")}
              </Button>
            )
          ) : null}
          {def?.maxBlocks !== null && def?.maxBlocks !== undefined && (section.blocks?.length ?? 0) >= def.maxBlocks ? (
            <p className="px-2 text-xs text-fg-subtle">{t("editor.tree.blocksFull", { max: def.maxBlocks })}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function BlockRow({
  block,
  index,
  count,
  section,
  group,
  name,
  selection,
  actions,
}: {
  block: BlockInstance;
  index: number;
  count: number;
  section: SectionInstance;
  group: TreeGroup;
  name: string;
  selection: Selection | null;
  actions: TreeActions;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !group.canEdit });
  const selected = selection?.kind === "block" && selection.blockId === block.id;
  const hasIssue = blockHasIssue(group.issues, section.id, block.id);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-80")}>
      <div className={cn(rowBase, "min-h-8", selected ? "bg-accent-subtle" : "hover:bg-surface-muted")}>
        {group.canEdit ? (
          <button type="button" {...attributes} {...listeners} aria-label={t("editor.tree.dragHandle", { name })} className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtle hover:text-fg">
            <GripVertical aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={() => actions.select({ kind: "block", scope: group.scope, sectionId: section.id, blockId: block.id })}
          className={cn("flex min-w-0 flex-1 items-center gap-1.5 py-1 text-start text-sm", selected ? "text-accent-subtle-fg" : "text-fg")}
        >
          <span className="truncate">{name}</span>
          {hasIssue ? (
            <span className="inline-flex shrink-0 items-center text-danger">
              <CircleAlert aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("editor.tree.hasErrors")}</span>
            </span>
          ) : null}
        </button>
        {group.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("common.rowActions", { name })}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
              >
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled={index === 0} onSelect={() => actions.moveBlock(group.scope, section.id, block.id, -1)}>
                <ArrowUp aria-hidden="true" />
                {t("editor.tree.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => actions.moveBlock(group.scope, section.id, block.id, 1)}>
                <ArrowDown aria-hidden="true" />
                {t("editor.tree.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.duplicateBlock(group.scope, section.id, block.id)}>
                <Copy aria-hidden="true" />
                {t("editor.tree.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => actions.removeBlock(group.scope, section.id, block.id)}>
                <Trash2 aria-hidden="true" />
                {t("editor.tree.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}
