"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  Eye,
  History,
  Redo2,
  Send,
  Undo2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createPreviewLinkAction } from "@/app/actions/tenancy";
import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { useDraft, type DraftIssue } from "@/components/storefront/editor/use-draft";
import { HistoryDrawer } from "@/components/storefront/history-drawer";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConflictBanner } from "@/components/ui/conflict-banner";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { asRecord, entryPath, labelText, valueIn } from "@/lib/content/fields";
import { isRichDocEmpty } from "@/lib/content/rich-doc";
import type { ContentTypeDetail, EntryDetail, EntryHistoryMove, EntrySeo, PublishResult, TypeField } from "@/lib/content/types";
import { localeLabel } from "@/lib/locales";
import type { HistoryList } from "@/lib/storefront/types";
import { FieldInput, widthClass } from "./field-input";
import { RecordPicker, invalidateContentTypes } from "./record-pickers";

/**
 * Entry editor: the form generated from the type's fields (per-language values, GEO fieldset,
 * SEO panel, slugs), autosaved as draft revisions with optimistic concurrency (expectedRevision;
 * a 409 stops autosaving until the newer version is loaded or overwritten), server-side draft
 * history (undo, redo, restore), and the publishing actions: publish, schedule, unpublish,
 * archive, duplicate and preview on the storefront.
 */

interface EntryValue {
  id: string | null;
  revision: number;
  data: Record<string, unknown>;
  seo: EntrySeo;
  slugs: Record<string, string>;
  parentId: string | null;
}

function toValue(d: EntryDetail): EntryValue {
  return { id: d.entry.id, revision: d.entry.draftRevision, data: d.entry.draftData, seo: d.entry.draftSeo ?? {}, slugs: d.entry.draftSlugs ?? {}, parentId: d.entry.parentId };
}

/** JSON with object keys sorted (stored JSON comes back with keys in another order). */
function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** True when a field has a value (in `locale` for localized fields). */
function filled(field: TypeField, value: unknown, locale: string): boolean {
  const v = valueIn(field, value, locale);
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (field.type === "richDoc") return !isRichDocEmpty(v);
  if (field.type === "asset") return Boolean(asRecord(v).assetId);
  return true;
}

/** Slug errors name the language in their details; they belong on that language's slug input. */
const SLUG_KEYS = new Set(["errors.content_entry.slug_taken", "errors.content_entry.slug_reserved", "errors.content_entry.invalid_slug", "errors.content_entry.slug_required"]);

