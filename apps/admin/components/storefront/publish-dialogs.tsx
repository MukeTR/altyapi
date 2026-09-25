"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { RadioGroup } from "@/components/ui/radio-group";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { pagePublishPermission } from "@/lib/storefront/permissions";
import type { Publication, StorefrontPage } from "@/lib/storefront/types";

/** Page title in the interface's preferred language, falling back to the store default and any language. */
export function pageTitleOf(page: Pick<StorefrontPage, "title" | "handle">, locale: string, defaultLocale: string): string {
  return page.title[locale] || page.title[defaultLocale] || Object.values(page.title).find(Boolean) || page.handle;
}

function toInfo(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) return err.toInfo();
  return { status: 0, code: "network", messageKey: "errors.network", correlationId: null };
}

function FormError({ error }: { error: ApiErrorInfo | null }) {
  const { describeError, t } = useI18n();
  if (!error) return null;
  const d = describeError(error);
  return (
    <InlineAlert tone="danger" live="alert" title={d.message}>
      {d.correlationId ? (
        <span className="text-sm text-fg-muted">
          {t("common.supportCode")}: <code className="font-mono">{d.correlationId}</code>
        </span>
      ) : null}
    </InlineAlert>
  );
}

type Choice = "page" | "theme" | "all";

/**
 * Publishes drafts to the live storefront: one page, the theme (with global sections and menus)
 * or everything. Each publish creates a numbered publication that can be rolled back.
 */
export function PublishDialog({
  open,
  onOpenChange,
  pages,
  themeHasChanges,
  currentPage,
  beforePublish,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: readonly StorefrontPage[];
  themeHasChanges: boolean | null;
  /** The page being edited, offered as "publish this page". */
  currentPage?: StorefrontPage | null;
  /** Saves pending edits first; resolve false to stop. */
  beforePublish?: () => Promise<boolean>;
  onPublished: (publication: Publication) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { apiBase, can, store } = useStore();
  const { toast } = useToast();
  const canPublishAll = can("storefront:publish");
  const canPublishPage = currentPage ? can(pagePublishPermission(currentPage.type)) : false;
  const changed = pages.filter((p) => p.hasUnpublishedChanges || p.status === "draft" || p.status === "unpublished");
  const [choice, setChoice] = useState<Choice>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setChoice(currentPage && canPublishPage && (currentPage.hasUnpublishedChanges || currentPage.status !== "published") ? "page" : canPublishAll ? "all" : "page");
  }, [open, currentPage, canPublishPage, canPublishAll]);

  const options = [
    ...(currentPage
      ? [
          {
            value: "page",
            label: t("storefront.publish.thisPage", { title: pageTitleOf(currentPage, locale, store.defaultLocale) }),
            description: canPublishPage ? (currentPage.hasUnpublishedChanges || currentPage.status !== "published" ? t("storefront.publish.thisPageHint") : t("storefront.publish.noChangesPage")) : t("storefront.publish.noPermission", { permission: pagePublishPermission(currentPage.type) }),
            disabled: !canPublishPage,
          },
        ]
      : []),
    {
      value: "theme",
      label: t("storefront.publish.theme"),
      description: canPublishAll ? (themeHasChanges ? t("storefront.publish.themeHint") : t("storefront.publish.noChangesTheme")) : t("storefront.publish.noPermission", { permission: "storefront:publish" }),
      disabled: !canPublishAll,
    },
    {
      value: "all",
      label: t("storefront.publish.all"),
      description: canPublishAll ? t("storefront.publish.allHint", { count: changed.length }) : t("storefront.publish.noPermission", { permission: "storefront:publish" }),
      disabled: !canPublishAll,
    },
  ];

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (beforePublish && !(await beforePublish())) return;
      const body = choice === "page" && currentPage ? { pageIds: [currentPage.id] } : choice === "theme" ? { theme: true } : { all: true };
      const pub = await bff<Publication>(`${apiBase}/storefront/publish`, { method: "POST", body });
      toast({ tone: "success", title: t("storefront.publish.done", { number: pub.number }) });
      await onPublished(pub);
      onOpenChange(false);
    } catch (err) {
      setError(toInfo(err));
    } finally {
      setPending(false);
    }
  };

  const nothingAllowed = options.every((o) => o.disabled);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("storefront.publish.title")}
      description={t("storefront.publish.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={pending} disabled={nothingAllowed}>
            {t("storefront.publish.confirm")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormError error={error} />
        <RadioGroup name="publish-scope" aria-label={t("storefront.publish.scope")} options={options} value={choice} onValueChange={(v) => setChoice(v as Choice)} />
        {choice === "all" && changed.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-muted p-3">
            <span className="text-sm font-medium text-fg">{t("storefront.publish.changedPages")}</span>
            <ul className="flex list-disc flex-col gap-0.5 ps-5 text-sm text-fg-muted">
              {changed.slice(0, 12).map((p) => (
                <li key={p.id}>{pageTitleOf(p, locale, store.defaultLocale)}</li>
              ))}
              {changed.length > 12 ? <li>{t("storefront.publish.andMore", { count: changed.length - 12 })}</li> : null}
            </ul>
          </div>
        ) : null}
        <p className="text-sm text-fg-muted">{t("storefront.publish.rollbackNote")}</p>
      </form>
    </Dialog>
  );
}

