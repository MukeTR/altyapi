"use client";

import { RadioGroup as RRadio } from "radix-ui";
import { Link2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { isAllowedHref } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { ApiError, bff } from "@/lib/api/client";
import type { CursorPage } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import type { ProductSummary, SchemeName } from "@/lib/storefront/types";
import { useCollections, useEditorContext } from "./editor-context";
import { LocalizedTextField } from "./localized-fields";

const pageTitle = (title: Record<string, string>, locale: string, fallback: string) => title[locale] || title[fallback] || Object.values(title).find(Boolean) || "";

/** Color scheme of a section, shown with the theme's own colors. */
export function ColorSchemeField({ label, value, options, onChange, error }: { label: string; value: unknown; options: readonly string[]; onChange: (v: string) => void; error?: string | undefined }) {
  const { t } = useI18n();
  const { themeSettings, canEdit } = useEditorContext();
  const labelId = useId();
  const current = typeof value === "string" ? value : "default";
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-base font-medium text-fg">
        {label}
      </span>
      <RRadio.Root aria-labelledby={labelId} value={current} onValueChange={onChange} disabled={!canEdit} className="grid grid-cols-2 gap-2">
        {options.map((name) => {
          const scheme = themeSettings.colors.schemes[name as SchemeName];
          return (
            <RRadio.Item
              key={name}
              value={name}
              className={cn(
                "flex items-center gap-2 rounded-md border p-1.5 text-start text-sm text-fg transition-colors hover:bg-surface-muted disabled:opacity-55",
                "data-[state=checked]:border-accent data-[state=checked]:ring-1 data-[state=checked]:ring-accent",
                current === name ? "border-accent" : "border-border",
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-10 shrink-0 items-center justify-center gap-1 rounded-sm border border-border text-xs font-semibold"
                style={scheme ? { background: scheme.background, color: scheme.foreground } : undefined}
              >
                Aa
                {scheme ? <span className="size-2 rounded-full" style={{ background: scheme.primary }} /> : null}
              </span>
              <span className="truncate">{t.maybe(`editor.schemes.${name}`) ?? name}</span>
            </RRadio.Item>
          );
        })}
      </RRadio.Root>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

/** Store-internal destinations offered next to link inputs. */
function useLinkSuggestions(): { label: string; href: string; group: string }[] {
  const { t } = useI18n();
  const { pages, editLocale, defaultLocale } = useEditorContext();
  const { state } = useCollections();
  return useMemo(() => {
    const out = [
      { label: t("editor.links.home"), href: "/", group: t("editor.links.groupStore") },
      { label: t("editor.links.allProducts"), href: "/collections/all", group: t("editor.links.groupStore") },
      { label: t("editor.links.search"), href: "/search", group: t("editor.links.groupStore") },
      { label: t("editor.links.cart"), href: "/cart", group: t("editor.links.groupStore") },
    ];
    for (const p of pages) {
      if ((p.type === "page" || p.type === "landing") && p.path) out.push({ label: pageTitle(p.title, editLocale, defaultLocale) || p.handle, href: p.path, group: t("editor.links.groupPages") });
    }
    if (state.status === "ready") {
      for (const c of state.data) out.push({ label: c.title, href: `/collections/${c.handle}`, group: t("editor.links.groupCollections") });
    }
    return out;
  }, [pages, state, t, editLocale, defaultLocale]);
}

/** A link target: a store path or an absolute URL, with a picker for store pages and collections. */
export function HrefField({ label, value, onChange, nullable, error, description }: { label: string; value: unknown; onChange: (v: string | null) => void; nullable: boolean; error?: string | undefined; description?: string | null }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const suggestions = useLinkSuggestions();
  const text = typeof value === "string" ? value : "";
  const invalid = text !== "" && !isAllowedHref(text);
  const [query, setQuery] = useState("");
  const shown = suggestions.filter((s) => !query || `${s.label} ${s.href}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 30);
  return (
    <Field label={label} description={description ?? t("editor.links.hint")} error={error ?? (invalid ? t("richText.linkInvalid") : null)} optional={nullable}>
      <div className="flex gap-1.5">
        <Input
          value={text}
          disabled={!canEdit}
          inputMode="url"
          placeholder="/collections/yeni-sezon"
          onChange={(e) => onChange(e.target.value === "" && nullable ? null : e.target.value)}
          className="min-w-0 flex-1"
        />
        <Popover
          aria-label={t("editor.links.pick")}
          align="end"
          className="w-80 p-2"
          trigger={
            <Button size="icon-md" aria-label={t("editor.links.pick")} disabled={!canEdit}>
              <Link2 aria-hidden="true" />
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.links.searchPlaceholder")} aria-label={t("editor.links.searchPlaceholder")} size="sm" />
            <ul className="max-h-72 overflow-y-auto">
              {shown.length === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">{t("common.noResults")}</li> : null}
              {shown.map((s) => (
                <li key={`${s.group}-${s.href}`}>
                  <PopoverClose asChild>
                    <button
                      type="button"
                      onClick={() => onChange(s.href)}
                      className="flex w-full flex-col rounded-md px-2 py-1.5 text-start hover:bg-surface-muted focus-visible:bg-surface-muted"
                    >
                      <span className="text-base text-fg">{s.label}</span>
                      <span className="font-mono text-xs text-fg-subtle">
                        {s.group} · {s.href}
                      </span>
                    </button>
                  </PopoverClose>
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      </div>
    </Field>
  );
}

interface LinkValue {
  label: Record<string, string>;
  href: string;
  openInNewTab?: boolean;
}

/** Call-to-action button or link: localized label, target and new-tab option; optional as a whole. */
export function LinkField({ label, value, onChange, nullable, labelMaxLength, error }: { label: string; value: unknown; onChange: (v: LinkValue | null, immediate?: boolean) => void; nullable: boolean; labelMaxLength: number; error?: string | undefined }) {
  const { t } = useI18n();
  const { canEdit } = useEditorContext();
  const link = value && typeof value === "object" ? (value as LinkValue) : null;
  const legendId = useId();
  if (!link) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-medium text-fg">{label}</span>
        <Button size="sm" className="self-start" disabled={!canEdit} onClick={() => onChange({ label: {}, href: "/", openInNewTab: false }, true)}>
          <Plus aria-hidden="true" />
          {t("editor.links.add")}
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    );
  }
  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span id={legendId} className="text-base font-medium text-fg">
          {label}
        </span>
        {nullable ? (
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => onChange(null, true)}>
            <X aria-hidden="true" />
            {t("common.remove")}
          </Button>
        ) : null}
      </div>
      <LocalizedTextField label={t("editor.links.label")} value={link.label} maxLength={labelMaxLength} multiline={false} onChange={(m) => onChange({ ...link, label: m as Record<string, string> })} />
      <HrefField label={t("editor.links.target")} value={link.href} nullable={false} onChange={(href) => onChange({ ...link, href: href ?? "" })} error={error} />
      <Checkbox checked={Boolean(link.openInNewTab)} disabled={!canEdit} onCheckedChange={(c) => onChange({ ...link, openInNewTab: c }, true)} label={t("richText.linkNewTab")} />
    </fieldset>
  );
}

/** One collection of the store. */
export function CollectionField({ label, value, onChange, nullable, error, description }: { label: string; value: unknown; onChange: (v: string | null) => void; nullable: boolean; error?: string | undefined; description?: string | null }) {
  const { t, describeError } = useI18n();
  const { canEdit } = useEditorContext();
  const { state, reload } = useCollections();
  const id = typeof value === "string" ? value : null;
  const options: ComboboxOption[] =
    state.status === "ready" ? state.data.map((c) => ({ value: c.id, label: c.title, description: c.isPublished ? `/collections/${c.handle}` : t("editor.fields.unpublishedCollection") })) : [];
  if (id && !options.some((o) => o.value === id)) options.push({ value: id, label: t("editor.fields.unknownCollection") });
  return (
    <Field label={label} error={error} optional={nullable} description={state.status === "forbidden" ? t("editor.fields.noCatalogPermission") : (description ?? null)}>
      <Combobox
        options={options}
        value={id}
        onChange={(v) => onChange(v ?? (nullable ? null : id))}
        disabled={!canEdit || state.status === "forbidden"}
        loading={state.status === "loading"}
        error={state.status === "error" ? describeError(state.error).message : null}
        onRetry={reload}
        placeholder={t("editor.fields.chooseCollection")}
        emptyText={t("editor.fields.noCollections")}
      />
    </Field>
  );
}

const productLabels = new Map<string, string>();

/** Hand-picked products (product showcase with the "manual" source). */
export function ProductsField({ label, value, onChange, maxItems, error }: { label: string; value: unknown; onChange: (v: string[]) => void; maxItems: number | null; error?: string | undefined }) {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const { canEdit } = useEditorContext();
  const ids = useMemo(() => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []), [value]);
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, forceLabels] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowed = can("catalog:read");

  const search = useCallback(
    (q: string) => {
      if (!allowed) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setLoading(true);
        setErr(null);
        try {
          const res = await bff<CursorPage<ProductSummary>>(`${apiBase}/products`, { query: { q: q.trim() || undefined, limit: 30 }, signal: controller.signal });
          for (const p of res.items) productLabels.set(p.id, p.title);
          setResults(res.items);
        } catch (e) {
          if ((e as { name?: string }).name === "AbortError") return;
          setErr(e instanceof ApiError ? describeError(e.toInfo()).message : t("states.networkBody"));
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      }, 200);
    },
    [allowed, apiBase, describeError, t],
  );

  useEffect(() => {
    search("");
  }, [search]);

  // Titles of chosen products that are not among the results (loaded one by one, then cached).
  useEffect(() => {
    const missing = ids.filter((id) => !productLabels.has(id));
    if (!missing.length || !allowed) return;
    let alive = true;
    void Promise.all(
      missing.map((id) =>
        bff<{ translations: Record<string, { title?: string }> }>(`${apiBase}/products/${id}`).then(
          (p) => productLabels.set(id, Object.values(p.translations).find((tr) => tr.title)?.title ?? id),
          () => productLabels.set(id, t("editor.fields.unknownProduct")),
        ),
      ),
    ).then(() => alive && forceLabels((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [ids, allowed, apiBase, t]);

  const options: ComboboxOption[] = [
    ...ids.map((id) => ({ value: id, label: productLabels.get(id) ?? t("common.loading") })),
    ...results.filter((p) => !ids.includes(p.id)).map((p) => ({ value: p.id, label: p.title, description: p.status === "active" ? undefined : t.maybe(`statuses.product.${p.status}`) ?? p.status }) as ComboboxOption),
  ];
  const atMax = maxItems !== null && ids.length >= maxItems;
  return (
    <Field
      label={label}
      error={error}
      description={!allowed ? t("editor.fields.noCatalogPermission") : maxItems !== null ? t("editor.fields.maxItems", { count: ids.length, max: maxItems }) : null}
    >
      <Combobox
        multiple
        options={options.map((o) => (atMax && !ids.includes(o.value) ? { ...o, disabled: true } : o))}
        value={ids}
        onChange={onChange}
        onSearch={search}
        loading={loading}
        error={err}
        onRetry={() => search("")}
        disabled={!canEdit || !allowed}
        placeholder={t("editor.fields.chooseProducts")}
        searchPlaceholder={t("editor.fields.searchProducts")}
      />
    </Field>
  );
}

/** A navigation menu by handle (header). */
export function MenuField({ label, value, onChange, error }: { label: string; value: unknown; onChange: (v: string) => void; error?: string | undefined }) {
  const { t } = useI18n();
  const { menus, canEdit } = useEditorContext();
  const current = typeof value === "string" ? value : "";
  const options = menus.map((m) => ({ value: m.handle, label: `${m.name} (${m.handle})` }));
  if (current && !menus.some((m) => m.handle === current)) options.push({ value: current, label: t("editor.fields.missingMenu", { handle: current }) });
  return (
    <Field label={label} error={error} description={t("editor.fields.menuHint")}>
      <Select options={options} value={current || undefined} onValueChange={onChange} disabled={!canEdit} placeholder={t("editor.fields.chooseMenu")} />
    </Field>
  );
}

/** Several menus by handle (footer columns). */
export function MenusField({ label, value, onChange, maxItems, error }: { label: string; value: unknown; onChange: (v: string[]) => void; maxItems: number | null; error?: string | undefined }) {
  const { t } = useI18n();
  const { menus, canEdit } = useEditorContext();
  const handles = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const options: ComboboxOption[] = menus.map((m) => ({ value: m.handle, label: m.name, description: m.handle }));
  for (const h of handles) if (!menus.some((m) => m.handle === h)) options.push({ value: h, label: t("editor.fields.missingMenu", { handle: h }) });
  const atMax = maxItems !== null && handles.length >= maxItems;
  return (
    <Field label={label} error={error} description={maxItems !== null ? t("editor.fields.maxItems", { count: handles.length, max: maxItems }) : t("editor.fields.menuHint")}>
      <Combobox
        multiple
        options={options.map((o) => (atMax && !handles.includes(o.value) ? { ...o, disabled: true } : o))}
        value={handles}
        onChange={onChange}
        disabled={!canEdit}
        placeholder={t("editor.fields.chooseMenus")}
      />
    </Field>
  );
}
