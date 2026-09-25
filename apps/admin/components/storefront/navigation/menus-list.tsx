"use client";

import { ListTree, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { slugify } from "@/lib/slug";
import { countItems } from "@/lib/storefront/navigation";
import type { NavigationMenu } from "@/lib/storefront/types";

const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function NewMenuDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (open: boolean) => void; existing: readonly NavigationMenu[] }) {
  const { t, describeError } = useI18n();
  const { apiBase, basePath } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setHandle("");
    setTouched(false);
    setError(null);
  }, [open]);

  const effective = touched ? handle : slugify(name, 63);
  const handleError = effective && !HANDLE.test(effective) ? t("storefront.menus.handleInvalid") : existing.some((m) => m.handle === effective) ? t("storefront.menus.handleTaken") : null;

  const submit = async () => {
    if (!name.trim() || !effective || handleError) return;
    setPending(true);
    setError(null);
    try {
      await bff(`${apiBase}/storefront/navigations/${effective}`, { method: "PUT", body: { name: name.trim(), items: [] } });
      onOpenChange(false);
      router.push(`${basePath}/storefront/navigation/${effective}`);
    } catch (err) {
      if (err instanceof ApiError) setError(err.toInfo());
      else throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("storefront.menus.newTitle")}
      description={t("storefront.menus.newDescription")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={pending} disabled={!name.trim() || !effective || Boolean(handleError)} onClick={() => void submit()}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <FormAlert tone="danger" title={describeError(error).message} focusKey={error} /> : null}
        <Field label={t("storefront.menus.name")} required>
          <Input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t("storefront.menus.namePlaceholder")} />
        </Field>
        <Field label={t("storefront.menus.handle")} description={t("storefront.menus.handleHint")} error={handleError}>
          <Input
            value={effective}
            className="font-mono"
            maxLength={63}
            onChange={(e) => {
              setTouched(true);
              setHandle(e.target.value.toLowerCase());
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** Storefront menus (main, footer…) with where the theme uses each. */
export function MenusList({ menus, usage }: { menus: NavigationMenu[]; usage: Record<string, string[]> }) {
  const { t } = useI18n();
  const { basePath, can } = useStore();
  const [open, setOpen] = useState(false);
  const canEdit = can("storefront:write");
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={t("storefront.menus.title")}
        meta={t("storefront.menus.description")}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" />
              {t("storefront.menus.new")}
            </Button>
          ) : null
        }
      />
      <InlineAlert tone="info">{t("storefront.menus.publishNote")}</InlineAlert>
      {menus.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListTree}
            title={t("storefront.menus.listEmptyTitle")}
            description={t("storefront.menus.listEmptyBody")}
            actions={
              canEdit ? (
                <Button variant="primary" onClick={() => setOpen(true)}>
                  {t("storefront.menus.new")}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {menus.map((m) => (
            <li key={m.id}>
              <Card as="article" className="h-full">
                <div className="flex flex-col gap-2">
                  <Link href={`${basePath}/storefront/navigation/${m.handle}`} className="text-md font-semibold text-fg no-underline hover:underline">
                    {m.name}
                  </Link>
                  <span className="font-mono text-sm text-fg-muted">{m.handle}</span>
                  <p className="text-sm text-fg-muted">
                    {t("storefront.menus.itemCount", { count: countItems(m.items) })}
                    {m.updatedAt ? (
                      <>
                        {" · "}
                        {t("storefront.menus.updated")} <DateTime value={m.updatedAt} format="relative" />
                      </>
                    ) : null}
                  </p>
                  <p className="text-sm text-fg-muted">{usage[m.handle]?.length ? t("storefront.menus.usedIn", { places: usage[m.handle]!.join(", ") }) : t("storefront.menus.notUsed")}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <NewMenuDialog open={open} onOpenChange={setOpen} existing={menus} />
    </div>
  );
}