/** Publish and unpublish times of a page or landing page; the worker applies them. */
export function ScheduleDialog({ open, onOpenChange, page, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; page: StorefrontPage; onSaved: (page: StorefrontPage) => void }) {
  const { t, locale } = useI18n();
  const { apiBase, store } = useStore();
  const { toast } = useToast();
  const [publishAt, setPublishAt] = useState<string | null>(page.publishAt);
  const [unpublishAt, setUnpublishAt] = useState<string | null>(page.unpublishAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setPublishAt(page.publishAt);
    setUnpublishAt(page.unpublishAt);
    setError(null);
  }, [open, page.publishAt, page.unpublishAt]);

  const invalid = Boolean(publishAt && unpublishAt && publishAt >= unpublishAt);
  const inPast = Boolean(publishAt && new Date(publishAt).getTime() < Date.now() - 60_000);

  const save = async (next: { publishAt: string | null; unpublishAt: string | null }) => {
    setPending(true);
    setError(null);
    try {
      const saved = await bff<StorefrontPage>(`${apiBase}/storefront/pages/${page.id}/schedule`, { method: "PUT", body: next });
      toast({ tone: "success", title: next.publishAt || next.unpublishAt ? t("storefront.schedule.saved") : t("storefront.schedule.cleared") });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(toInfo(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("storefront.schedule.title")}
      description={t("storefront.schedule.description", { title: pageTitleOf(page, locale, store.defaultLocale) })}
      footer={
        <>
          {page.publishAt || page.unpublishAt ? (
            <Button className="me-auto" variant="ghost" disabled={pending} onClick={() => void save({ publishAt: null, unpublishAt: null })}>
              {t("storefront.schedule.clear")}
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={pending} disabled={invalid || (!publishAt && !unpublishAt)} onClick={() => void save({ publishAt, unpublishAt })}>
            {t("storefront.schedule.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) void save({ publishAt, unpublishAt });
        }}
      >
        <FormError error={error} />
        <Field label={t("storefront.schedule.publishAt")} description={page.status === "published" ? t("storefront.schedule.alreadyPublished") : t("storefront.schedule.publishAtHint")} optional>
          <DateTimeInput value={publishAt} onChange={setPublishAt} />
        </Field>
        <Field label={t("storefront.schedule.unpublishAt")} description={t("storefront.schedule.unpublishAtHint")} optional error={invalid ? t("storefront.schedule.orderInvalid") : null}>
          <DateTimeInput value={unpublishAt} onChange={setUnpublishAt} />
        </Field>
        {inPast ? <InlineAlert tone="warning">{t("storefront.schedule.pastWarning")}</InlineAlert> : null}
        <p className="text-sm text-fg-muted">{t("storefront.schedule.draftNote")}</p>
      </form>
    </Dialog>
  );
}

/** Takes a published page or landing page off the live site (a new publication without it). */
export function UnpublishDialog({ open, onOpenChange, page, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; page: StorefrontPage; onDone: (pub: Publication) => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError(null);
      }}
      title={t("storefront.unpublish.title")}
      description={t("storefront.unpublish.description", { title: pageTitleOf(page, locale, store.defaultLocale), path: page.livePath ?? page.path ?? "" })}
      confirmLabel={t("storefront.unpublish.confirm")}
      pending={pending}
      onConfirm={async () => {
        setPending(true);
        setError(null);
        try {
          const pub = await bff<Publication>(`${apiBase}/storefront/pages/${page.id}/unpublish`, { method: "POST" });
          toast({ tone: "success", title: t("storefront.unpublish.done") });
          onDone(pub);
          onOpenChange(false);
        } catch (err) {
          setError(toInfo(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {error ? <p className="text-sm text-danger" role="alert">{describeError(error).message}</p> : null}
    </AlertDialog>
  );
}

/** Deletes a page or landing page that is not live. */
export function DeletePageDialog({ open, onOpenChange, page, onDeleted }: { open: boolean; onOpenChange: (open: boolean) => void; page: StorefrontPage; onDeleted: () => void }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, store } = useStore();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError(null);
      }}
      title={t("storefront.deletePage.title")}
      description={t("storefront.deletePage.description", { title: pageTitleOf(page, locale, store.defaultLocale) })}
      confirmLabel={t("storefront.deletePage.confirm")}
      pending={pending}
      onConfirm={async () => {
        setPending(true);
        setError(null);
        try {
          await bff(`${apiBase}/storefront/pages/${page.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("storefront.deletePage.done") });
          onDeleted();
          onOpenChange(false);
        } catch (err) {
          setError(toInfo(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {error ? <p className="text-sm text-danger" role="alert">{describeError(error).message}</p> : null}
    </AlertDialog>
  );
}