export function EntryEditor({ type, initial }: { type: ContentTypeDetail; initial: EntryDetail | null }) {
  const { t, locale: ui, describeError } = useI18n();
  const { apiBase, basePath, store, organization, can, storefrontUrl } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const locales = useMemo(() => [store.defaultLocale, ...store.supportedLocales.filter((l) => l !== store.defaultLocale)], [store.defaultLocale, store.supportedLocales]);
  const [editLocale, setEditLocale] = useState(store.defaultLocale);
  const [detail, setDetail] = useState<EntryDetail | null>(initial);
  const [resetKey, setResetKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<{ canUndo: boolean; canRedo: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiErrorInfo | null>(null);
  const [dependencies, setDependencies] = useState<PublishResult["unpublishedDependencies"]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [previewPending, startPreview] = useTransition();

  const archived = detail?.entry.status === "archived";
  const canWrite = can("content:write") && !archived;
  const canPublish = can("content:publish");
  const fields = useMemo(() => type.fields.filter((f) => !f.hidden), [type.fields]);
  const alwaysRequired = useMemo(() => fields.filter((f) => f.required === "always"), [fields]);
  const entryHref = (id: string) => `${basePath}/content/${encodeURIComponent(type.key)}/${id}`;

  const refreshHistory = useCallback(
    async (id: string | null) => {
      if (!id) return;
      try {
        const h = await bff<HistoryList>(`${apiBase}/content/entries/${id}/history`);
        setHistory({ canUndo: h.canUndo, canRedo: h.canRedo });
      } catch {
        setHistory(null);
      }
    },
    [apiBase],
  );

  const draft = useDraft<EntryValue>({
    initial: initial
      ? toValue(initial)
      : { id: null, revision: 0, data: {}, seo: {}, slugs: {}, parentId: null },
    enabled: canWrite,
    revision: (v) => v.revision,
    validate: (v) =>
      alwaysRequired.filter((f) => !(f.localized ? Object.keys(asRecord(v.data[f.key])).some((l) => filled(f, v.data[f.key], l)) : filled(f, v.data[f.key], store.defaultLocale))).map((f) => ({ path: `data.${f.key}${f.localized ? `.${store.defaultLocale}` : ""}`, message: "errors.content.field_required" })),
    save: async (local, server, expectedRevision) => {
      let saved: EntryDetail;
      if (!local.id) {
        const slugs = Object.fromEntries(Object.entries(local.slugs).filter(([, s]) => s));
        saved = await bff<EntryDetail>(`${apiBase}/content/entries`, {
          method: "POST",
          body: { type: type.key, data: local.data, ...(Object.keys(local.seo).length ? { seo: local.seo } : {}), ...(Object.keys(slugs).length ? { slugs } : {}), ...(local.parentId ? { parentId: local.parentId } : {}) },
        });
        // The editor stays mounted (no reload while typing); the address bar gets the entry URL.
        window.history.replaceState(null, "", entryHref(saved.entry.id));
      } else {
        const body: Record<string, unknown> = { expectedRevision };
        const keys = new Set([...Object.keys(local.data), ...Object.keys(server.data)]);
        const data: Record<string, unknown> = {};
        for (const k of keys) if (!same(local.data[k], server.data[k])) data[k] = local.data[k] ?? null;
        if (Object.keys(data).length) body.data = data;
        if (!same(local.seo, server.seo)) body.seo = local.seo;
        const slugKeys = new Set([...Object.keys(local.slugs), ...Object.keys(server.slugs)]);
        const slugs: Record<string, string | null> = {};
        for (const l of slugKeys) if ((local.slugs[l] ?? "") !== (server.slugs[l] ?? "")) slugs[l] = local.slugs[l] || null;
        if (Object.keys(slugs).length) body.slugs = slugs;
        if (local.parentId !== server.parentId) body.parentId = local.parentId;
        if (Object.keys(body).length === 1) return server;
        saved = await bff<EntryDetail>(`${apiBase}/content/entries/${local.id}`, { method: "PATCH", body });
      }
      setDetail(saved);
      setActionError(null);
      void refreshHistory(saved.entry.id);
      // What the merchant typed stays as typed (the API trims text); the new revision and the
      // slugs the API filled in from the title come from the response.
      return { ...toValue(saved), data: local.data, seo: local.seo };
    },
  });

  useEffect(() => {
    void refreshHistory(initial?.entry.id ?? null);
  }, [initial?.entry.id, refreshHistory]);

  const value = draft.value;
  const setData = (key: string, v: unknown) =>
    draft.update((cur) => {
      if (same(cur.data[key], v === null ? undefined : v)) return cur;
      const data = { ...cur.data };
      if (v === null || v === undefined) delete data[key];
      else data[key] = v;
      return { ...cur, data };
    });
  const setSeo = (patch: Partial<EntrySeo>) =>
    draft.update((cur) => {
      const seo: EntrySeo = { ...cur.seo, ...patch };
      for (const k of Object.keys(seo) as (keyof EntrySeo)[]) {
        const x = seo[k];
        if (x === undefined || x === null || (typeof x === "object" && !Object.keys(x).length)) delete seo[k];
      }
      return { ...cur, seo };
    });

  // Issues of the last save or action, translated, by path ("data.title.tr", "slugs.en").
  const issueMap = useMemo(() => {
    const list: DraftIssue[] = [...draft.issues];
    const err = actionError ?? draft.error;
    if (err) {
      const details = err.details as { issues?: DraftIssue[]; locale?: string } | undefined;
      if (Array.isArray(details?.issues) && !draft.issues.length) list.push(...details.issues);
      if (SLUG_KEYS.has(err.messageKey) && typeof details?.locale === "string") list.push({ path: `slugs.${details.locale}`, message: err.messageKey });
    }
    if (!list.length) return {} as Record<string, string>;
    const described = describeError({ status: 422, code: "validation_failed", messageKey: "errors.content.invalid", details: { issues: list }, correlationId: null });
    const out = { ...described.fields };
    if (err && SLUG_KEYS.has(err.messageKey)) {
      const loc = (err.details as { locale?: string } | undefined)?.locale;
      if (loc) out[`slugs.${loc}`] = describeError(err).message;
    }
    return out;
  }, [draft.issues, draft.error, actionError, describeError]);
  const issueAt = useCallback(
    (path: string) => issueMap[path] ?? Object.entries(issueMap).find(([p]) => p.startsWith(`${path}.`))?.[1],
    [issueMap],
  );
  const issueCount = Object.keys(issueMap).length;

  const fieldLabelOf = (path: string) => {
    const [head, key, loc] = path.split(".");
    if (head === "data") {
      const f = type.fields.find((x) => x.key === key);
      const name = f ? labelText(f.label, ui, key) : (key ?? path);
      return loc && loc.length === 2 ? `${name} (${loc.toUpperCase()})` : name;
    }
    if (head === "slugs") return `${t("content.editor.slug")} (${(key ?? "").toUpperCase()})`;
    if (head === "seo") return `${t("content.seo.title")}: ${key}`;
    return path;
  };
  const summaryItems = Object.entries(issueMap).map(([path, message]) => ({ fieldId: `issue-${path.split(".").slice(0, 2).join("-")}`, message, label: fieldLabelOf(path) }));

  /** Locales whose publish-required fields are all filled (per-language completeness). */
  const complete = useMemo(() => {
    const required = fields.filter((f) => f.required);
    return Object.fromEntries(locales.map((l) => [l, required.every((f) => filled(f, value.data[f.key], f.localized ? l : store.defaultLocale))]));
  }, [fields, locales, value.data, store.defaultLocale]);

  const titleField = type.fields.find((f) => f.key === type.titleField);
  const title = titleField ? String(valueIn(titleField, value.data[type.titleField], editLocale) || valueIn(titleField, value.data[type.titleField], store.defaultLocale) || "") : "";
  const displayTitle = title || detail?.title || t("content.entries.untitled");

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const reload = async (id: string) => {
    const fresh = await bff<EntryDetail>(`${apiBase}/content/entries/${id}`);
    setDetail(fresh);
    draft.replace(toValue(fresh));
    setResetKey((k) => k + 1);
    void refreshHistory(id);
    return fresh;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const info = err.toInfo();
      setActionError(info);
      if (info.status === 409 && info.messageKey === "errors.content.revision_conflict" && value.id) toastError(info);
      else if (!(info.details as { issues?: unknown } | undefined)?.issues && !SLUG_KEYS.has(info.messageKey)) toastError(info);
    } finally {
      setBusy(null);
    }
  };

  const move = (kind: "undo" | "redo") =>
    run(kind, async () => {
      if (!value.id) return;
      if (!(await draft.flush())) return;
      await bff<EntryHistoryMove>(`${apiBase}/content/entries/${value.id}/history/${kind}`, { method: "POST", body: { expectedRevision: draft.currentRevision() } });
      await reload(value.id);
      toast({ tone: "success", title: t(kind === "undo" ? "editor.history.undone" : "editor.history.redone") });
    });

  const publish = () =>
    run("publish", async () => {
      if (!value.id || !(await draft.flush())) return;
      const res = await bff<PublishResult>(`${apiBase}/content/entries/${value.id}/publish`, { method: "POST", body: { expectedRevision: draft.currentRevision() } });
      setDetail(res);
      setDependencies(res.unpublishedDependencies);
      toast({ tone: "success", title: t("content.editor.published", { locales: res.version.locales.map((l) => l.toUpperCase()).join(", ") }) });
    });

  const simple = (key: "unpublish" | "archive" | "unarchive", success: string) =>
    run(key, async () => {
      if (!value.id) return;
      if (key !== "unarchive" && !(await draft.flush())) return;
      const res = await bff<EntryDetail>(`${apiBase}/content/entries/${value.id}/${key}`, { method: "POST" });
      setDetail(res);
      if (key === "unarchive") draft.replace(toValue(res));
      toast({ tone: "success", title: success });
    });

  const duplicate = () =>
    run("duplicate", async () => {
      if (!value.id || !(await draft.flush())) return;
      const copy = await bff<EntryDetail>(`${apiBase}/content/entries/${value.id}/duplicate`, { method: "POST" });
      toast({ tone: "success", title: t("content.editor.duplicated") });
      router.push(entryHref(copy.entry.id));
    });

  const path = entryPath({ routePrefix: type.routePrefix, kind: type.kind }, editLocale, store.defaultLocale, value.slugs[editLocale]);
  const liveInLocale = Boolean(detail?.live?.locales.includes(editLocale));
  const liveSlug = detail?.live ? detail.entry.draftSlugs[editLocale] : null;
  const openPreview = () => {
    if (!path) return;
    const tab = window.open("about:blank", "_blank");
    startPreview(async () => {
      if (!(await draft.flush())) {
        tab?.close();
        return;
      }
      const result = await createPreviewLinkAction(organization.id, store.id, store.slug, path);
      if (!result.ok) {
        tab?.close();
        toastError(result.error);
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else toast({ tone: "info", title: t("shell.previewBlocked", { url: result.url }) });
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const sections = useMemo(() => {
    const map = new Map<string, TypeField[]>();
    for (const f of fields) {
      const s = f.ui?.section ?? "main";
      map.set(s, [...(map.get(s) ?? []), f]);
    }
    return map;
  }, [fields]);
  const fieldResetKey = `${resetKey}`;
  const renderFields = (list: TypeField[]) => (
    <div className="grid gap-5 sm:grid-cols-6">
      {list.map((f) => (
        <div key={f.key} id={`issue-data-${f.key}`} className={cn("min-w-0 scroll-mt-24", widthClass(f))}>
          <FieldInput field={f} value={value.data[f.key]} onChange={(v) => setData(f.key, v)} locale={editLocale} path={`data.${f.key}`} issueAt={issueAt} disabled={!canWrite} resetKey={fieldResetKey} />
          {f.visibility === "internal" ? <p className="mt-1 text-xs text-fg-subtle">{t("content.editor.internalField")}</p> : null}
        </div>
      ))}
    </div>
  );

  const typeName = labelText(type.labels.name, ui, type.key);
  const status = detail?.entry.status ?? "draft";
  const summaryField = type.fields.find((f) => f.key === "summary" && !f.hidden);
  const seoTitle = value.seo.title?.[editLocale] ?? "";
  const seoDescription = value.seo.description?.[editLocale] ?? "";
  const fallbackDescription = summaryField ? String(valueIn(summaryField, value.data.summary, editLocale) ?? "") : "";

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={displayTitle}
        breadcrumbs={[
          { label: t("content.title"), href: `${basePath}/content` },
          { label: labelText(type.labels.namePlural, ui, type.key), href: `${basePath}/content/${encodeURIComponent(type.key)}` },
        ]}
        status={
          <span className="flex items-center gap-2">
            <StatusPill domain="contentEntry" value={status} />
            {detail?.hasUnpublishedChanges && detail.live ? <Badge tone="warning">{t("content.entries.unpublishedChanges")}</Badge> : null}
          </span>
        }
        meta={<SaveLine status={draft.status} savedAt={draft.savedAt} issues={issueCount} created={Boolean(value.id)} onRetry={draft.retry} />}
        actions={
          <>
            {value.id ? (
              <>
                <Button size="icon-md" aria-label={t("content.editor.undo")} title={t("content.editor.undo")} disabled={!canWrite || !history?.canUndo || busy !== null} loading={busy === "undo"} onClick={() => void move("undo")}>
                  <Undo2 aria-hidden="true" />
                </Button>
                <Button size="icon-md" aria-label={t("content.editor.redo")} title={t("content.editor.redo")} disabled={!canWrite || !history?.canRedo || busy !== null} loading={busy === "redo"} onClick={() => void move("redo")}>
                  <Redo2 aria-hidden="true" />
                </Button>
                <Button onClick={() => setHistoryOpen(true)}>
                  <History aria-hidden="true" />
                  {t("content.editor.history")}
                </Button>
              </>
            ) : null}
            {value.id && path ? (
              <Button onClick={openPreview} loading={previewPending}>
                <Eye aria-hidden="true" />
                {t("content.editor.preview")}
              </Button>
            ) : null}
            {value.id && canPublish && !archived ? (
              <div className="flex">
                <Button variant="primary" className="rounded-e-none" loading={busy === "publish"} disabled={busy !== null || draft.status === "conflict" || Boolean(detail?.live && !detail.hasUnpublishedChanges && !draft.dirty)} onClick={() => void publish()}>
                  <Upload aria-hidden="true" />
                  {detail?.live ? (detail.hasUnpublishedChanges || draft.dirty ? t("content.editor.publishChanges") : t("content.editor.upToDate")) : t("content.editor.publish")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="primary" className="rounded-s-none border-s border-accent-fg/20 px-2" aria-label={t("content.editor.moreActions")} disabled={busy !== null}>
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setScheduleOpen(true)}>
                      <CalendarClock aria-hidden="true" />
                      {t("content.editor.schedule")}
                    </DropdownMenuItem>
                    {detail?.live ? (
                      <DropdownMenuItem onSelect={() => void simple("unpublish", t("content.editor.unpublished"))}>
                        <Send aria-hidden="true" className="rotate-180" />
                        {t("content.editor.unpublish")}
                      </DropdownMenuItem>
                    ) : null}
                    {canWrite && type.kind !== "singleton" ? (
                      <DropdownMenuItem onSelect={() => void duplicate()}>
                        <Copy aria-hidden="true" />
                        {t("content.editor.duplicate")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem tone="danger" onSelect={() => setArchiveOpen(true)} disabled={!can("content:write")}>
                      <Archive aria-hidden="true" />
                      {t("content.editor.archive")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : value.id && !archived && can("content:write") ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    {t("common.actions")}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {type.kind !== "singleton" ? (
                    <DropdownMenuItem onSelect={() => void duplicate()}>
                      <Copy aria-hidden="true" />
                      {t("content.editor.duplicate")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem tone="danger" disabled={Boolean(detail?.live)} onSelect={() => setArchiveOpen(true)}>
                    <Archive aria-hidden="true" />
                    {t("content.editor.archive")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {archived && can("content:write") ? (
              <Button variant="primary" loading={busy === "unarchive"} onClick={() => void simple("unarchive", t("content.editor.unarchived"))}>
                <ArchiveRestore aria-hidden="true" />
                {t("content.editor.unarchive")}
              </Button>
            ) : null}
          </>
        }
      />

      {draft.status === "conflict" ? (
        <ConflictBanner onReload={() => value.id && void reload(value.id)} onOverwrite={draft.overwrite} />
      ) : null}
      {!can("content:write") ? <InlineAlert tone="info">{t("content.editor.readOnly")}</InlineAlert> : null}
      {archived ? <InlineAlert tone="warning">{t("content.editor.archivedNotice")}</InlineAlert> : null}
      {!value.id ? <InlineAlert tone="info">{t("content.editor.newHint", { fields: alwaysRequired.map((f) => labelText(f.label, ui, f.key)).join(", ") })}</InlineAlert> : null}
      {detail?.schemaUpgradePending ? <InlineAlert tone="info">{t("content.editor.schemaUpgrade")}</InlineAlert> : null}
      {detail?.entry.status === "scheduled" || (detail?.entry.publishAt && detail.live) ? (
        <InlineAlert tone="info" title={t("content.editor.scheduledTitle")}>
          {t("content.editor.scheduledBody", { revision: detail.entry.scheduledRevision ?? detail.entry.draftRevision })} <DateTime value={detail.entry.publishAt} />
        </InlineAlert>
      ) : null}
      {dependencies.length ? (
        <InlineAlert tone="warning" title={t("content.editor.dependenciesTitle")}>
          <ul className="mt-1 flex flex-col gap-1">
            {dependencies.map((d) => (
              <li key={d.id}>
                <Link href={`${basePath}/content/${encodeURIComponent(d.typeKey)}/${d.id}`} className="text-link underline">
                  {d.typeKey} · <DependencyTitle id={d.id} />
                </Link>{" "}
                <StatusPill domain="contentEntry" value={d.status} />
              </li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}
      {issueCount ? <ErrorSummary message={t("content.editor.issuesTitle", { count: issueCount })} items={summaryItems} /> : actionError && !value.id ? <InlineAlert tone="danger">{describeError(actionError).message}</InlineAlert> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card
            title={typeName}
            padding="form"
            actions={
              locales.length > 1 ? (
                <SegmentedControl
                  aria-label={t("content.editor.language")}
                  size="sm"
                  value={editLocale}
                  onValueChange={setEditLocale}
                  options={locales.map((l) => ({
                    value: l,
                    label: (
                      <span className="inline-flex items-center gap-1 uppercase">
                        {l}
                        {complete[l] ? <Check aria-hidden="true" className="size-3 text-success" /> : <CircleAlert aria-hidden="true" className="size-3 text-warning" />}
                      </span>
                    ),
                    "aria-label": `${localeLabel(l, ui)} · ${complete[l] ? t("content.editor.localeComplete") : t("content.editor.localeIncomplete")}`,
                  }))}
                />
              ) : null
            }
          >
            {renderFields(sections.get("main") ?? [])}
          </Card>
          {[...sections.entries()]
            .filter(([s]) => s !== "main")
            .map(([s, list]) => (
              <Card key={s} title={s === "geo" ? t("content.editor.geoTitle") : s} description={s === "geo" ? t("content.editor.geoDescription") : undefined} padding="form">
                {renderFields(list)}
              </Card>
            ))}
          {type.routable ? (
            <Card title={t("content.seo.title")} description={t("content.seo.description")} padding="form">
              <div className="flex flex-col gap-4" id="issue-seo-title">
                <div className="rounded-md border border-border bg-surface-muted/50 p-3" aria-label={t("content.seo.preview")} role="group">
                  <p className="truncate text-xs text-fg-muted">{`${storefrontUrl.replace(/^https?:\/\//, "")}${path ?? ""}`}</p>
                  <p className="truncate text-lg text-link">{seoTitle || title || t("content.entries.untitled")}</p>
                  <p className="line-clamp-2 text-sm text-fg-muted">{seoDescription || fallbackDescription || t("content.seo.noDescription")}</p>
                </div>
                <Field label={t("content.seo.metaTitle")} description={t("content.seo.metaTitleHint")} optional error={issueAt(`seo.title.${editLocale}`) ?? null} labelAside={<span className="text-xs uppercase text-fg-muted">{editLocale}</span>}>
                  <Input value={seoTitle} maxLength={70} showCount placeholder={title} disabled={!canWrite} onChange={(e) => setSeo({ title: { ...(value.seo.title ?? {}), [editLocale]: e.target.value } })} />
                </Field>
                <Field label={t("content.seo.metaDescription")} description={t("content.seo.metaDescriptionHint")} optional error={issueAt(`seo.description.${editLocale}`) ?? null} labelAside={<span className="text-xs uppercase text-fg-muted">{editLocale}</span>}>
                  <Textarea value={seoDescription} maxLength={320} showCount rows={3} placeholder={fallbackDescription} disabled={!canWrite} onChange={(e) => setSeo({ description: { ...(value.seo.description ?? {}), [editLocale]: e.target.value } })} />
                </Field>
                <AssetField label={t("content.seo.image")} description={t("content.seo.imageHint")} value={value.seo.imageAssetId ?? null} disabled={!canWrite} error={issueAt("seo.imageAssetId") ?? null} onChange={(id) => setSeo({ imageAssetId: id })} />
                <Field label={t("content.seo.canonical")} description={t("content.seo.canonicalHint")} optional error={issueAt("seo.canonicalPath") ?? null}>
                  <Input value={value.seo.canonicalPath ?? ""} className="font-mono" placeholder="/" maxLength={500} disabled={!canWrite} onChange={(e) => setSeo({ canonicalPath: e.target.value.trim() || null })} />
                </Field>
                <Switch checked={value.seo.noindex === true} disabled={!canWrite} onCheckedChange={(c) => setSeo({ noindex: c || undefined })} label={t("content.seo.noindex")} description={t("content.seo.noindexHint")} />
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label={t("content.editor.sidebar")}>
          <Card title={t("content.editor.publishing")} padding="form">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-fg-muted">{t("content.editor.status")}</dt>
                <dd>
                  <StatusPill domain="contentEntry" value={status} />
                </dd>
              </div>
              {detail?.live ? (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-fg-muted">{t("content.editor.liveVersion")}</dt>
                    <dd className="tabular">v{detail.live.version}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-fg-muted">{t("content.editor.liveSince")}</dt>
                    <dd>
                      <DateTime value={detail.live.liveFrom} format="relative" />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-fg-muted">{t("content.editor.liveLocales")}</dt>
                    <dd className="uppercase">{detail.live.locales.join(", ")}</dd>
                  </div>
                </>
              ) : null}
              {detail?.entry.unpublishAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">{t("content.editor.unpublishAt")}</dt>
                  <dd>
                    <DateTime value={detail.entry.unpublishAt} />
                  </dd>
                </div>
              ) : null}
              {value.id ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">{t("content.editor.revision")}</dt>
                  <dd className="tabular">#{value.revision}</dd>
                </div>
              ) : null}
            </dl>
            {!canPublish && value.id ? <p className="mt-3 text-sm text-fg-muted">{t("content.editor.noPublishPermission")}</p> : null}
            {detail?.live && liveInLocale && liveSlug && !detail.hasUnpublishedChanges && path ? (
              <a href={`${storefrontUrl}${path}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-link underline">
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t("content.editor.viewLive")}
                <span className="sr-only"> ({t("common.openInNewTab")})</span>
              </a>
            ) : null}
          </Card>

          {type.hasSlugs ? (
            <Card title={t("content.editor.address")} description={type.routable ? t("content.editor.addressHint") : t("content.editor.termAddressHint")} padding="form">
              <div className="flex flex-col gap-3">
                {locales.map((l) => {
                  const p = entryPath({ routePrefix: type.routePrefix, kind: type.kind }, l, store.defaultLocale, value.slugs[l]);
                  return (
                    <Field key={l} id={`issue-slugs-${l}`} label={`${t("content.editor.slug")} · ${localeLabel(l, ui)}`} error={issueAt(`slugs.${l}`) ?? null} description={type.kind === "singleton" ? null : p ? <span className="break-all font-mono text-xs">{p}</span> : t("content.editor.slugAuto")}>
                      <Input
                        value={value.slugs[l] ?? ""}
                        className="font-mono"
                        maxLength={63}
                        disabled={!canWrite || type.kind === "singleton"}
                        onChange={(e) => {
                          const slug = e.target.value.toLowerCase().replace(/\s+/g, "-");
                          draft.update((cur) => ({ ...cur, slugs: { ...cur.slugs, [l]: slug } }));
                        }}
                      />
                    </Field>
                  );
                })}
                {detail?.live ? <p className="text-xs text-fg-muted">{t("content.editor.slugRedirect")}</p> : null}
              </div>
            </Card>
          ) : null}

          {type.settings.hierarchical ? (
            <Card title={t("content.editor.parent")} padding="form">
              <Field label={t("content.editor.parentEntry")} description={t("content.editor.parentHint")} optional error={issueAt("parentId") ?? null}>
                <RecordPicker to="entry" typeKeys={[type.key]} value={value.parentId} disabled={!canWrite} onChange={(id) => draft.update((cur) => ({ ...cur, parentId: id && id !== cur.id ? id : null }))} />
              </Field>
            </Card>
          ) : null}

          <Card title={t("content.editor.languages")} padding="form">
            <ul className="flex flex-col gap-1.5 text-sm">
              {locales.map((l) => (
                <li key={l} className="flex items-center justify-between gap-2">
                  <button type="button" className={cn("text-start underline-offset-2 hover:underline", l === editLocale ? "font-medium text-fg" : "text-fg-muted")} onClick={() => setEditLocale(l)}>
                    {localeLabel(l, ui)}
                  </button>
                  <span className="flex items-center gap-1.5">
                    {detail?.entry.publishedLocales.includes(l) ? <Badge tone="success">{t("content.editor.localeLive")}</Badge> : null}
                    {complete[l] ? <Badge tone="neutral">{t("content.editor.localeComplete")}</Badge> : <Badge tone="warning">{t("content.editor.localeIncomplete")}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            {detail?.staleTranslations.length ? (
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-sm font-medium text-warning">{t("content.editor.staleTitle")}</p>
                <ul className="flex flex-col gap-0.5 text-xs text-fg-muted">
                  {detail.staleTranslations.map((s) => (
                    <li key={`${s.field}-${s.locale}`}>
                      {fieldLabelOf(`data.${s.field.split(".")[0]}`)} · {s.locale.toUpperCase()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>

      {value.id ? (
        <HistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          resource="entry"
          resourceId={value.id}
          endpoint={`${apiBase}/content/entries/${value.id}/history`}
          title={displayTitle}
          canRestore={canWrite}
          beforeRestore={draft.flush}
          onRestored={async () => {
            if (value.id) await reload(value.id);
          }}
        />
      ) : null}
      {scheduleOpen && detail ? <ScheduleDialog detail={detail} onClose={() => setScheduleOpen(false)} flush={draft.flush} onSaved={setDetail} /> : null}
      <AlertDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("content.editor.archiveTitle")}
        description={detail?.live ? t("content.editor.archiveLiveBody") : t("content.editor.archiveBody")}
        confirmLabel={t("content.editor.archive")}
        pending={busy === "archive"}
        onConfirm={() => {
          setArchiveOpen(false);
          void simple("archive", t("content.editor.archived"));
          invalidateContentTypes();
        }}
      />
    </div>
  );
}

function DependencyTitle({ id }: { id: string }) {
  const { apiBase } = useStore();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    bff<EntryDetail>(`${apiBase}/content/entries/${id}`).then(
      (d) => setTitle(d.title),
      () => setTitle(id),
    );
  }, [apiBase, id]);
  return <>{title ?? "…"}</>;
}

function SaveLine({ status, savedAt, issues, created, onRetry }: { status: string; savedAt: number | null; issues: number; created: boolean; onRetry: () => void }) {
  const { t, locale } = useI18n();
  const time = (ms: number) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(ms);
  let icon = <Check aria-hidden="true" className="size-3.5 text-success" />;
  let text = savedAt ? t("editor.save.savedAt", { time: time(savedAt) }) : created ? t("editor.save.upToDate") : t("content.editor.notCreated");
  let retry = false;
  if (status === "saving") {
    icon = <Spinner className="size-3.5" />;
    text = t("editor.save.saving");
  } else if (status === "error") {
    icon = <CircleAlert aria-hidden="true" className="size-3.5 text-danger" />;
    text = issues ? t("editor.save.invalid", { count: issues }) : t("editor.save.failed");
    retry = !issues;
  } else if (status === "blocked") {
    icon = <CircleAlert aria-hidden="true" className="size-3.5 text-warning" />;
    text = t("editor.save.blocked");
  } else if (status === "conflict") {
    icon = <CircleAlert aria-hidden="true" className="size-3.5 text-warning" />;
    text = t("editor.save.conflict");
  } else if (status === "dirty") {
    icon = <span aria-hidden="true" className="size-2 rounded-full bg-warning" />;
    text = t("editor.save.unsaved");
  }
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite" data-save-status={status}>
      {icon}
      {text}
      {retry ? (
        <Button size="sm" variant="link" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </span>
  );
}

function ScheduleDialog({ detail, onClose, flush, onSaved }: { detail: EntryDetail; onClose: () => void; flush: () => Promise<boolean>; onSaved: (d: EntryDetail) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const { toast } = useToast();
  const [publishAt, setPublishAt] = useState<string | null>(detail.entry.publishAt);
  const [unpublishAt, setUnpublishAt] = useState<string | null>(detail.entry.unpublishAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const save = async (body: { publishAt: string | null; unpublishAt: string | null }) => {
    setPending(true);
    setError(null);
    try {
      if (!(await flush())) {
        setPending(false);
        return;
      }
      const res = await bff<EntryDetail>(`${apiBase}/content/entries/${detail.entry.id}/schedule`, { method: "PUT", body });
      onSaved(res);
      toast({ tone: "success", title: body.publishAt || body.unpublishAt ? t("content.schedule.saved") : t("content.schedule.cleared") });
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };
  const described = error ? describeError(error) : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("content.schedule.title")}
      description={t("content.schedule.description")}
      footer={
        <>
          {detail.entry.publishAt || detail.entry.unpublishAt ? (
            <Button variant="ghost" className="me-auto" disabled={pending} onClick={() => void save({ publishAt: null, unpublishAt: null })}>
              {t("content.schedule.clear")}
            </Button>
          ) : null}
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={pending} disabled={!publishAt && !unpublishAt} onClick={() => void save({ publishAt, unpublishAt })}>
            {t("content.schedule.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("content.schedule.publishAt")} description={t("content.schedule.publishAtHint")} optional>
          <DateTimeInput value={publishAt} timeZone={store.timezone} onChange={setPublishAt} />
        </Field>
        <Field label={t("content.schedule.unpublishAt")} description={t("content.schedule.unpublishAtHint")} optional>
          <DateTimeInput value={unpublishAt} timeZone={store.timezone} onChange={setUnpublishAt} />
        </Field>
        {described ? (
          <InlineAlert tone="danger" live="alert">
            {described.message}
            {Object.values(described.fields).length ? (
              <ul className="mt-1 list-disc ps-5">
                {Object.entries(described.fields).map(([p, m]) => (
                  <li key={p}>{m}</li>
                ))}
              </ul>
            ) : null}
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  );
}


