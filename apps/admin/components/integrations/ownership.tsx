"use client";

import { Crown } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Field } from "@/components/ui/field";
import { ErrorSummary, FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ItemList } from "@/lib/api/types";
import type { IntegrationConnection, OwnerInfo, OwnershipDomain } from "@/lib/integrations/types";

const ALTYAPI = "altyapi";
const EXTERNAL = "external";

/** Why a connection cannot own a domain (mirrors the API's checks), or null when it can. */
function ownerProblem(domain: OwnershipDomain, c: IntegrationConnection): "cannotReport" | "marketplacePrice" | null {
  const caps = c.capabilities;
  if ((domain === "stock" || domain === "price") && !caps?.readListings) return "cannotReport";
  if (domain === "price" && c.kind === "marketplace") return "marketplacePrice";
  if (domain === "order_fulfillment" && !caps?.readOrders) return "cannotReport";
  return null;
}

function currentChoice(o: OwnerInfo): string {
  if (o.connectionId) return o.connectionId;
  if (o.externalOwnerLabel) return EXTERNAL;
  return ALTYAPI;
}

function DomainSection({ owner, connections, canEdit, onSaved }: { owner: OwnerInfo; connections: IntegrationConnection[]; canEdit: boolean; onSaved: (items: OwnerInfo[]) => void }) {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();
  const { toast } = useToast();
  const [choice, setChoice] = useState(currentChoice(owner));
  const [label, setLabel] = useState(owner.externalOwnerLabel ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const domain = owner.domain;
  const dirty = choice !== currentChoice(owner) || (choice === EXTERNAL && label.trim() !== (owner.externalOwnerLabel ?? ""));
  const selected = connections.find((c) => c.id === choice);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const body =
        choice === ALTYAPI
          ? { domain, ownerConnectionId: null, externalOwnerLabel: null }
          : choice === EXTERNAL
            ? { domain, ownerConnectionId: null, externalOwnerLabel: label.trim() }
            : { domain, ownerConnectionId: choice, externalOwnerLabel: null };
      const res = await bff<ItemList<OwnerInfo>>(`${apiBase}/integrations/ownership`, { method: "PUT", body });
      onSaved(res.items);
      toast({ tone: "success", title: t("integrations.ownership.saved", { domain: t(`integrations.ownership.domains.${domain}.title`) }) });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const options = [
    { value: ALTYAPI, label: t("integrations.ownership.altyapi") },
    ...connections.map((c) => {
      const problem = ownerProblem(domain, c);
      return { value: c.id, label: problem ? `${c.name} — ${t(`integrations.ownership.problems.${problem}`)}` : c.name, disabled: problem !== null };
    }),
    { value: EXTERNAL, label: t("integrations.ownership.external") },
  ];

  return (
    <FormSection
      title={
        <span className="inline-flex items-center gap-2">
          {t(`integrations.ownership.domains.${domain}.title`)}
        </span>
      }
      description={t(`integrations.ownership.domains.${domain}.description`)}
      canEdit={canEdit}
      pending={pending}
      dirty={dirty}
      onCancel={() => {
        setChoice(currentChoice(owner));
        setLabel(owner.externalOwnerLabel ?? "");
        setError(null);
      }}
      onSubmit={() => void save()}
      error={error ? <ErrorSummary message={describeError(error).message} items={[]} /> : null}
    >
      <p className="flex items-center gap-1.5 text-sm text-fg">
        <Crown aria-hidden="true" className="size-4 text-fg-muted" />
        {t("integrations.ownership.current")}:{" "}
        <strong className="font-medium">
          {owner.connectionName ?? owner.externalOwnerLabel ?? t("integrations.ownership.altyapi")}
        </strong>
      </p>
      <Field label={t("integrations.ownership.owner")} description={t(`integrations.ownership.domains.${domain}.effect`)}>
        <Select value={choice} onValueChange={setChoice} options={options} disabled={!canEdit} />
      </Field>
      {choice === EXTERNAL ? (
        <Field label={t("integrations.ownership.externalLabel")} description={t("integrations.ownership.externalLabelHelp")} required>
          <Input value={label} maxLength={80} placeholder="Logo Tiger ERP" onChange={(e) => setLabel(e.target.value)} />
        </Field>
      ) : null}
      {selected && (domain === "stock" || domain === "price") ? (
        <InlineAlert tone="info">
          {(domain === "stock" ? selected.capabilities?.writeStock : selected.capabilities?.writePrice)
            ? t("integrations.ownership.writesGoToOwner", { name: selected.name })
            : t("integrations.ownership.readOnlyOwner", { name: selected.name })}
        </InlineAlert>
      ) : null}
    </FormSection>
  );
}

/**
 * Apps & Integrations › Data ownership: which system is the source of truth for stock, prices,
 * product content and order fulfillment. Writes in altyapi follow this map (applied here, sent to
 * the owning integrator, or turned into advice to change the value at the owner).
 */
export function Ownership({ initial, connections }: { initial: OwnerInfo[]; connections: IntegrationConnection[] }) {
  const { t } = useI18n();
  const { can } = useStore();
  const [items, setItems] = useState(initial);
  const canEdit = can("integrations:manage");
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader title={t("integrations.ownership.title")} meta={t("integrations.ownership.meta")} />
      {!canEdit ? <InlineAlert tone="info">{t("integrations.ownership.readOnly")}</InlineAlert> : null}
      {connections.length === 0 ? <InlineAlert tone="info">{t("integrations.ownership.noConnections")}</InlineAlert> : null}
      {items.map((o) => (
        <DomainSection key={`${o.domain}-${o.connectionId ?? ""}-${o.externalOwnerLabel ?? ""}`} owner={o} connections={connections} canEdit={canEdit} onSaved={setItems} />
      ))}
    </div>
  );
}
