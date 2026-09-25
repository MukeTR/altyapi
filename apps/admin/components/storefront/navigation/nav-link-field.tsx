"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError, bff } from "@/lib/api/client";
import type { CursorPage } from "@/lib/api/types";
import { linkComplete } from "@/lib/storefront/navigation";
import type { CollectionSummary, NavLink, ProductSummary, StorefrontPage } from "@/lib/storefront/types";
import { labelText } from "@/lib/content/fields";
import type { ContentTypeSummary } from "@/lib/content/types";
import { RecordPicker, loadContentTypes, useRecordLabels } from "@/components/content/record-pickers";
import { pageTitleOf } from "../publish-dialogs";

const TYPES: NavLink["type"][] = ["page", "entry", "entry_index", "collection", "product", "url", "home", "search", "cart"];

/** Content types of the store for entry index links (null while loading). */
function useContentTypes(enabled: boolean): { types: ContentTypeSummary[] | null; error: boolean } {
  const { apiBase } = useStore();
  const [state, setState] = useState<{ types: ContentTypeSummary[] | null; error: boolean }>({ types: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    loadContentTypes(apiBase).then(
      (types) => setState({ types, error: false }),
      () => setState({ types: [], error: true }),
    );
  }, [apiBase, enabled]);
  return state;
}

function emptyLink(type: NavLink["type"]): NavLink {
  switch (type) {
    case "url":
      return { type, url: "" };
    case "page":
      return { type, pageId: "" };
    case "collection":
      return { type, collectionId: "" };
    case "product":
      return { type, productId: "" };
    case "entry":
      return { type, entryId: "" };
    case "entry_index":
      return { type, typeId: "" };
    default:
      return { type };
  }
}

const productTitles = new Map<string, string>();

