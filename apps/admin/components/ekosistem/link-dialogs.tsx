"use client";

import { BadgeCheck, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Countdown } from "@/components/ui/countdown";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { isExplicitConsentScope, type AcceptedCode, type AdminLink, type IssuedCode, type Peer, type PeerConfig } from "@/lib/ekosistem/types";
import { PeerIdentity } from "./peer-identity";
import { ScopeChecklist, ScopeList, useScopeText } from "./scope-checklist";

/** Every scope this store may grant the peer: pre-ticked defaults, then explicit-consent ones. */
function grantable(config: PeerConfig): string[] {
  return [...config.defaultGrants, ...config.explicitConsentGrants.filter((s) => !config.defaultGrants.includes(s))];
}

function useDescribe(error: ApiErrorInfo | null) {
  const { t, describeError } = useI18n();
  if (!error) return null;
  const d = describeError(error);
  const peerMessage = typeof (error.details as { message?: unknown } | undefined)?.message === "string" ? (error.details as { message: string }).message : null;
  return peerMessage ? `${d.message} ${t("ekosistem.peerSaid", { message: peerMessage })}` : d.message;
}

/**
 * Issuer flow step 1: this store creates a one-time code (10 minutes) with the scopes it grants.
 * The merchant enters the code in Kârmatik or Yanıt; the link then waits here for approval.
 */
