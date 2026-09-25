import type { NavItem, NavLink } from "./types";

/** Menus may nest three levels deep (the API refuses deeper trees). */
export const MAX_NAV_DEPTH = 3;
export const MAX_TOP_ITEMS = 50;
export const MAX_CHILDREN = 30;

export function countItems(items: readonly NavItem[]): number {
  return items.reduce((n, i) => n + 1 + countItems(i.children ?? []), 0);
}

/** Levels below and including an item (a leaf is 1). */
export function subtreeDepth(item: NavItem): number {
  return 1 + Math.max(0, ...(item.children ?? []).map(subtreeDepth));
}

/** Level of an item (top level is 1), or 0 when not found. */
export function depthOf(items: readonly NavItem[], id: string, level = 1): number {
  for (const i of items) {
    if (i.id === id) return level;
    const d = depthOf(i.children ?? [], id, level + 1);
    if (d) return d;
  }
  return 0;
}

export function findItem(items: readonly NavItem[], id: string): NavItem | undefined {
  for (const i of items) {
    if (i.id === id) return i;
    const found = findItem(i.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

/** Siblings list containing the item, with its parent id (null at top level). */
export function siblingsOf(items: readonly NavItem[], id: string, parent: string | null = null): { list: readonly NavItem[]; parent: string | null } | null {
  if (items.some((i) => i.id === id)) return { list: items, parent };
  for (const i of items) {
    const found = siblingsOf(i.children ?? [], id, i.id);
    if (found) return found;
  }
  return null;
}

function withChildren(item: NavItem, children: NavItem[]): NavItem {
  const { children: _old, ...rest } = item;
  return children.length ? { ...rest, children } : rest;
}

/** Replaces the list of children of `parent` (null = top level). */
export function setChildren(items: readonly NavItem[], parent: string | null, children: NavItem[]): NavItem[] {
  if (parent === null) return children;
  return items.map((i) => (i.id === parent ? withChildren(i, children) : withChildren(i, setChildren(i.children ?? [], parent, children))));
}

export function updateItem(items: readonly NavItem[], id: string, fn: (item: NavItem) => NavItem): NavItem[] {
  return items.map((i) => (i.id === id ? fn(i) : i.children ? withChildren(i, updateItem(i.children, id, fn)) : i));
}

export function removeItem(items: readonly NavItem[], id: string): NavItem[] {
  return items.filter((i) => i.id !== id).map((i) => (i.children ? withChildren(i, removeItem(i.children, id)) : i));
}

export function reorderLevel(items: readonly NavItem[], parent: string | null, orderedIds: string[]): NavItem[] {
  const list = parent === null ? items : (findItem(items, parent)?.children ?? []);
  const byId = new Map(list.map((i) => [i.id, i]));
  return setChildren(items, parent, orderedIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])));
}

export function moveWithinLevel(items: readonly NavItem[], id: string, delta: -1 | 1): NavItem[] {
  const s = siblingsOf(items, id);
  if (!s) return [...items];
  const ids = s.list.map((i) => i.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (to < 0 || to >= ids.length) return [...items];
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  return reorderLevel(items, s.parent, ids);
}

/** Whether the item can become the last child of its previous sibling without exceeding the depth limit. */
export function canIndent(items: readonly NavItem[], id: string): boolean {
  const s = siblingsOf(items, id);
  const index = s ? s.list.findIndex((i) => i.id === id) : -1;
  const item = s?.list[index];
  if (!s || index <= 0 || !item) return false;
  const prev = s.list[index - 1]!;
  return depthOf(items, id) + subtreeDepth(item) <= MAX_NAV_DEPTH && (prev.children?.length ?? 0) < MAX_CHILDREN;
}

export function indent(items: readonly NavItem[], id: string): NavItem[] {
  if (!canIndent(items, id)) return [...items];
  const s = siblingsOf(items, id)!;
  const index = s.list.findIndex((i) => i.id === id);
  const item = s.list[index]!;
  const prev = s.list[index - 1]!;
  const newPrev = withChildren(prev, [...(prev.children ?? []), item]);
  const nextList = s.list.flatMap((i) => (i.id === id ? [] : i.id === prev.id ? [newPrev] : [i]));
  return setChildren(items, s.parent, nextList);
}

export function canOutdent(items: readonly NavItem[], id: string): boolean {
  return depthOf(items, id) > 1;
}

/** Moves an item up one level, right after its current parent. */
export function outdent(items: readonly NavItem[], id: string): NavItem[] {
  const s = siblingsOf(items, id);
  if (!s || s.parent === null) return [...items];
  const item = s.list.find((i) => i.id === id)!;
  const parentSiblings = siblingsOf(items, s.parent)!;
  const without = removeItem(items, id);
  const parentList = parentSiblings.parent === null ? without : (findItem(without, parentSiblings.parent)?.children ?? []);
  const at = parentList.findIndex((i) => i.id === s.parent);
  const next = [...parentList];
  next.splice(at + 1, 0, item);
  return setChildren(without, parentSiblings.parent, next);
}

/** A link is complete when it points somewhere (URL typed, page/collection/product chosen). */
export function linkComplete(link: NavLink): boolean {
  switch (link.type) {
    case "url":
      return (link.url.startsWith("/") && !link.url.startsWith("//")) || /^https?:\/\/\S+$/.test(link.url);
    case "page":
      return Boolean(link.pageId);
    case "collection":
      return Boolean(link.collectionId);
    case "product":
      return Boolean(link.productId);
    case "entry":
      return Boolean(link.entryId);
    case "entry_index":
      return Boolean(link.typeId);
    default:
      return true;
  }
}

/** Items with a missing default-language label or an incomplete link. */
export function invalidItems(items: readonly NavItem[], defaultLocale: string): string[] {
  return items.flatMap((i) => [...(!(i.label[defaultLocale] ?? "").trim() || !linkComplete(i.link) ? [i.id] : []), ...invalidItems(i.children ?? [], defaultLocale)]);
}
