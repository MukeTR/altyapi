"use client";

import { useRouter } from "next/navigation";
import { FolderTree, Pencil, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LocalizedTextField } from "@/components/ui/localized-text-field";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { Category } from "@/lib/commerce/types";

interface TreeRow {
  category: Category;
  depth: number;
  path: string;
}

function flatten(categories: Category[], locale: string): TreeRow[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const known = new Set(categories.map((c) => c.id));
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      const name = c.name[locale] ?? Object.values(c.name)[0] ?? c.handle;
      const path = prefix ? `${prefix} › ${name}` : name;
      out.push({ category: c, depth, path });
      if (depth < 8) walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  // Rows whose parent is missing (should not happen) still show at the root.
  for (const c of categories) if (c.parentId && !known.has(c.parentId) && !out.some((r) => r.category.id === c.id)) out.push({ category: c, depth: 0, path: c.handle });
  return out;
}

/** Category tree; categories drive product organization, collection rules and Google Shopping mapping. */
export function CategoriesView({ result }: { result: ApiResult<ItemList<Category>> }) {
  const { t } = useI18n();
  const { store, can } = useStore();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const canWrite = can("catalog:write");
  const rows = useMemo(() => (result.ok ? flatten(result.data.items, store.defaultLocale) : []), [result, store.defaultLocale]);

  return (
    <section aria-label={t("categories.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <p className="text-sm text-fg-muted">{t("categories.description")}</p>
        {canWrite ? (
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("categories.add")}
          </Button>
        ) : null}
      </div>
      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FolderTree} title={t("categories.empty.title")} description={t("categories.empty.body")} />
      ) : (
        <ul aria-label={t("categories.title")} className="flex flex-col divide-y divide-border">
          {rows.map(({ category: c, depth }) => {
            const name = c.name[store.defaultLocale] ?? Object.values(c.name)[0] ?? c.handle;
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2" style={{ paddingInlineStart: `${12 + depth * 24}px` }}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base text-fg">
                    {depth > 0 ? <span aria-hidden="true" className="me-1 text-fg-subtle">└</span> : null}
                    {name}
                    {depth > 0 ? <span className="sr-only"> ({t("categories.level", { n: depth + 1 })})</span> : null}
                  </span>
                  <span className="font-mono text-xs text-fg-subtle">{c.handle}</span>
                </span>
                {canWrite ? (
                  <Button size="icon-sm" variant="ghost" aria-label={t("categories.edit", { name })} onClick={() => setEditing(c)}>
                    <Pencil aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <CategoryDialog category={editing === "new" ? null : editing} rows={rows} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function CategoryDialog({ category, rows, onClose }: { category: Category | null; rows: TreeRow[]; onClose: () => void }) {
  const { t, describeError } = useI18n();
  const { store, apiBase } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState<Record<string, string>>(category?.name ?? {});
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [handle, setHandle] = useState(category?.handle ?? "");
  const [position, setPosition] = useState(String(category?.position ?? 0));
  const [googleId, setGoogleId] = useState(category?.googleCategoryId ? String(category.googleCategoryId) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const described = error ? describeError(error, { "errors.category.handle_taken": "handle", "errors.category.cycle": "parentId" }) : null;
  const fields = described?.fields ?? {};

  // A category can't move under itself or its own descendants.
  const excluded = useMemo(() => {
    if (!category) return new Set<string>();
    const out = new Set([category.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) if (r.category.parentId && out.has(r.category.parentId) && !out.has(r.category.id)) (out.add(r.category.id), (grew = true));
    }
    return out;
  }, [category, rows]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const cleanName = Object.fromEntries(Object.entries(name).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    try {
      await bff(category ? `${apiBase}/categories/${category.id}` : `${apiBase}/categories`, {
        method: category ? "PUT" : "POST",
        body: {
          parentId,
          name: cleanName,
          ...(handle.trim() ? { handle: handle.trim() } : {}),
          position: Number.parseInt(position, 10) || 0,
          googleCategoryId: googleId.trim() ? Number.parseInt(googleId, 10) : null,
        },
      });
      toast({ tone: "success", title: t("categories.saved") });
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={category ? t("categories.editTitle") : t("categories.add")}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="category-form" loading={pending} disabled={!name[store.defaultLocale]?.trim()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="flex flex-col gap-4">
        {described && Object.keys(fields).length === 0 ? (
          <FormAlert tone="danger" focusKey={error}>
            {described.message}
          </FormAlert>
        ) : null}
        <LocalizedTextField label={t("categories.fields.name")} locales={store.supportedLocales} defaultLocale={store.defaultLocale} value={name} onChange={setName} maxLength={120} required />
        <Field label={t("categories.fields.parent")} optional error={fields.parentId ?? null}>
          <Combobox
            value={parentId}
            onChange={setParentId}
            placeholder={t("categories.fields.root")}
            options={rows.filter((r) => !excluded.has(r.category.id)).map((r) => ({ value: r.category.id, label: r.path }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("categories.fields.handle")} optional description={t("categories.fields.handleHint")} error={fields.handle ?? null}>
            <Input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} maxLength={120} className="font-mono" />
          </Field>
          <Field label={t("categories.fields.position")} description={t("categories.fields.positionHint")}>
            <Input type="number" inputMode="numeric" min={0} value={position} onChange={(e) => setPosition(e.target.value)} className="w-28 tabular" />
          </Field>
        </div>
        <Field label={t("categories.fields.google")} optional description={t("categories.fields.googleHint")} error={fields.googleCategoryId ?? null}>
          <Input type="number" inputMode="numeric" min={1} value={googleId} onChange={(e) => setGoogleId(e.target.value)} className="w-40 tabular" />
        </Field>
      </form>
    </Dialog>
  );
}
