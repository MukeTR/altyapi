"use client";

import { BadgeCheck } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { KeyValue } from "@/components/data/key-value";
import type { LinkAccount, Peer } from "@/lib/ekosistem/types";

/** The peer account's identity as the peer verified it during the handshake. */
export function PeerIdentity({ peer, account }: { peer: Peer; account: LinkAccount | null }) {
  const { t } = useI18n();
  if (!account) return null;
  return (
    <section aria-label={t("ekosistem.identity.title")} className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/60 p-3">
      <h3 className="flex items-center gap-1.5 text-base font-medium text-fg">
        <BadgeCheck aria-hidden="true" className="size-4 text-success" />
        {t("ekosistem.identity.title")}
      </h3>
      <KeyValue
        items={[
          { label: t("ekosistem.identity.account", { peer: t(`ekosistem.peers.${peer}.name`) }), value: account.label },
          ...(account.verifiedDomain ? [{ label: t("ekosistem.identity.domain"), value: account.verifiedDomain, mono: true }] : []),
          ...(account.ownerEmailMasked ? [{ label: t("ekosistem.identity.owner"), value: account.ownerEmailMasked, mono: true }] : []),
          { label: t("ekosistem.identity.id"), value: account.id, mono: true },
        ]}
      />
    </section>
  );
}
