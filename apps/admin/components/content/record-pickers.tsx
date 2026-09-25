"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ApiError, bff } from "@/lib/api/client";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { labelText } from "@/lib/content/fields";
import type { ContentTypeSummary, EntryDetail, EntryListItem, ReferenceTargetKind } from "@/lib/content/types";
import type { SiteLocation } from "@/lib/site/types";
import type { CollectionSummary, ProductSummary, StorefrontPage } from "@/lib/storefront/types";

/**
 * Pickers for records content can point at: entries (optionally limited to content type keys),
 * pages, products, collections and locations of the store. Titles of chosen records are cached
 * per page load so a reference field shows names, not ids.
 */

interface Known {
  label: string;
  description?: string;
}

const known = new Map<string, Known>();
const pending = new Map<string, Promise<void>>();

function remember(id: string, info: Known) {
  known.set(id, info);
}

/** Content types of the store (cached per page load; the type list rarely changes while editing). */
let typesCache: { base: string; promise: Promise<ContentTypeSummary[]> } | null = null;
export function loadContentTypes(apiBase: string): Promise<ContentTypeSummary[]> {
  if (!typesCache || typesCache.base !== apiBase) {
    const promise = bff<ItemList<ContentTypeSummary>>(`${apiBase}/content/types`).then((r) => r.items);
    typesCache = { base: apiBase, promise };
    promise.catch(() => {
      if (typesCache?.promise === promise) typesCache = null;
    });
  }
  return typesCache.promise;
}

/** Forgets cached types after a type changed (install, archive, labels). */
export function invalidateContentTypes() {
  typesCache = null;
}

async function describeEntry(apiBase: string, id: string, uiLocale: string): Promise<void> {
  const [detail, types] = await Promise.all([bff<EntryDetail>(`${apiBase}/content/entries/${id}`), loadContentTypes(apiBase).catch(() => [] as ContentTypeSummary[])]);
  const type = types.find((t) => t.id === detail.type.id);
  remember(id, { label: detail.title || id, description: type ? labelText(type.labels.name, uiLocale) : detail.type.key });
}

async function describeProduct(apiBase: string, id: string): Promise<void> {
  const p = await bff<{ handle?: string; translations: Record<string, { title?: string }> }>(`${apiBase}/products/${id}`);
  remember(id, { label: Object.values(p.translations).find((x) => x.title)?.title ?? id, ...(p.handle ? { description: `/products/${p.handle}` } : {}) });
}

/** Makes sure the titles of `ids` are known; re-renders the caller when they arrive. */
export function useRecordLabels(kind: ReferenceTargetKind, ids: readonly string[]) {
  const { apiBase } = useStore();
  const { locale } = useI18n();
  const [, setTick] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    if (kind !== "entry" && kind !== "product") return;
    let cancelled = false;
    for (const id of ids) {
      if (!id || known.has(id)) continue;
      let job = pending.get(id);
      if (!job) {
        job = (kind === "entry" ? describeEntry(apiBase, id, locale) : describeProduct(apiBase, id)).catch(() => remember(id, { label: id }));
        pending.set(id, job);
      }
      void job.then(() => {
        pending.delete(id);
        if (!cancelled) setTick((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, apiBase, locale]);
  return (id: string): Known | undefined => known.get(id);
}

type SearchState = { options: ComboboxOption[]; loading: boolean; error: string | null };

/** Searches one kind of record; entries are searched in each allowed type. */
function useRecordSearch(kind: ReferenceTargetKind, typeKeys: readonly string[] | undefined, enabled: boolean) {
  const { apiBase } = useStore();
  const { t, locale, describeError } = useI18n();
  const [state, setState] = useState<SearchState>({ options: [], loading: false, error: null });
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeKey = (typeKeys ?? []).join(",");

  const run = useCallback(
    async (q: string) => {
      abort.current?.abort();
      const c = new AbortController();
      abort.current = c;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        let options: ComboboxOption[] = [];
        if (kind === "entry") {
          const types = (await loadContentTypes(apiBase)).filter((ty) => ty.status === "active" && (!typeKey || typeKey.split(",").includes(ty.key)));
          const pages = await Promise.all(
            types.map((ty) =>
              bff<CursorPage<EntryListItem>>(`${apiBase}/content/entries`, { query: { type: ty.key, q: q.trim() || undefined, limit: types.length > 1 ? 15 : 40 }, signal: c.signal }).then((page) =>
                page.items.map((e) => {
                  const info = { label: e.title || t("content.entries.untitled"), description: labelText(ty.labels.name, locale) };
                  remember(e.id, info);
                  return { value: e.id, ...info };
                }),
              ),
            ),
          );
          options = pages.flat();
        } else if (kind === "product") {
          const res = await bff<CursorPage<ProductSummary>>(`${apiBase}/products`, { query: { q: q.trim() || undefined, limit: 30 }, signal: c.signal });
          options = res.items.map((p) => {
            const info = { label: p.title, description: `/products/${p.handle}` };
            remember(p.id, info);
            return { value: p.id, ...info };
          });
        } else if (kind === "page") {
          const res = await bff<ItemList<StorefrontPage>>(`${apiBase}/storefront/pages`, { signal: c.signal });
          options = res.items
            .filter((p) => p.type === "page" || p.type === "landing")
            .map((p) => {
              const info = { label: p.title[locale] || Object.values(p.title).find(Boolean) || p.handle, ...(p.draftPath ? { description: p.draftPath } : {}) };
              remember(p.id, info);
              return { value: p.id, ...info };
            });
        } else if (kind === "collection") {
          const res = await bff<ItemList<CollectionSummary>>(`${apiBase}/collections`, { signal: c.signal });
          options = res.items.map((col) => {
            const info = { label: col.title || col.handle, description: `/collections/${col.handle}` };
            remember(col.id, info);
            return { value: col.id, ...info };
          });
        } else {
          const res = await bff<ItemList<SiteLocation>>(`${apiBase}/site/locations`, { signal: c.signal });
          options = res.items.map((l) => {
            const info = { label: labelText(l.name, locale, l.slug), ...(l.address ? { description: [l.address.ilce, l.address.il].filter(Boolean).join(", ") } : {}) };
            remember(l.id, info);
            return { value: l.id, ...info };
          });
        }
        if (!c.signal.aborted) setState({ options, loading: false, error: null });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({ options: [], loading: false, error: err instanceof ApiError ? describeError(err.toInfo()).message : t("states.networkBody") });
      }
    },
    [apiBase, kind, typeKey, locale, t, describeError],
  );

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(q), 200);
    },
    [run],
  );

  useEffect(() => {
    if (enabled) void run("");
    return () => abort.current?.abort();
  }, [enabled, run]);

  return { ...state, search, retry: () => void run("") };
}