/** Where a menu item leads: a page, collection or product of the store, an address, or a system page. */
export function NavLinkField({
  value,
  onChange,
  pages,
  collections,
  collectionsError,
  showErrors,
}: {
  value: NavLink;
  onChange: (link: NavLink) => void;
  pages: readonly StorefrontPage[];
  collections: readonly CollectionSummary[] | null;
  collectionsError: string | null;
  showErrors: boolean;
}) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, can, store } = useStore();
  const contentOn = (!store.modules || store.modules.includes("content")) && can("content:read");
  const content = useContentTypes(contentOn && value.type === "entry_index");
  const catalogOn = !store.modules || store.modules.includes("catalog");
  const commerceOn = !store.modules || store.modules.includes("commerce");
  const types = TYPES.filter(
    (ty) =>
      ty === value.type ||
      ((contentOn || (ty !== "entry" && ty !== "entry_index")) && (catalogOn || (ty !== "collection" && ty !== "product")) && (commerceOn || ty !== "cart")),
  );
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomplete = showErrors && !linkComplete(value);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      const c = new AbortController();
      abort.current = c;
      setLoading(true);
      setError(null);
      try {
        const res = await bff<CursorPage<ProductSummary>>(`${apiBase}/products`, { query: { q: q.trim() || undefined, limit: 30 }, signal: c.signal });
        for (const p of res.items) productTitles.set(p.id, p.title);
        setProducts(res.items);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof ApiError ? describeError(err.toInfo()).message : t("states.networkBody"));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, 200);
  };

  const productId = value.type === "product" ? value.productId : "";
  useEffect(() => {
    if (value.type !== "product" || !can("catalog:read")) return;
    search("");
    if (productId && !productTitles.has(productId)) {
      bff<{ translations: Record<string, { title?: string }> }>(`${apiBase}/products/${productId}`).then(
        (p) => {
          productTitles.set(productId, Object.values(p.translations).find((x) => x.title)?.title ?? productId);
          setTick((n) => n + 1);
        },
        () => undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.type, productId]);

  const pageOptions = useMemo(
    () => pages.filter((p) => p.type === "page" || p.type === "landing").map((p) => ({ value: p.id, label: pageTitleOf(p, locale, store.defaultLocale), description: p.draftPath ?? undefined }) as ComboboxOption),
    [pages, locale, store.defaultLocale],
  );
  const collectionOptions: ComboboxOption[] = (collections ?? []).map((c) => ({ value: c.id, label: c.title, description: `/collections/${c.handle}` }));
  const productOptions: ComboboxOption[] = [
    ...(productId && !products.some((p) => p.id === productId) ? [{ value: productId, label: productTitles.get(productId) ?? t("common.loading") }] : []),
    ...products.map((p) => ({ value: p.id, label: p.title, description: `/products/${p.handle}` })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("storefront.menus.linkType")}>
        <Select value={value.type} onValueChange={(v) => onChange(emptyLink(v as NavLink["type"]))} options={types.map((ty) => ({ value: ty, label: t(`storefront.menus.linkTypes.${ty}`) }))} />
      </Field>
      {value.type === "url" ? (
        <Field label={t("storefront.menus.url")} description={t("storefront.menus.urlHint")} required error={incomplete ? t("storefront.menus.urlInvalid") : null}>
          <Input value={value.url} className="font-mono" placeholder="/collections/yeni-sezon" maxLength={2000} inputMode="url" onChange={(e) => onChange({ type: "url", url: e.target.value.trim() })} />
        </Field>
      ) : value.type === "page" ? (
        <Field label={t("storefront.menus.page")} required error={incomplete ? t("storefront.menus.choosePage") : null}>
          <Combobox options={pageOptions} value={value.pageId || null} onChange={(v) => onChange({ type: "page", pageId: v ?? "" })} placeholder={t("storefront.menus.choosePage")} emptyText={t("storefront.menus.noPages")} />
        </Field>
      ) : value.type === "entry" ? (
        <Field label={t("storefront.menus.entry")} description={t("storefront.menus.entryHint")} required error={incomplete ? t("storefront.menus.chooseEntry") : null}>
          <RecordPicker to="entry" value={value.entryId || null} onChange={(v) => onChange({ type: "entry", entryId: v ?? "" })} placeholder={t("storefront.menus.chooseEntry")} />
        </Field>
      ) : value.type === "entry_index" ? (
        <Field label={t("storefront.menus.entryIndex")} description={t("storefront.menus.entryIndexHint")} required error={incomplete ? t("storefront.menus.chooseEntryIndex") : content.error ? t("states.networkBody") : null}>
          <Select
            value={value.typeId || undefined}
            placeholder={content.types === null ? t("common.loading") : t("storefront.menus.chooseEntryIndex")}
            disabled={content.types === null}
            onValueChange={(v) => onChange({ type: "entry_index", typeId: v })}
            options={(content.types ?? [])
              .filter((ty) => ty.status === "active" && ty.routable && ty.kind === "collection")
              .map((ty) => ({ value: ty.id, label: `${labelText(ty.labels.namePlural, locale, ty.key)} · /${ty.routePrefix[store.defaultLocale] ?? Object.values(ty.routePrefix)[0] ?? ""}` }))}
          />
        </Field>
      ) : value.type === "collection" ? (
        <Field label={t("storefront.menus.collection")} required error={incomplete ? t("storefront.menus.chooseCollection") : null} description={!can("catalog:read") ? t("editor.fields.noCatalogPermission") : null}>
          <Combobox
            options={collectionOptions}
            value={value.collectionId || null}
            onChange={(v) => onChange({ type: "collection", collectionId: v ?? "" })}
            loading={collections === null && !collectionsError && can("catalog:read")}
            error={collectionsError}
            disabled={!can("catalog:read")}
            placeholder={t("storefront.menus.chooseCollection")}
            emptyText={t("editor.fields.noCollections")}
          />
        </Field>
      ) : value.type === "product" ? (
        <Field label={t("storefront.menus.product")} required error={incomplete ? t("storefront.menus.chooseProduct") : null} description={!can("catalog:read") ? t("editor.fields.noCatalogPermission") : null}>
          <Combobox
            options={productOptions}
            value={value.productId || null}
            onChange={(v) => onChange({ type: "product", productId: v ?? "" })}
            onSearch={search}
            loading={loading}
            error={error}
            onRetry={() => search("")}
            disabled={!can("catalog:read")}
            placeholder={t("storefront.menus.chooseProduct")}
            searchPlaceholder={t("editor.fields.searchProducts")}
          />
        </Field>
      ) : (
        <p className="text-sm text-fg-muted">{t(`storefront.menus.systemLinkHint.${value.type}`)}</p>
      )}
    </div>
  );
}

/** One-line description of a link for the tree ("Sayfa: Hakkımızda", "/collections/yaz"). */
export function useLinkSummary(pages: readonly StorefrontPage[], collections: readonly CollectionSummary[] | null, entryIds: readonly string[] = []) {
  const { t, locale } = useI18n();
  const { store, apiBase, can } = useStore();
  const entries = useRecordLabels("entry", entryIds);
  const [types, setTypes] = useState<ContentTypeSummary[]>([]);
  useEffect(() => {
    if (!can("content:read") || (store.modules && !store.modules.includes("content"))) return;
    loadContentTypes(apiBase).then(setTypes, () => setTypes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);
  return (link: NavLink): string => {
    switch (link.type) {
      case "url":
        return link.url || t("storefront.menus.noTarget");
      case "page": {
        const p = pages.find((x) => x.id === link.pageId);
        return p ? `${t("storefront.menus.linkTypes.page")}: ${pageTitleOf(p, locale, store.defaultLocale)}` : link.pageId ? t("storefront.menus.missingPage") : t("storefront.menus.noTarget");
      }
      case "collection": {
        const c = collections?.find((x) => x.id === link.collectionId);
        return c ? `${t("storefront.menus.linkTypes.collection")}: ${c.title}` : link.collectionId ? t("storefront.menus.linkTypes.collection") : t("storefront.menus.noTarget");
      }
      case "product":
        return link.productId ? `${t("storefront.menus.linkTypes.product")}: ${productTitles.get(link.productId) ?? "…"}` : t("storefront.menus.noTarget");
      case "entry":
        return link.entryId ? `${t("storefront.menus.linkTypes.entry")}: ${entries(link.entryId)?.label ?? "…"}` : t("storefront.menus.noTarget");
      case "entry_index": {
        const ty = types.find((x) => x.id === link.typeId);
        return ty ? `${t("storefront.menus.linkTypes.entry_index")}: ${labelText(ty.labels.namePlural, locale, ty.key)}` : link.typeId ? t("storefront.menus.linkTypes.entry_index") : t("storefront.menus.noTarget");
      }
      default:
        return t(`storefront.menus.linkTypes.${link.type}`);
    }
  };
}
