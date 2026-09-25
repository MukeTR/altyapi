"use client";

import { Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { ConflictBanner } from "@/components/ui/conflict-banner";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import { mapSectionIssues, requiredIssues, type Issue } from "@/lib/storefront/issues";
import { isContentPage, pagePublishPermission, pageWritePermission } from "@/lib/storefront/permissions";
import { localizedPath, previewTarget, type PreviewSamples } from "@/lib/storefront/preview";
import { definitionOf, duplicateSection, MAX_SECTIONS, moveItem, newBlock, newId, newSection, toSectionInput } from "@/lib/storefront/sections";
import type { Device, HistoryList, NavigationMenu, PageSeo, SectionDefinition, SectionInstance, StorefrontPage, StorefrontTheme } from "@/lib/storefront/types";
import { HistoryDrawer } from "../history-drawer";
import { PublishDialog, ScheduleDialog, UnpublishDialog, pageTitleOf } from "../publish-dialogs";
import { EditorProvider, EditorScope, type EditorContextValue } from "./editor-context";
import { EditorTopBar, type SaveSummary } from "./editor-top-bar";
import { PageSettingsForm } from "./page-settings-form";
import { PreviewPane } from "./preview-pane";
import { BlockPanel, EmptyPanel, SectionPanel } from "./properties-panel";
import { SectionLibrary, type LibraryTarget } from "./section-library";
import { SectionTree, type GroupKey, type Scope, type Selection, type TreeActions, type TreeGroup } from "./section-tree";
import { ThemeSettingsForm } from "./theme-settings-form";
import { useDraft, type Draft } from "./use-draft";

/** Global sections the storefront renders above the page (the rest render below it). */
const TOP_TYPES = new Set(["announcement-bar", "header", "countdown"]);
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Resource = "page" | "theme";
interface UndoEntry {
  resource: Resource;
  id: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function cleanSeo(seo: PageSeo): PageSeo {
  const out: PageSeo = {};
  if (seo.title && Object.keys(seo.title).length) out.title = seo.title;
  if (seo.description && Object.keys(seo.description).length) out.description = seo.description;
  if (seo.imageAssetId !== undefined) out.imageAssetId = seo.imageAssetId;
  if (seo.noindex !== undefined) out.noindex = seo.noindex;
  if (seo.canonicalPath !== undefined) out.canonicalPath = seo.canonicalPath;
  return out;
}

function inTopGroup(s: SectionInstance) {
  return TOP_TYPES.has(s.type);
}

export interface StorefrontEditorProps {
  pages: StorefrontPage[];
  initialPage: StorefrontPage;
  theme: StorefrontTheme;
  definitions: SectionDefinition[];
  menus: NavigationMenu[];
  samples: PreviewSamples;
  initialLocale: string;
  initialDevice: Device;
  initialPanel: "theme" | null;
}

/**
 * The storefront editor: section tree on the left, live draft preview in the middle and the
 * selected item's properties on the right. Every change is saved to the draft automatically
 * (the live site changes only on publish); undo, redo and restore move through the draft's
 * server-side revisions.
 */
export function StorefrontEditor(props: StorefrontEditorProps) {
  const { t, locale: ui, describeError } = useI18n();
  const store = useStore();
  const { apiBase, can } = store;
  const { toast, toastError } = useToast();

  const [pages, setPages] = useState(props.pages);
  const [editLocale, setEditLocale] = useState(props.initialLocale);
  const [device, setDevice] = useState<Device>(props.initialDevice);
  const [selection, setSelection] = useState<Selection | null>(props.initialPanel === "theme" ? { kind: "theme-settings" } : null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [library, setLibrary] = useState<{ group: GroupKey } | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [historyFor, setHistoryFor] = useState<Resource | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"tree" | "props" | null>(null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Record<Resource, { canUndo: boolean; canRedo: boolean }>>({
    page: { canUndo: false, canRedo: false },
    theme: { canUndo: false, canRedo: false },
  });
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [, setStacks] = useState(0);
  const suppressUndoRecord = useRef(false);

  const canEditTheme = can("storefront:write");
  const storeModules = (store.store as { modules?: string[] }).modules ?? null;

  const bumpPreview = useCallback(() => setPreviewNonce((n) => n + 1), []);

  const recordUndo = useCallback((entry: UndoEntry) => {
    if (suppressUndoRecord.current) return;
    undoStack.current.push(entry);
    redoStack.current = [];
    setStacks((n) => n + 1);
  }, []);

  // ---------------------------------------------------------------- page draft
  const pageRef = useRef(props.initialPage);
  const pageDraft: Draft<StorefrontPage> = useDraft<StorefrontPage>({
    initial: props.initialPage,
    enabled: can(pageWritePermission(pageRef.current.type)),
    revision: (p) => p.draftRevision,
    validate: (p) => {
      const issues: Issue[] = requiredIssues(p.draftContent.sections, props.definitions);
      if (isContentPage(p.type) && !HANDLE.test(p.handle)) issues.push({ path: "handle", message: "errors.page.invalid_handle" });
      return issues;
    },
    mapIssues: (issues, sent) => mapSectionIssues(issues, sent.draftContent.sections),
    save: async (local, server, expectedRevision) => {
      const body: Record<string, unknown> = { expectedRevision };
      if (!same(local.draftContent.sections, server.draftContent.sections)) body.content = { sections: local.draftContent.sections.map(toSectionInput) };
      if (!same(local.title, server.title)) body.title = local.title;
      if (isContentPage(local.type) && local.handle !== server.handle) body.handle = local.handle;
      if (!same(local.draftSeo, server.draftSeo)) body.seo = cleanSeo(local.draftSeo ?? {});
      if (Object.keys(body).length === 1) return server;
      return bff<StorefrontPage>(`${apiBase}/storefront/pages/${local.id}`, { method: "PUT", body });
    },
    onSaved: (saved) => {
      setPages((list) => list.map((p) => (p.id === saved.id ? saved : p)));
      recordUndo({ resource: "page", id: saved.id });
      setAvailability((a) => ({ ...a, page: { canUndo: true, canRedo: false } }));
      bumpPreview();
    },
  });
  const page = pageDraft.value;
  pageRef.current = page;
  const canEditPage = can(pageWritePermission(page.type));

  // ---------------------------------------------------------------- theme draft
  const themeDraft: Draft<StorefrontTheme> = useDraft<StorefrontTheme>({
    initial: props.theme,
    enabled: canEditTheme,
    revision: (th) => th.draftRevision,
    validate: (th) => requiredIssues(th.globalSections.sections, props.definitions),
    mapIssues: (issues, sent) => {
      const mapped = mapSectionIssues(issues, sent.globalSections.sections);
      return mapped.map((i) => (i.path.startsWith("section:") || i.path === "sections" ? i : { ...i, path: `settings/${i.path}` }));
    },
    save: async (local, server, expectedRevision) => {
      const body: Record<string, unknown> = { expectedRevision };
      if (!same(local.settings, server.settings)) body.settings = local.settings;
      if (!same(local.globalSections.sections, server.globalSections.sections)) body.globalSections = { sections: local.globalSections.sections.map(toSectionInput) };
      if (Object.keys(body).length === 1) return server;
      const res = await bff<Pick<StorefrontTheme, "id" | "name" | "settings" | "globalSections" | "draftRevision">>(`${apiBase}/storefront/theme`, { method: "PUT", body });
      return { ...server, ...res, hasUnpublishedChanges: true };
    },
    onSaved: () => {
      recordUndo({ resource: "theme", id: props.theme.id });
      setAvailability((a) => ({ ...a, theme: { canUndo: true, canRedo: false } }));
      bumpPreview();
    },
  });
  const theme = themeDraft.value;

  // ---------------------------------------------------------------- history availability
  const refreshAvailability = useCallback(
    async (resource: Resource, id: string) => {
      try {
        const h = await bff<HistoryList>(`${apiBase}/storefront/history/${resource}/${id}`);
        setAvailability((a) => ({ ...a, [resource]: { canUndo: h.canUndo, canRedo: h.canRedo } }));
      } catch {
        // Availability is a hint for the buttons; the undo call itself reports real errors.
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void refreshAvailability("theme", props.theme.id);
  }, [refreshAvailability, props.theme.id]);
  useEffect(() => {
    void refreshAvailability("page", page.id);
  }, [refreshAvailability, page.id]);

  const flushAll = useCallback(async () => {
    const [a, b] = await Promise.all([pageDraft.flush(), themeDraft.flush()]);
    return a && b;
  }, [pageDraft, themeDraft]);

  const fetchFresh = useCallback(
    async (resource: Resource) => {
      if (resource === "page") {
        const fresh = await bff<StorefrontPage>(`${apiBase}/storefront/pages/${pageRef.current.id}`);
        pageDraft.replace(fresh);
        setPages((list) => list.map((p) => (p.id === fresh.id ? fresh : p)));
      } else {
        const fresh = await bff<StorefrontTheme>(`${apiBase}/storefront/theme`);
        themeDraft.replace(fresh);
      }
      setResetNonce((n) => n + 1);
      bumpPreview();
    },
    [apiBase, pageDraft, themeDraft, bumpPreview],
  );

  // ---------------------------------------------------------------- undo / redo
  const selectedResource: Resource = selection?.kind === "theme-settings" || ((selection?.kind === "section" || selection?.kind === "block") && selection.scope === "global") ? "theme" : "page";
  const undoPermission = (r: Resource) => (r === "page" ? can("content:write") : canEditTheme);
  const nextUndo = undoStack.current.at(-1) ?? { resource: selectedResource, id: selectedResource === "page" ? page.id : theme.id };
  const nextRedo = redoStack.current.at(-1) ?? { resource: selectedResource, id: selectedResource === "page" ? page.id : theme.id };
  const canUndo = undoPermission(nextUndo.resource) && (undoStack.current.length > 0 || availability[selectedResource].canUndo);
  const canRedo = undoPermission(nextRedo.resource) && (redoStack.current.length > 0 || availability[selectedResource].canRedo);

  const move = useCallback(
    async (kind: "undo" | "redo") => {
      const stack = kind === "undo" ? undoStack.current : redoStack.current;
      const entry = stack.at(-1) ?? { resource: selectedResource, id: selectedResource === "page" ? pageRef.current.id : props.theme.id };
      if (!undoPermission(entry.resource)) return;
      setBusy(true);
      try {
        suppressUndoRecord.current = true;
        const saved = await flushAll();
        suppressUndoRecord.current = false;
        // Undo/redo reloads the resource afterwards, which would discard edits that could not be saved.
        if (!saved) {
          toast({ tone: "error", title: t("editor.history.blocked") });
          return;
        }
        // Read after the flush: a save it made has moved the draft to a newer revision.
        const revision = entry.resource === "page" ? pageDraft.currentRevision() : themeDraft.currentRevision();
        await bff(`${apiBase}/storefront/history/${entry.resource}/${entry.id}/${kind}`, { method: "POST", body: { expectedRevision: revision } });
        stack.pop();
        (kind === "undo" ? redoStack.current : undoStack.current).push(entry);
        setStacks((n) => n + 1);
        await fetchFresh(entry.resource);
        void refreshAvailability(entry.resource, entry.id);
        toast({ tone: "info", title: kind === "undo" ? t("editor.history.undone") : t("editor.history.redone") });
      } catch (err) {
        suppressUndoRecord.current = false;
        if (err instanceof ApiError) {
          const info = err.toInfo();
          if (info.messageKey === "errors.history.nothing_to_undo" || info.messageKey === "errors.history.nothing_to_redo") {
            stack.pop();
            setStacks((n) => n + 1);
            void refreshAvailability(entry.resource, entry.id);
            toast({ tone: "info", title: describeError(info).message });
          } else toastError(info);
        } else throw err;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedResource, flushAll, pageDraft, themeDraft, apiBase, fetchFresh, refreshAvailability, toast, toastError, describeError, t, props.theme.id],
  );

  // ---------------------------------------------------------------- keyboard and leave guard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void flushAll();
        return;
      }
      const target = e.target as HTMLElement | null;
      const editable = target?.closest("input, textarea, select, [contenteditable=true], [role=textbox]");
      if (editable) return;
      if (key === "z" && !e.shiftKey && canUndo && !busy) {
        e.preventDefault();
        void move("undo");
      } else if (((key === "z" && e.shiftKey) || key === "y") && canRedo && !busy) {
        e.preventDefault();
        void move("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushAll, move, canUndo, canRedo, busy]);

  const unsaved = pageDraft.dirty || themeDraft.dirty || pageDraft.status === "saving" || themeDraft.status === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // ---------------------------------------------------------------- URL state
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", page.id);
    if (editLocale !== store.store.defaultLocale) url.searchParams.set("locale", editLocale);
    else url.searchParams.delete("locale");
    if (device !== "desktop") url.searchParams.set("device", device);
    else url.searchParams.delete("device");
    url.searchParams.delete("panel");
    window.history.replaceState(window.history.state, "", url);
  }, [page.id, editLocale, device, store.store.defaultLocale]);

  // ---------------------------------------------------------------- sections
  const updateSections = useCallback(
    (scope: Scope, fn: (sections: SectionInstance[]) => SectionInstance[], immediate = true) => {
      if (scope === "page") pageDraft.update((p) => ({ ...p, draftContent: { ...p.draftContent, sections: fn(p.draftContent.sections) } }), { immediate });
      else themeDraft.update((th) => ({ ...th, globalSections: { ...th.globalSections, sections: fn(th.globalSections.sections) } }), { immediate });
    },
    [pageDraft, themeDraft],
  );

  const globalSections = theme.globalSections.sections;
  const topSections = globalSections.filter(inTopGroup);
  const bottomSections = globalSections.filter((s) => !inTopGroup(s));
  const groupSections = (g: GroupKey) => (g === "page" ? page.draftContent.sections : g === "top" ? topSections : bottomSections);
  const setGroup = (g: GroupKey, next: SectionInstance[]) => {
    if (g === "page") updateSections("page", () => next);
    else updateSections("global", (all) => (g === "top" ? [...next, ...all.filter((s) => !inTopGroup(s))] : [...all.filter(inTopGroup), ...next]));
  };
  const scopeOf = (g: GroupKey): Scope => (g === "page" ? "page" : "global");

  const findSection = (scope: Scope, id: string) => (scope === "page" ? page.draftContent.sections : globalSections).find((s) => s.id === id);

  const actions: TreeActions = {
    select: (s) => {
      setSelection(s);
      if (s.kind === "block") setExpanded((e) => new Set(e).add(s.sectionId));
      setMobilePane((m) => (m === "tree" ? "props" : m));
    },
    reorder: (g, ids) => {
      const byId = new Map(groupSections(g).map((s) => [s.id, s]));
      setGroup(g, ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])));
    },
    move: (g, id, delta) => {
      const list = groupSections(g);
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) return;
      setGroup(g, moveItem(list, i, i + delta));
    },
    toggleHidden: (scope, id) => updateSections(scope, (list) => list.map((s) => (s.id === id ? (s.disabled ? (({ disabled: _d, ...rest }) => rest)(s) : { ...s, disabled: true }) : s))),
    duplicate: (scope, id) =>
      updateSections(scope, (list) => {
        const i = list.findIndex((s) => s.id === id);
        if (i < 0 || list.length >= MAX_SECTIONS) return list;
        const copy = duplicateSection(list[i]!);
        const next = [...list];
        next.splice(i + 1, 0, copy);
        setSelection({ kind: "section", scope, sectionId: copy.id });
        return next;
      }),
    remove: (scope, id) => {
      updateSections(scope, (list) => list.filter((s) => s.id !== id));
      if ((selection?.kind === "section" || selection?.kind === "block") && selection.sectionId === id) setSelection(null);
      toast({ tone: "info", title: t("editor.tree.deleted"), description: t("editor.tree.deletedHint") });
    },
    openLibrary: (g) => setLibrary({ group: g }),
    addBlock: (scope, sectionId, blockType) => {
      const section = findSection(scope, sectionId);
      const def = section ? definitionOf(props.definitions, section.type, section.version) : undefined;
      if (!section || !def) return;
      const block = newBlock(def, blockType);
      updateSections(scope, (list) => list.map((s) => (s.id === sectionId ? { ...s, blocks: [...(s.blocks ?? []), block] } : s)));
      setExpanded((e) => new Set(e).add(sectionId));
      setSelection({ kind: "block", scope, sectionId, blockId: block.id });
    },
    reorderBlocks: (scope, sectionId, ids) =>
      updateSections(scope, (list) =>
        list.map((s) => {
          if (s.id !== sectionId) return s;
          const byId = new Map((s.blocks ?? []).map((b) => [b.id, b]));
          return { ...s, blocks: ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) };
        }),
      ),
    moveBlock: (scope, sectionId, blockId, delta) =>
      updateSections(scope, (list) =>
        list.map((s) => {
          if (s.id !== sectionId || !s.blocks) return s;
          const i = s.blocks.findIndex((b) => b.id === blockId);
          return i < 0 ? s : { ...s, blocks: moveItem(s.blocks, i, i + delta) };
        }),
      ),
    duplicateBlock: (scope, sectionId, blockId) =>
      updateSections(scope, (list) =>
        list.map((s) => {
          if (s.id !== sectionId || !s.blocks) return s;
          const i = s.blocks.findIndex((b) => b.id === blockId);
          if (i < 0) return s;
          const def = definitionOf(props.definitions, s.type, s.version);
          if (def?.maxBlocks !== null && def?.maxBlocks !== undefined && s.blocks.length >= def.maxBlocks) return s;
          const copy = { ...structuredClone(s.blocks[i]!), id: newId() };
          const blocks = [...s.blocks];
          blocks.splice(i + 1, 0, copy);
          return { ...s, blocks };
        }),
      ),
    removeBlock: (scope, sectionId, blockId) => {
      updateSections(scope, (list) => list.map((s) => (s.id === sectionId ? { ...s, blocks: (s.blocks ?? []).filter((b) => b.id !== blockId) } : s)));
      if (selection?.kind === "block" && selection.blockId === blockId) setSelection({ kind: "section", scope, sectionId });
    },
    toggleExpanded: (id) =>
      setExpanded((e) => {
        const next = new Set(e);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  const addFromLibrary = (def: SectionDefinition) => {
    if (!library) return;
    const g = library.group;
    const scope = scopeOf(g);
    const section = newSection(def);
    const list = groupSections(g);
    const selectedIndex = selection?.kind === "section" && selection.scope === scope ? list.findIndex((s) => s.id === selection.sectionId) : -1;
    const next = [...list];
    next.splice(selectedIndex >= 0 ? selectedIndex + 1 : next.length, 0, section);
    setGroup(g, next);
    setSelection({ kind: "section", scope, sectionId: section.id });
    if (Object.keys(def.blocks).length) setExpanded((e) => new Set(e).add(section.id));
    setLibrary(null);
    toast({ tone: "success", title: t("editor.library.added", { name: def.name[ui] ?? def.type }) });
  };

  // Selection that no longer exists (after undo, restore or delete) falls back to nothing.
  useEffect(() => {
    if (selection?.kind !== "section" && selection?.kind !== "block") return;
    const s = findSection(selection.scope, selection.sectionId);
    if (!s || (selection.kind === "block" && !s.blocks?.some((b) => b.id === selection.blockId))) setSelection(s ? { kind: "section", scope: selection.scope, sectionId: s.id } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.draftContent.sections, globalSections]);

  // ---------------------------------------------------------------- page switching
  const switchPage = async (id: string) => {
    if (id === page.id) return;
    setBusy(true);
    try {
      // Switching replaces the page draft; never drop edits that could not be saved.
      if (!(await flushAll())) {
        toast({ tone: "error", title: t("editor.switchBlocked") });
        return;
      }
      const fresh = await bff<StorefrontPage>(`${apiBase}/storefront/pages/${id}`);
      undoStack.current = undoStack.current.filter((e) => e.resource === "theme");
      redoStack.current = redoStack.current.filter((e) => e.resource === "theme");
      pageDraft.replace(fresh);
      setSelection((s) => (s?.kind === "theme-settings" || ((s?.kind === "section" || s?.kind === "block") && s.scope === "global") ? s : null));
      setResetNonce((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- derived view data
  const pageTitle = pageTitleOf(page, ui, store.store.defaultLocale);
  const target = previewTarget(page, props.samples);
  const previewPath = target.ok ? localizedPath(target.path, editLocale, store.store.defaultLocale) : null;

  const readOnlyReason = !canEditPage && !canEditTheme ? t("editor.readOnly") : null;
  const groups: TreeGroup[] = [
    {
      key: "top",
      scope: "global",
      title: t("editor.tree.top"),
      placement: "global",
      sections: topSections,
      canEdit: canEditTheme,
      issues: themeDraft.issues,
      addDisabledReason: !canEditTheme ? null : globalSections.length >= MAX_SECTIONS ? t("editor.library.limit", { max: MAX_SECTIONS }) : null,
      emptyText: t("editor.tree.emptyGroup"),
    },
    {
      key: "page",
      scope: "page",
      title: t("editor.tree.thisPage"),
      placement: page.type,
      sections: page.draftContent.sections,
      canEdit: canEditPage,
      issues: pageDraft.issues,
      addDisabledReason: !canEditPage ? null : page.draftContent.sections.length >= MAX_SECTIONS ? t("editor.library.limit", { max: MAX_SECTIONS }) : null,
      emptyText: t("editor.tree.emptyPage"),
    },
    {
      key: "bottom",
      scope: "global",
      title: t("editor.tree.bottom"),
      placement: "global",
      sections: bottomSections,
      canEdit: canEditTheme,
      issues: themeDraft.issues,
      addDisabledReason: !canEditTheme ? null : globalSections.length >= MAX_SECTIONS ? t("editor.library.limit", { max: MAX_SECTIONS }) : null,
      emptyText: t("editor.tree.emptyGroup"),
    },
  ];

  const libraryTarget: LibraryTarget | null = library
    ? {
        placement: library.group === "page" ? page.type : "global",
        sections: library.group === "page" ? page.draftContent.sections : globalSections,
        title: library.group === "page" ? t("editor.library.forPage", { page: pageTitle }) : library.group === "top" ? t("editor.library.forTop") : t("editor.library.forBottom"),
        ...(library.group === "top" ? { accept: (d: SectionDefinition) => TOP_TYPES.has(d.type) } : library.group === "bottom" ? { accept: (d: SectionDefinition) => !TOP_TYPES.has(d.type) } : {}),
      }
    : null;

  const baseContext: EditorContextValue = useMemo(
    () => ({
      definitions: props.definitions,
      editLocale,
      defaultLocale: store.store.defaultLocale,
      locales: store.store.supportedLocales,
      themeSettings: theme.settings,
      menus: props.menus,
      pages,
      issues: pageDraft.issues,
      canEdit: canEditPage,
      resetNonce,
    }),
    [props.definitions, editLocale, store.store.defaultLocale, store.store.supportedLocales, theme.settings, props.menus, pages, pageDraft.issues, canEditPage, resetNonce],
  );

  const save: SaveSummary = {
    page: pageDraft,
    theme: themeDraft,
  };

  // ---------------------------------------------------------------- right panel
  const renderPanel = () => {
    if (!selection) return <EmptyPanel />;
    if (selection.kind === "page-settings") {
      return (
        <div className="flex flex-col">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-md font-semibold text-fg">{t("editor.tree.pageSettings")}</h2>
            <p className="text-sm text-fg-muted">{pageTitle}</p>
          </div>
          <div className="px-4 py-4">
            <PageSettingsForm page={page} error={pageDraft.error} onChange={(next, o) => pageDraft.update(() => next, o)} />
          </div>
        </div>
      );
    }
    if (selection.kind === "theme-settings") {
      return (
        <EditorScope issues={themeDraft.issues} canEdit={canEditTheme}>
          <div className="flex flex-col">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-md font-semibold text-fg">{t("editor.tree.themeSettings")}</h2>
              <p className="text-sm text-fg-muted">{t("editor.theme.intro")}</p>
            </div>
            <div className="px-4 py-2">
              <ThemeSettingsForm settings={theme.settings} onChange={(settings, o) => themeDraft.update((th) => ({ ...th, settings }), o)} />
            </div>
          </div>
        </EditorScope>
      );
    }
    const scope = selection.scope;
    const section = findSection(scope, selection.sectionId);
    if (!section) return <EmptyPanel />;
    const scoped = (node: ReactNode) =>
      scope === "global" ? (
        <EditorScope issues={themeDraft.issues} canEdit={canEditTheme}>
          {node}
        </EditorScope>
      ) : (
        node
      );
    if (selection.kind === "block") {
      const block = section.blocks?.find((b) => b.id === selection.blockId);
      if (!block) return <EmptyPanel />;
      return scoped(
        <BlockPanel
          section={section}
          block={block}
          onBack={() => setSelection({ kind: "section", scope, sectionId: section.id })}
          onDuplicate={() => actions.duplicateBlock(scope, section.id, block.id)}
          onRemove={() => actions.removeBlock(scope, section.id, block.id)}
          onChange={(next, o) => updateSections(scope, (list) => list.map((s) => (s.id === section.id ? { ...s, blocks: (s.blocks ?? []).map((b) => (b.id === block.id ? next : b)) } : s)), o?.immediate ?? false)}
        />,
      );
    }
    return scoped(
      <SectionPanel
        section={section}
        scope={scope}
        placement={scope === "page" ? page.type : "global"}
        onToggleHidden={() => actions.toggleHidden(scope, section.id)}
        onDuplicate={() => actions.duplicate(scope, section.id)}
        onRemove={() => actions.remove(scope, section.id)}
        onChange={(next, o) => updateSections(scope, (list) => list.map((s) => (s.id === section.id ? next : s)), o?.immediate ?? false)}
      />,
    );
  };

  const conflict = pageDraft.status === "conflict" ? { draft: "page" as const } : themeDraft.status === "conflict" ? { draft: "theme" as const } : null;

  const tree = <SectionTree groups={groups} definitions={props.definitions} selection={selection} expanded={expanded} actions={actions} pageLabel={pageTitle} />;
  const panel = <div className="min-h-0">{renderPanel()}</div>;

  return (
    <EditorProvider value={baseContext}>
      <div className="flex h-dvh flex-col bg-canvas">
        <EditorTopBar
          page={page}
          pages={pages}
          busy={busy}
          onSwitchPage={(id) => void switchPage(id)}
          canUndo={canUndo && !busy}
          canRedo={canRedo && !busy}
          onUndo={() => void move("undo")}
          onRedo={() => void move("redo")}
          onHistory={() => setHistoryFor(selectedResource)}
          device={device}
          onDevice={setDevice}
          editLocale={editLocale}
          onEditLocale={setEditLocale}
          save={save}
          onFlush={() => void flushAll()}
          previewPath={previewPath}
          onPublish={() => setPublishOpen(true)}
          canPublish={can("storefront:publish") || can(pagePublishPermission(page.type))}
          onSchedule={isContentPage(page.type) && can(pagePublishPermission(page.type)) ? () => setScheduleOpen(true) : null}
          onUnpublish={isContentPage(page.type) && page.status === "published" && can(pagePublishPermission(page.type)) ? () => setUnpublishOpen(true) : null}
          onOpenTree={() => setMobilePane("tree")}
          onOpenProps={() => setMobilePane("props")}
        />
        {conflict ? (
          <div className="border-b border-border bg-surface px-4 py-2">
            <ConflictBanner
              onReload={() => void fetchFresh(conflict.draft)}
              onOverwrite={() => (conflict.draft === "page" ? pageDraft.overwrite() : themeDraft.overwrite())}
            />
          </div>
        ) : null}
        {readOnlyReason ? (
          <div className="border-b border-border bg-surface px-4 py-2">
            <InlineAlert tone="info">{readOnlyReason}</InlineAlert>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <aside aria-label={t("editor.tree.label")} className="hidden w-[280px] shrink-0 overflow-y-auto border-e border-border bg-surface lg:block">
            {tree}
          </aside>
          <main id="main" tabIndex={-1} aria-label={t("editor.preview.title")} className="min-w-0 flex-1 outline-none">
            <PreviewPane
              path={previewPath}
              device={device}
              reloadKey={previewNonce}
              title={t("editor.preview.iframeTitle", { page: pageTitle })}
              placeholder={
                <EmptyState
                  icon={Layers}
                  title={t("editor.preview.needsProductTitle")}
                  description={t("editor.preview.needsProductBody")}
                />
              }
            />
          </main>
          <aside aria-label={t("editor.props.label")} className="hidden w-[340px] shrink-0 overflow-y-auto border-s border-border bg-surface lg:block">
            {panel}
          </aside>
        </div>
      </div>

      <Drawer open={mobilePane === "tree"} onOpenChange={(o) => setMobilePane(o ? "tree" : null)} side="start" width={480} title={t("editor.tree.label")}>
        {tree}
      </Drawer>
      <Drawer open={mobilePane === "props"} onOpenChange={(o) => setMobilePane(o ? "props" : null)} width={480} title={t("editor.props.label")}>
        {panel}
      </Drawer>

      <SectionLibrary open={library !== null} onOpenChange={(o) => !o && setLibrary(null)} target={libraryTarget} definitions={props.definitions} storeModules={storeModules} onAdd={addFromLibrary} />

      {historyFor ? (
        <HistoryDrawer
          open
          onOpenChange={(o) => !o && setHistoryFor(null)}
          resource={historyFor}
          resourceId={historyFor === "page" ? page.id : theme.id}
          title={historyFor === "page" ? t("editor.history.pageTitle", { page: pageTitle }) : t("editor.history.themeTitle")}
          canRestore={undoPermission(historyFor)}
          beforeRestore={async () => {
            const ok = await flushAll();
            if (!ok) toast({ tone: "error", title: t("editor.history.blocked") });
            return ok;
          }}
          onRestored={async () => {
            recordUndo({ resource: historyFor, id: historyFor === "page" ? page.id : theme.id });
            await fetchFresh(historyFor);
            void refreshAvailability(historyFor, historyFor === "page" ? page.id : theme.id);
          }}
        />
      ) : null}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        pages={pages}
        themeHasChanges={theme.hasUnpublishedChanges ?? null}
        currentPage={page}
        beforePublish={async () => {
          const ok = await flushAll();
          if (!ok) toast({ tone: "error", title: t("editor.publishBlocked") });
          return ok;
        }}
        onPublished={async () => {
          const [list, freshTheme] = await Promise.all([bff<{ items: StorefrontPage[] }>(`${apiBase}/storefront/pages`), bff<StorefrontTheme>(`${apiBase}/storefront/theme`)]);
          setPages(list.items);
          const fresh = list.items.find((p) => p.id === pageRef.current.id);
          if (fresh) pageDraft.replace(fresh);
          themeDraft.replace(freshTheme);
          bumpPreview();
        }}
      />
      {isContentPage(page.type) ? (
        <>
          <ScheduleDialog
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
            page={page}
            onSaved={(saved) => {
              setPages((list) => list.map((p) => (p.id === saved.id ? saved : p)));
              pageDraft.replace(saved);
            }}
          />
          <UnpublishDialog
            open={unpublishOpen}
            onOpenChange={setUnpublishOpen}
            page={page}
            onDone={() => void fetchFresh("page")}
          />
        </>
      ) : null}
      {pageDraft.error && pageDraft.status === "error" && !pageDraft.issues.length && selection?.kind !== "page-settings" ? (
        <span className="sr-only" role="alert">
          {describeError(pageDraft.error).message}
        </span>
      ) : null}
    </EditorProvider>
  );
}