/** Permission needed to list records of a kind. */
export const READ_PERMISSION = {
  entry: "content:read",
  page: "storefront:read",
  product: "catalog:read",
  collection: "catalog:read",
  location: "site:read",
} as const satisfies Record<ReferenceTargetKind, string>;

/** Records of a kind exist only while their module is on (products and collections: catalog). */
function useKindAvailable(kind: ReferenceTargetKind): boolean {
  const { can, store } = useStore();
  const module = kind === "product" || kind === "collection" ? "catalog" : kind === "entry" ? "content" : null;
  return can(READ_PERMISSION[kind]) && (!module || !store.modules || store.modules.includes(module));
}

interface PickerBase {
  to: ReferenceTargetKind;
  /** Entry references: allowed content type keys. */
  typeKeys?: readonly string[] | undefined;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
}

/** Chooses one record (reference fields, embeds, link targets). */
export function RecordPicker({ value, onChange, ...p }: PickerBase & { value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  const allowed = useKindAvailable(p.to);
  const s = useRecordSearch(p.to, p.typeKeys, allowed && !p.disabled);
  const labels = useRecordLabels(p.to, value ? [value] : []);
  const options = useMemo(() => {
    const extra = value && !s.options.some((o) => o.value === value) ? [{ value, label: labels(value)?.label ?? t("common.loading"), ...(labels(value)?.description ? { description: labels(value)!.description } : {}) }] : [];
    return [...extra, ...s.options];
  }, [value, s.options, labels, t]);
  return (
    <Combobox
      {...(p.id ? { id: p.id } : {})}
      {...(p["aria-label"] ? { "aria-label": p["aria-label"] } : {})}
      options={options}
      value={value}
      onChange={onChange}
      onSearch={s.search}
      loading={s.loading}
      error={allowed ? s.error : t("content.pickers.noPermission")}
      onRetry={s.retry}
      disabled={p.disabled || !allowed}
      placeholder={p.placeholder ?? t(`content.pickers.choose.${p.to}`)}
      searchPlaceholder={t("content.pickers.search")}
      emptyText={t("content.pickers.empty")}
    />
  );
}

/** Chooses several records (multi-reference fields: categories, tags, FAQ, related entries). */
export function MultiRecordPicker({ value, onChange, maxItems, ...p }: PickerBase & { value: readonly string[]; onChange: (ids: string[]) => void; maxItems?: number | undefined }) {
  const { t } = useI18n();
  const allowed = useKindAvailable(p.to);
  const s = useRecordSearch(p.to, p.typeKeys, allowed && !p.disabled);
  const labels = useRecordLabels(p.to, value);
  const options = useMemo(() => {
    const missing = value.filter((v) => !s.options.some((o) => o.value === v)).map((v) => ({ value: v, label: labels(v)?.label ?? t("common.loading") }));
    const full = maxItems !== undefined && value.length >= maxItems;
    return [...missing, ...s.options.map((o) => (full && !value.includes(o.value) ? { ...o, disabled: true } : o))];
  }, [value, s.options, labels, t, maxItems]);
  return (
    <Combobox
      multiple
      {...(p.id ? { id: p.id } : {})}
      {...(p["aria-label"] ? { "aria-label": p["aria-label"] } : {})}
      options={options}
      value={value}
      onChange={onChange}
      onSearch={s.search}
      loading={s.loading}
      error={allowed ? s.error : t("content.pickers.noPermission")}
      onRetry={s.retry}
      disabled={p.disabled || !allowed}
      placeholder={p.placeholder ?? t(`content.pickers.chooseMany.${p.to}`)}
      searchPlaceholder={t("content.pickers.search")}
      emptyText={t("content.pickers.empty")}
    />
  );
}