export function IssueCodeDialog({ peer, config, open, onOpenChange, onIssued }: { peer: Peer; config: PeerConfig; open: boolean; onOpenChange: (o: boolean) => void; onIssued: () => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const peerName = t(`ekosistem.peers.${peer}.name`);
  const [grants, setGrants] = useState<string[]>(config.defaultGrants);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const message = useDescribe(error);

  const close = (o: boolean) => {
    if (!o) {
      setIssued(null);
      setExpired(false);
      setError(null);
      setGrants(config.defaultGrants);
    }
    onOpenChange(o);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await bff<IssuedCode>(`${apiBase}/ekosistem/codes`, { method: "POST", body: { peerProduct: peer, grants } });
      setIssued(res);
      setExpired(false);
      onIssued();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      modalLock
      title={t("ekosistem.issue.title", { peer: peerName })}
      description={issued ? t("ekosistem.issue.shownOnce") : t("ekosistem.issue.description", { peer: peerName })}
      footer={
        issued ? (
          <Button variant="primary" onClick={() => close(false)}>
            {t("ekosistem.issue.done")}
          </Button>
        ) : (
          <>
            <Button onClick={() => close(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="issue-code-form" variant="primary" loading={pending} disabled={grants.length === 0}>
              <KeyRound aria-hidden="true" />
              {t("ekosistem.issue.submit")}
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <div className="flex flex-col gap-4">
          <Stepper
            steps={[
              { id: "code", label: t("ekosistem.issue.stepCode") },
              { id: "enter", label: t("ekosistem.issue.stepEnter", { peer: peerName }) },
              { id: "approve", label: t("ekosistem.issue.stepApprove") },
            ]}
            current={1}
          />
          <CodeBlock value={issued.code} label={t("ekosistem.issue.code")} caption={t("ekosistem.issue.code")} />
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            {t("ekosistem.issue.expiresIn")} <Countdown expiresAt={issued.expiresAt} onExpire={() => setExpired(true)} />
          </p>
          {expired ? <InlineAlert tone="warning">{t("ekosistem.issue.expired")}</InlineAlert> : null}
          <InlineAlert tone="info" title={t("ekosistem.issue.nextTitle")}>
            {t(`ekosistem.peers.${peer}.enterCodeHelp`)}
          </InlineAlert>
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium text-fg">{t("ekosistem.issue.granted", { peer: peerName })}</h3>
            <ScopeList scopes={issued.grants} />
          </div>
        </div>
      ) : (
        <form id="issue-code-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          {message ? <ErrorSummary message={message} items={[]} /> : null}
          <ScopeChecklist
            scopes={grantable(config)}
            value={grants}
            onChange={setGrants}
            disabled={pending}
            legend={t("ekosistem.issue.grantsLegend", { peer: peerName })}
            description={t("ekosistem.issue.grantsHelp")}
          />
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium text-fg">{t("ekosistem.issue.receives")}</h3>
            <ScopeList scopes={config.peerDefaultGrants} />
            {config.peerDefaultGrants.some(isExplicitConsentScope) ? <p className="text-xs text-fg-muted">{t("ekosistem.issue.receivesHelp", { peer: peerName })}</p> : null}
          </div>
          <p className="text-sm text-fg-muted">{t("ekosistem.issue.oneLink", { peer: peerName })}</p>
        </form>
      )}
    </Dialog>
  );
}

/**
 * Acceptor flow: the merchant enters a code issued by Kârmatik or Yanıt. altyapi claims it, then
 * shows the peer's verified identity and the scopes in both directions; confirming activates the
 * link (the peer may still need its own approval), rejecting discards it.
 */
export function AcceptCodeDialog({ peer, config, open, onOpenChange, onChanged }: { peer: Peer; config: PeerConfig; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { apiBase } = useStore();
  const peerName = t(`ekosistem.peers.${peer}.name`);
  const [code, setCode] = useState("");
  const [grants, setGrants] = useState<string[]>(config.defaultGrants);
  const [accepted, setAccepted] = useState<AcceptedCode | null>(null);
  const [confirmGrants, setConfirmGrants] = useState<string[]>([]);
  const [done, setDone] = useState<AdminLink | null>(null);
  const [pending, setPending] = useState<"claim" | "confirm" | "reject" | null>(null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const message = useDescribe(error);
  const scopeText = useScopeText();
  const prefix = peer === "karmatik" ? "ek1_k_" : "ek1_y_";
  // Explicit-consent scopes the peer's user left unticked (e.g. profit:read): that data is never pulled.
  const withheld = accepted ? config.peerDefaultGrants.filter((s) => isExplicitConsentScope(s) && !accepted.grants.fromPeer.includes(s)) : [];

  const reset = () => {
    setCode("");
    setGrants(config.defaultGrants);
    setAccepted(null);
    setConfirmGrants([]);
    setDone(null);
    setError(null);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const claim = async (e: FormEvent) => {
    e.preventDefault();
    setPending("claim");
    setError(null);
    try {
      const res = await bff<AcceptedCode>(`${apiBase}/ekosistem/links/accept`, { method: "POST", body: { code: code.trim(), grants } });
      setAccepted(res);
      setConfirmGrants(res.grants.toPeer);
      onChanged();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(null);
    }
  };

  const confirm = async () => {
    if (!accepted) return;
    setPending("confirm");
    setError(null);
    try {
      const res = await bff<{ link: AdminLink }>(`${apiBase}/ekosistem/links/${accepted.link.id}/confirm`, { method: "POST", body: { grants: confirmGrants } });
      setDone(res.link);
      onChanged();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
      onChanged();
    } finally {
      setPending(null);
    }
  };

  const reject = async () => {
    if (!accepted) return;
    setPending("reject");
    setError(null);
    try {
      await bff<{ link: AdminLink }>(`${apiBase}/ekosistem/links/${accepted.link.id}/reject`, { method: "POST" });
      onChanged();
      close(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(null);
    }
  };

  const step = done ? 2 : accepted ? 1 : 0;
  const footer = done ? (
    <Button variant="primary" onClick={() => close(false)}>
      {t("ekosistem.accept.close")}
    </Button>
  ) : accepted ? (
    <>
      <Button variant="ghost" onClick={() => void reject()} loading={pending === "reject"} disabled={pending !== null}>
        {t("ekosistem.accept.reject")}
      </Button>
      <Button variant="primary" onClick={() => void confirm()} loading={pending === "confirm"} disabled={pending !== null || confirmGrants.length === 0}>
        <BadgeCheck aria-hidden="true" />
        {t("ekosistem.accept.confirm")}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={() => close(false)} disabled={pending !== null}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" form="accept-code-form" variant="primary" loading={pending === "claim"} disabled={!code.trim() || grants.length === 0}>
        {t("ekosistem.accept.continue")}
      </Button>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={close} size="lg" modalLock title={t("ekosistem.accept.title", { peer: peerName })} description={t("ekosistem.accept.description", { peer: peerName })} footer={footer}>
      <div className="flex flex-col gap-4">
        <Stepper
          steps={[
            { id: "code", label: t("ekosistem.accept.stepCode") },
            { id: "review", label: t("ekosistem.accept.stepReview") },
            { id: "done", label: t("ekosistem.accept.stepDone") },
          ]}
          current={step}
        />
        {message ? <ErrorSummary message={message} items={[]} /> : null}
        {done ? (
          <InlineAlert tone="success" title={t("ekosistem.accept.doneTitle", { peer: peerName })} live="status">
            {t("ekosistem.accept.doneBody", { peer: peerName })}
          </InlineAlert>
        ) : accepted ? (
          <>
            <PeerIdentity peer={peer} account={accepted.peer.account} />
            {accepted.explicitConsent.length ? <InlineAlert tone="warning">{t("ekosistem.accept.explicitNote")}</InlineAlert> : null}
            <ScopeChecklist
              scopes={accepted.grants.toPeer}
              value={confirmGrants}
              onChange={setConfirmGrants}
              disabled={pending !== null}
              legend={t("ekosistem.accept.toPeer", { peer: peerName })}
              description={t("ekosistem.accept.toPeerHelp")}
            />
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-medium text-fg">{t("ekosistem.accept.fromPeer", { peer: peerName })}</h3>
              <ScopeList scopes={accepted.grants.fromPeer} />
            </div>
            {withheld.length ? (
              <InlineAlert tone="info">{t("ekosistem.accept.peerWithheld", { peer: peerName, scopes: withheld.map((s) => scopeText.title(s)).join(", ") })}</InlineAlert>
            ) : null}
            <p className="text-sm text-fg-muted">{t("ekosistem.accept.pendingNote")}</p>
          </>
        ) : (
          <form id="accept-code-form" onSubmit={claim} noValidate className="flex flex-col gap-4">
            <Field label={t("ekosistem.accept.code")} description={t("ekosistem.accept.codeHelp", { peer: peerName, prefix })} required>
              <Input value={code} autoComplete="off" spellCheck={false} className="font-mono" placeholder={`${prefix}…`} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <ScopeChecklist
              scopes={grantable(config)}
              value={grants}
              onChange={setGrants}
              disabled={pending !== null}
              legend={t("ekosistem.issue.grantsLegend", { peer: peerName })}
              description={t("ekosistem.issue.grantsHelp")}
            />
          </form>
        )}
      </div>
    </Dialog>
  );
}
