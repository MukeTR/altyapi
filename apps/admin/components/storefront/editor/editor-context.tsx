"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/components/providers/store-provider";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ItemList } from "@/lib/api/types";
import type { Issue } from "@/lib/storefront/issues";
import type { CollectionSummary, NavigationMenu, SectionDefinition, StorefrontPage, ThemeSettings } from "@/lib/storefront/types";

/** Data and settings shared by every panel of the storefront editor. */
export interface EditorContextValue {
  definitions: readonly SectionDefinition[];
  /** Content language being edited (one of the store's languages). */
  editLocale: string;
  defaultLocale: string;
  locales: readonly string[];
  /** Theme settings of the draft (color scheme swatches, fonts). */
  themeSettings: ThemeSettings;
  menus: readonly NavigationMenu[];
  pages: readonly StorefrontPage[];
  /** Validation issues of the resource the form belongs to. */
  issues: readonly Issue[];
  /** False when the user may not change the resource being edited. */
  canEdit: boolean;
  /** Bumped when the draft is replaced (undo, restore, reload) so uncontrolled editors reload. */
  resetNonce: number;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ value, children }: { value: EditorContextValue; children: ReactNode }) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditorContext(): EditorContextValue {
  const v = useContext(EditorContext);
  if (!v) throw new Error("useEditorContext must be used inside <EditorProvider>");
  return v;
}

/** Overrides a few fields for a subtree (e.g. the theme's issues and permission for global sections). */
export function EditorScope({ issues, canEdit, children }: { issues: readonly Issue[]; canEdit: boolean; children: ReactNode }) {
  const parent = useEditorContext();
  return <EditorContext.Provider value={{ ...parent, issues, canEdit }}>{children}</EditorContext.Provider>;
}

export type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiErrorInfo } | { status: "forbidden" };

let collectionsCache: { apiBase: string; data: CollectionSummary[] } | null = null;

/** The store's collections for pickers (loaded once per editor session; needs catalog:read). */
export function useCollections(): { state: Loadable<CollectionSummary[]>; reload: () => void } {
  const { apiBase, can } = useStore();
  const allowed = can("catalog:read");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Loadable<CollectionSummary[]>>(() =>
    !allowed ? { status: "forbidden" } : collectionsCache?.apiBase === apiBase ? { status: "ready", data: collectionsCache.data } : { status: "loading" },
  );
  useEffect(() => {
    if (!allowed) return;
    if (nonce === 0 && collectionsCache?.apiBase === apiBase) return;
    let alive = true;
    setState({ status: "loading" });
    bff<ItemList<CollectionSummary>>(`${apiBase}/collections`).then(
      (res) => {
        collectionsCache = { apiBase, data: res.items };
        if (alive) setState({ status: "ready", data: res.items });
      },
      (err) => alive && setState({ status: "error", error: err instanceof ApiError ? err.toInfo() : { status: 0, code: "network", messageKey: "errors.network", correlationId: null } }),
    );
    return () => {
      alive = false;
    };
  }, [apiBase, allowed, nonce]);
  return { state, reload: () => setNonce((n) => n + 1) };
}
