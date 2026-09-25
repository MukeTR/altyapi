"use client";

import { Check, KeyRound, LogIn, Radar, TrendingUp, Unlink, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { AlertDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { PEERS, type AdminLink, type LinksResponse, type Peer, type PeerConfig } from "@/lib/ekosistem/types";
import type { Permission } from "@/lib/permissions";
import { AcceptCodeDialog, IssueCodeDialog } from "./link-dialogs";
import { PeerIdentity } from "./peer-identity";
import { ScopeList } from "./scope-checklist";

const POLL_MS = 5_000;
const LIVE: readonly string[] = ["pending", "awaiting_approval", "active"];

function LinkDetails({ link }: { link: AdminLink }) {
  const { t } = useI18n();
  const peerName = t(`ekosistem.peers.${link.peerProduct}.name`);
  return (
    <div className="flex flex-col gap-4">
      <PeerIdentity peer={link.peerProduct} account={link.peerAccount} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-fg">{t("ekosistem.link.theyRead", { peer: peerName })}</h4>
          <ScopeList scopes={link.grantedScopes} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-fg">{t("ekosistem.link.weRead", { peer: peerName })}</h4>
          <ScopeList scopes={link.peerScopes} />
        </div>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
        <span>
          {t("ekosistem.link.role")}: {t(`ekosistem.roles.${link.role}`)}
        </span>
        <span>
          {t("ekosistem.link.created")} <DateTime value={link.createdAt} format="relative" />
        </span>
        {link.approvedAt ? (
          <span>
            {t("ekosistem.link.approved")} <DateTime value={link.approvedAt} format="relative" />
          </span>
        ) : null}
        {link.lastPullAt ? (
          <span>
            {t("ekosistem.link.lastPull")} <DateTime value={link.lastPullAt} format="relative" />
          </span>
        ) : null}
        {link.rotatedAt ? (
          <span>
            {t("ekosistem.link.rotated")} <DateTime value={link.rotatedAt} format="relative" />
          </span>
        ) : null}
      </p>
    </div>
  );
}

function PeerCard({ peer, links, config, onChanged }: { peer: Peer; links: AdminLink[]; config: PeerConfig | undefined; onChanged: () => void }) {
  const { t, describeError } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const { toast, toastError } = useToast();
  const [issuing, setIssuing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [revoking, setRevoking] = useState<AdminLink | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<ApiErrorInfo | null>(null);
  const peerName = t(`ekosistem.peers.${peer}.name`);
  const canManage = can(`${peer}:manage` as Permission);
  const current = links.find((l) => LIVE.includes(l.status)) ?? null;
  const past = links.filter((l) => l !== current);
  const configured = config?.configured ?? false;
  const Icon = peer === "karmatik" ? TrendingUp : Radar;

  const act = async (link: AdminLink, action: "approve" | "reject" | "confirm") => {
    setBusy(`${action}:${link.id}`);
    try {
      await bff<{ link: AdminLink }>(`${apiBase}/ekosistem/links/${link.id}/${action}`, { method: "POST", ...(action === "confirm" ? { body: {} } : {}) });
      toast({ tone: "success", title: action === "reject" ? t("ekosistem.link.rejectedToast", { peer: peerName }) : t("ekosistem.link.approvedToast", { peer: peerName }) });
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(`revoke:${revoking.id}`);
    setRevokeError(null);
    try {
      await bff<{ link: AdminLink }>(`${apiBase}/ekosistem/links/${revoking.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("ekosistem.link.revokedToast", { peer: peerName }) });
      setRevoking(null);
      setConfirmText("");
      onChanged();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setRevokeError(err.toInfo());
    } finally {
      setBusy(null);
    }
  };

  const notConfiguredReason = t("ekosistem.notConfigured", { peer: peerName });
  const disabledWrap = (node: ReactNode) => (
    <Tooltip content={notConfiguredReason}>
      <span tabIndex={0} className="inline-flex">
        {node}
      </span>
    </Tooltip>
  );
  const issueButton = (
    <Button variant="primary" size="sm" onClick={() => setIssuing(true)} disabled={!configured}>
      <KeyRound aria-hidden="true" />
      {t("ekosistem.issue.open")}
    </Button>
  );
  const acceptButton = (
    <Button size="sm" onClick={() => setAccepting(true)} disabled={!configured}>
      <LogIn aria-hidden="true" />
      {t("ekosistem.accept.open")}
    </Button>
  );

  return (
    <Card
      as="section"
      padding="form"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-fg-muted" />
          {peerName}
          {current ? <StatusPill domain="link" value={current.status} /> : <Badge>{t("ekosistem.link.notLinked")}</Badge>}
        </span>
      }
      description={t(`ekosistem.peers.${peer}.summary`)}
      actions={
        canManage && !current ? (
          configured ? (
            <>
              {issueButton}
              {acceptButton}
            </>
          ) : (
            <>
              {disabledWrap(issueButton)}
              {disabledWrap(acceptButton)}
            </>
          )
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {!configured ? <InlineAlert tone="warning">{notConfiguredReason}</InlineAlert> : null}
        {!canManage ? <InlineAlert tone="info">{t("ekosistem.readOnly", { permission: `${peer}:manage` })}</InlineAlert> : null}

        {current ? (
          <>
            {current.status === "awaiting_approval" ? (
              <InlineAlert
                tone="warning"
                title={t("ekosistem.link.awaitingTitle", { peer: peerName })}
                actions={
                  canManage ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => void act(current, "approve")} loading={busy === `approve:${current.id}`} disabled={busy !== null}>
                        <Check aria-hidden="true" />
                        {t("ekosistem.link.approve")}
                      </Button>
                      <Button size="sm" onClick={() => void act(current, "reject")} loading={busy === `reject:${current.id}`} disabled={busy !== null}>
                        <X aria-hidden="true" />
                        {t("ekosistem.link.reject")}
                      </Button>
                    </>
                  ) : null
                }
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  {t("ekosistem.link.awaitingBody", { peer: peerName })}
                  {current.pendingExpiresAt ? <Countdown expiresAt={current.pendingExpiresAt} onExpire={onChanged} /> : null}
                </span>
              </InlineAlert>
            ) : null}
            {current.status === "pending" ? (
              <InlineAlert
                tone="info"
                title={current.role === "issuer" ? t("ekosistem.link.pendingIssuerTitle", { peer: peerName }) : t("ekosistem.link.pendingAcceptorTitle")}
                actions={
                  canManage && current.role === "acceptor" ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => void act(current, "confirm")} loading={busy === `confirm:${current.id}`} disabled={busy !== null}>
                        <Check aria-hidden="true" />
                        {t("ekosistem.accept.confirm")}
                      </Button>
                      <Button size="sm" onClick={() => void act(current, "reject")} loading={busy === `reject:${current.id}`} disabled={busy !== null}>
                        <X aria-hidden="true" />
                        {t("ekosistem.link.reject")}
                      </Button>
                    </>
                  ) : null
                }
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  {current.role === "issuer" ? t("ekosistem.link.pendingIssuerBody", { peer: peerName }) : t("ekosistem.link.pendingAcceptorBody")}
                  {current.pendingExpiresAt ? <Countdown expiresAt={current.pendingExpiresAt} onExpire={onChanged} /> : null}
                </span>
              </InlineAlert>
            ) : null}
            {current.status === "active" && current.lastError ? (
              <InlineAlert tone="danger" title={t("ekosistem.link.lastError")}>
                <span className="break-words">{current.lastError}</span>
              </InlineAlert>
            ) : null}
            <LinkDetails link={current} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {current.status === "active" ? (
                <Link href={`${basePath}/${peer}`} className="text-sm">
                  {t(`ekosistem.peers.${peer}.open`)}
                </Link>
              ) : null}
              {canManage ? (
                <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setRevoking(current)} disabled={busy !== null}>
                  <Unlink aria-hidden="true" />
                  {t("ekosistem.link.revoke")}
                </Button>
              ) : null}
            </div>
          </>
        ) : configured ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-muted">{t(`ekosistem.peers.${peer}.howTo`)}</p>
            <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm text-fg-muted">
              <li>{t("ekosistem.howIssue", { peer: peerName })}</li>
              <li>{t("ekosistem.howAccept", { peer: peerName })}</li>
            </ol>
          </div>
        ) : null}

        {past.length ? (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">{t("ekosistem.history", { count: past.length })}</summary>
            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {past.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill domain="link" value={l.status} />
                    <span className="text-fg">{l.peerAccount?.label ?? t("common.unknown")}</span>
                    {l.revokeReason ? <span className="text-fg-muted">· {t.maybe(`ekosistem.revokeReasons.${l.revokeReason}`) ?? l.revokeReason}</span> : null}
                    {l.revokeDelivery && !l.revokeDelivery.deliveredAt ? <Badge tone="warning">{t("ekosistem.link.notifyPending")}</Badge> : null}
                  </span>
                  <DateTime value={l.revokedAt ?? l.updatedAt} format="relative" className="text-fg-muted" />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {config && canManage ? (
        <>
          <IssueCodeDialog key={`issue-${peer}-${issuing}`} peer={peer} config={config} open={issuing} onOpenChange={setIssuing} onIssued={onChanged} />
          <AcceptCodeDialog key={`accept-${peer}-${accepting}`} peer={peer} config={config} open={accepting} onOpenChange={setAccepting} onChanged={onChanged} />
        </>
      ) : null}
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRevoking(null);
            setConfirmText("");
            setRevokeError(null);
          }
        }}
        title={t("ekosistem.link.revokeTitle", { peer: peerName })}
        description={t("ekosistem.link.revokeBody", { peer: peerName })}
        confirmLabel={t("ekosistem.link.revoke")}
        pending={busy?.startsWith("revoke:") ?? false}
        confirmDisabled={confirmText.trim().toLocaleLowerCase("tr") !== peerName.toLocaleLowerCase("tr")}
        onConfirm={() => void revoke()}
      >
        <div className="flex flex-col gap-3">
          <Field label={t("ekosistem.link.typeToConfirm", { name: peerName })}>
            <Input value={confirmText} autoComplete="off" onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
          {revokeError ? (
            <InlineAlert tone="danger" live="alert">
              {describeError(revokeError).message}
            </InlineAlert>
          ) : null}
        </div>
      </AlertDialog>
    </Card>
  );
}

/**
 * Apps & Integrations › Ecosystem: links to Kârmatik and Yanıt (docs/ekosistem/v1.md §4). A link
 * starts either with a code this store issues or with a code the peer issued; both sides see the
 * other's verified identity and the scopes in each direction before it becomes active. While a
 * link is being set up the page re-reads the links every 5 seconds.
 */
export function LinksManager({ initial }: { initial: LinksResponse }) {
  const { t } = useI18n();
  const { apiBase, can } = useStore();
  const [data, setData] = useState(initial);
  const [watching, setWatching] = useState(false);
  const visible = PEERS.filter((p) => can(`${p}:read` as Permission));
  const settingUp = data.items.some((l) => l.status === "pending" || l.status === "awaiting_approval");

  const reload = useCallback(async () => {
    try {
      setData(await bff<LinksResponse>(`${apiBase}/ekosistem/links`));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }, [apiBase]);

  useEffect(() => {
    if (!settingUp && !watching) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    // A freshly issued code has no link yet; watch for the peer's claim for the code's lifetime.
    const stop = watching ? setTimeout(() => setWatching(false), 10 * 60_000) : null;
    return () => {
      clearInterval(timer);
      if (stop) clearTimeout(stop);
    };
  }, [settingUp, watching, reload]);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader title={t("ekosistem.title")} meta={t("ekosistem.meta")} />
      {visible.map((peer) => (
        <PeerCard
          key={peer}
          peer={peer}
          links={data.items.filter((l) => l.peerProduct === peer)}
          config={data.peers[peer]}
          onChanged={() => {
            setWatching(true);
            void reload();
          }}
        />
      ))}
    </div>
  );
}
