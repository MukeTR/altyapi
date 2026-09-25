"use client";

import { ArrowRight, ExternalLink, Globe, Lock, MoreHorizontal, Plus, RotateCw, Route, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ItemList } from "@/lib/api/types";
import { IN_PROGRESS, type Domain } from "@/lib/domains/types";
import { AddDomainDialog } from "./add-domain-dialog";
import { DnsRecords } from "./dns-records";
import { useFailureReason } from "./failure-reason";

const POLL_MS = 15_000;

function domainUrl(hostname: string, template: string): string {
  return template.replace("{host}", hostname);
}

function DomainCard({
  domain,
  canManage,
  busy,
  originTemplate,
  onRetry,
  onCanonical,
  onRemove,
}: {
  domain: Domain;
  canManage: boolean;
  busy: boolean;
  originTemplate: string;
  onRetry: () => void;
  onCanonical: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const failureText = useFailureReason();
  const platform = domain.kind === "platform_subdomain";
  const active = domain.status === "active";
  const showDns = !platform && (!active || domain.dnsInstructions.length > 0);
  const [dnsOpen, setDnsOpen] = useState(!active);
  const canCanonical = active && !domain.redirectToHostname && !domain.isCanonical;

  return (
    <Card as="article">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-all font-mono text-md font-semibold text-fg">{domain.hostname}</h3>
              {domain.isCanonical ? (
                <Badge tone="accent">
                  <Star aria-hidden="true" className="size-3" />
                  {t("domains.canonical")}
                </Badge>
              ) : null}
              {platform ? (
                <Badge>
                  <Lock aria-hidden="true" className="size-3" />
                  {t("domains.platform")}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <StatusPill domain="domain" value={domain.status} />
              {domain.sslStatus ? (
                <span className="inline-flex items-center gap-1">
                  {t("domains.ssl")}: <StatusPill domain="ssl" value={domain.sslStatus} noDot />
                </span>
              ) : null}
              {domain.redirectToHostname ? (
                <span className="inline-flex items-center gap-1">
                  <ArrowRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
                  {t("domains.redirectsTo", { hostname: domain.redirectToHostname })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {active ? (
              <a href={domainUrl(domain.hostname, originTemplate)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-link hover:underline">
                <ExternalLink aria-hidden="true" className="size-4" />
                {t("domains.visit")}
                <span className="sr-only"> ({t("common.openInNewTab")})</span>
              </a>
            ) : null}
            {canManage && (!platform || canCanonical) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={t("common.rowActions", { name: domain.hostname })} disabled={busy}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {!platform ? (
                    <DropdownMenuItem onSelect={onRetry}>
                      <RotateCw aria-hidden="true" />
                      {active ? t("domains.recheck") : t("domains.retry")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem disabled={!canCanonical} onSelect={onCanonical}>
                    <Star aria-hidden="true" />
                    {t("domains.makeCanonical")}
                  </DropdownMenuItem>
                  {!platform ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem tone="danger" onSelect={onRemove}>
                        <Trash2 aria-hidden="true" />
                        {t("domains.remove")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        <p className="text-sm text-fg-muted">{platform ? t("domains.platformNote") : (t.maybe(`domains.statusHelp.${domain.status}`) ?? "")}</p>

        {domain.failureReason ? <InlineAlert tone={domain.status === "failed" ? "danger" : "warning"}>{failureText(domain.failureReason)}</InlineAlert> : null}
        {domain.verificationErrors.length ? (
          <InlineAlert tone="warning" title={t("domains.verificationErrors")}>
            <ul className="list-disc ps-4 text-sm">
              {domain.verificationErrors.map((e, i) => (
                <li key={i} className="break-words">
                  {e}
                </li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}

        {showDns ? (
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="link" aria-expanded={dnsOpen} onClick={() => setDnsOpen((o) => !o)} className="self-start">
              {dnsOpen ? t("domains.hideDns") : t("domains.showDns")}
            </Button>
            {dnsOpen ? <DnsRecords records={domain.dnsInstructions} hostname={domain.hostname} /> : null}
          </div>
        ) : null}

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <span>
            {t("domains.added")} <DateTime value={domain.createdAt} format="date" />
          </span>
          {domain.activatedAt ? (
            <span>
              {t("domains.activated")} <DateTime value={domain.activatedAt} format="date" />
            </span>
          ) : null}
          {domain.lastCheckedAt ? (
            <span>
              {t("domains.lastChecked")} <DateTime value={domain.lastCheckedAt} format="relative" />
            </span>
          ) : null}
        </p>
      </div>
    </Card>
  );
}

/**
 * Settings › Domains: the permanent platform address, custom domains with their DNS records,
 * verification and certificate state, retry, canonical choice and removal. Domains that are
 * still being set up are re-checked automatically while the page is open.
 */
export function DomainsManager({ initial, originTemplate }: { initial: Domain[]; originTemplate: string }) {
  const { t, describeError } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [, startRefresh] = useTransition();
  const [domains, setDomains] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Domain | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [removeError, setRemoveError] = useState<ApiErrorInfo | null>(null);
  const canManage = can("domains:manage");
  // "?add=1" (from the command palette or a link) opens the add-domain wizard once, then leaves the URL.
  const wantsAdd = useSearchParams().get("add") === "1";
  useEffect(() => {
    if (!wantsAdd) return;
    if (canManage) setAdding(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    window.history.replaceState(window.history.state, "", url);
  }, [wantsAdd, canManage]);

  useEffect(() => setDomains(initial), [initial]);

  const reload = useCallback(async () => {
    try {
      const res = await bff<ItemList<Domain>>(`${apiBase}/domains`);
      setDomains(res.items);
    } catch {
      // Polling failures are silent; the next attempt or a manual action reports errors.
    }
  }, [apiBase]);

  const inProgress = domains.some((d) => d.kind === "custom" && IN_PROGRESS.includes(d.status) && d.failureReason !== "cloudflare_not_configured");
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inProgress, reload]);

  const act = async (d: Domain, action: "retry" | "canonical") => {
    setBusy(d.id);
    try {
      await bff<Domain>(`${apiBase}/domains/${d.id}/${action}`, { method: "POST" });
      toast({ tone: "success", title: action === "retry" ? t("domains.retried", { hostname: d.hostname }) : t("domains.canonicalSet", { hostname: d.hostname }) });
      await reload();
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    setRemoveError(null);
    try {
      await bff(`${apiBase}/domains/${removing.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("domains.removed", { hostname: removing.hostname }) });
      setRemoving(null);
      await reload();
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError) setRemoveError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const platform = domains.filter((d) => d.kind === "platform_subdomain");
  const custom = domains.filter((d) => d.kind === "custom");
  const canonical = domains.find((d) => d.isCanonical);
  const apexOf = (d: Domain) => custom.filter((c) => c.redirectToHostname === d.hostname);
  const removingApex = removing ? apexOf(removing) : [];

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <PageHeader
        title={t("domains.title")}
        meta={t("domains.description")}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              {t("domains.add")}
            </Button>
          ) : null
        }
      />

      {canonical ? (
        <Card title={t("domains.canonicalTitle")} description={t("domains.canonicalDescription")}>
          <p className="flex flex-wrap items-center gap-2 font-mono text-base text-fg">
            <Globe aria-hidden="true" className="size-4 text-fg-muted" />
            {canonical.hostname}
          </p>
        </Card>
      ) : null}

      <section aria-labelledby="platform-domains" className="flex flex-col gap-3">
        <h2 id="platform-domains" className="text-md font-semibold text-fg">
          {t("domains.platformTitle")}
        </h2>
        {platform.map((d) => (
          <DomainCard key={d.id} domain={d} canManage={canManage} busy={busy === d.id} originTemplate={originTemplate} onRetry={() => void act(d, "retry")} onCanonical={() => void act(d, "canonical")} onRemove={() => setRemoving(d)} />
        ))}
      </section>

      <section aria-labelledby="custom-domains" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="custom-domains" className="text-md font-semibold text-fg">
            {t("domains.customTitle")}
          </h2>
          {inProgress ? (
            <span role="status" className="text-sm text-fg-muted">
              {t("domains.autoChecking")}
            </span>
          ) : null}
        </div>
        {custom.length === 0 ? (
          <Card>
            <EmptyState
              icon={Globe}
              title={t("domains.emptyTitle")}
              description={t("domains.emptyBody")}
              actions={
                canManage ? (
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    <Plus aria-hidden="true" />
                    {t("domains.add")}
                  </Button>
                ) : null
              }
            />
          </Card>
        ) : (
          custom
            .filter((d) => !d.redirectToHostname || !custom.some((c) => c.hostname === d.redirectToHostname))
            .flatMap((d) => [d, ...apexOf(d)])
            .map((d) => (
              <DomainCard
                key={d.id}
                domain={d}
                canManage={canManage}
                busy={busy === d.id}
                originTemplate={originTemplate}
                onRetry={() => void act(d, "retry")}
                onCanonical={() => void act(d, "canonical")}
                onRemove={() => {
                  setConfirmText("");
                  setRemoveError(null);
                  setRemoving(d);
                }}
              />
            ))
        )}
      </section>

      <Card title={t("domains.redirectsTitle")} description={t("domains.redirectsDescription")}>
        <Link href={`${basePath}/storefront/redirects`} className="inline-flex items-center gap-1.5 text-base">
          <Route aria-hidden="true" className="size-4" />
          {t("domains.redirectsLink")}
        </Link>
      </Card>

      <AddDomainDialog open={adding} onOpenChange={setAdding} onChanged={() => void reload()} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title={t("domains.removeTitle", { hostname: removing?.hostname ?? "" })}
        description={
          removing?.isCanonical
            ? t("domains.removeCanonicalBody")
            : removingApex.length
              ? t("domains.removeWithApexBody", { apex: removingApex.map((a) => a.hostname).join(", ") })
              : t("domains.removeBody")
        }
        confirmLabel={t("domains.remove")}
        pending={busy === removing?.id}
        confirmDisabled={confirmText.trim().toLowerCase() !== removing?.hostname}
        onConfirm={() => void remove()}
      >
        <div className="flex flex-col gap-2">
          <Field label={t("domains.typeToConfirm", { hostname: removing?.hostname ?? "" })}>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
          {removeError ? (
            <p role="alert" className="text-sm text-danger">
              {describeError(removeError).message}
            </p>
          ) : null}
        </div>
      </AlertDialog>
    </div>
  );
}
