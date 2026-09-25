"use client";

import { ArrowDown, ArrowUp, MapPin, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import { labelText } from "@/lib/content/fields";
import type { SiteLocation } from "@/lib/site/types";

/** One line of a location's address ("Moda Cd. 12, Kadıköy / İstanbul"). */
export function addressLine(l: Pick<SiteLocation, "address" | "serviceArea">, serviceArea: string): string {
  if (l.address) return [l.address.street, [l.address.ilce, l.address.il].filter(Boolean).join(" / ")].filter(Boolean).join(", ");
  if (l.serviceArea) return serviceArea;
  return "";
}

/**
 * Site › locations: branches, offices and service points in display order. Exactly one active
 * location is primary (the imprint and the organization JSON-LD use it); order decides the
 * storefront list.
 */
export function LocationsView({ initial }: { initial: SiteLocation[] }) {
  const { t, locale } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SiteLocation | null>(null);
  const canEdit = can("site:write");
  const nameOf = (l: SiteLocation) => labelText(l.name, locale, l.slug);

  const reorder = async (from: number, to: number) => {
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    setItems(next);
    setBusy("order");
    try {
      const res = await bff<{ items: SiteLocation[] }>(`${apiBase}/site/locations/order`, { method: "PUT", body: { ids: next.map((l) => l.id) } });
      setItems(res.items);
    } catch (err) {
      setItems(items);
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const makePrimary = async (l: SiteLocation) => {
    setBusy(l.id);
    try {
      await bff<SiteLocation>(`${apiBase}/site/locations/${l.id}`, { method: "PATCH", body: { isPrimary: true } });
      const res = await bff<{ items: SiteLocation[] }>(`${apiBase}/site/locations`);
      setItems(res.items);
      toast({ tone: "success", title: t("site.locations.primarySet", { name: nameOf(l) }) });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const remove = async (l: SiteLocation) => {
    setBusy(l.id);
    try {
      await bff<void>(`${apiBase}/site/locations/${l.id}`, { method: "DELETE" });
      const res = await bff<{ items: SiteLocation[] }>(`${apiBase}/site/locations`);
      setItems(res.items);
      setDeleting(null);
      toast({ tone: "success", title: t("site.locations.deleted", { name: nameOf(l) }) });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={t("site.locations.title")}
        meta={t("site.locations.description")}
        actions={
          canEdit ? (
            <ButtonLink href={`${basePath}/site/locations/new`} variant="primary">
              <Plus aria-hidden="true" />
              {t("site.locations.new")}
            </ButtonLink>
          ) : null
        }
      />
      {!canEdit ? <InlineAlert tone="info">{t("site.readOnly", { permission: "site:write" })}</InlineAlert> : null}
      <div className="rounded-lg border border-border bg-surface">
        {items.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={t("site.locations.emptyTitle")}
            description={t("site.locations.emptyBody")}
            actions={
              canEdit ? (
                <ButtonLink href={`${basePath}/site/locations/new`} variant="primary">
                  {t("site.locations.new")}
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <ol aria-label={t("site.locations.title")} aria-busy={busy === "order" || undefined} className="divide-y divide-border">
            {items.map((l, i) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 text-center text-sm text-fg-subtle tabular">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`${basePath}/site/locations/${l.id}`} className="font-medium text-fg">
                      {nameOf(l)}
                    </Link>
                    {l.isPrimary ? (
                      <Badge tone="accent">
                        <Star aria-hidden="true" className="me-1 inline size-3" />
                        {t("site.locations.primary")}
                      </Badge>
                    ) : null}
                    <StatusPill domain="siteLocation" value={l.status} />
                  </span>
                  <span className="truncate text-sm text-fg-muted">{addressLine(l, t("site.locations.serviceAreaOnly")) || t("site.locations.noAddress")}</span>
                  <span className="text-xs text-fg-subtle">
                    {[l.phone, l.whatsapp ? `WhatsApp ${l.whatsapp}` : null, l.openingHours.weekly.length ? t("site.locations.hoursSet") : l.openingHours.byAppointment ? t("site.hours.byAppointment") : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {canEdit ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveUpItem", { name: nameOf(l) })} disabled={i === 0 || busy !== null} onClick={() => void reorder(i, i - 1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveDownItem", { name: nameOf(l) })} disabled={i === items.length - 1 || busy !== null} onClick={() => void reorder(i, i + 1)}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t("common.rowActions", { name: nameOf(l) })} disabled={busy !== null}>
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => router.push(`${basePath}/site/locations/${l.id}`)}>
                          <Pencil aria-hidden="true" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={l.isPrimary || l.status !== "active"} onSelect={() => void makePrimary(l)}>
                          <Star aria-hidden="true" />
                          {t("site.locations.makePrimary")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem tone="danger" onSelect={() => setDeleting(l)}>
                          <Trash2 aria-hidden="true" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("site.locations.deleteTitle", { name: deleting ? nameOf(deleting) : "" })}
        description={deleting?.isPrimary ? t("site.locations.deletePrimaryBody") : t("site.locations.deleteBody")}
        confirmLabel={t("common.delete")}
        pending={deleting !== null && busy === deleting.id}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </div>
  );
}
