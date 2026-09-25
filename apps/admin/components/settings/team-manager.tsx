"use client";

import { MailPlus, Pencil, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ErrorSummary } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ItemList, RoleGrant } from "@/lib/api/types";
import type { InviteResult, Member } from "@/lib/settings/types";
import { RoleGrantsEditor } from "./role-grants-editor";

const FIELD_FOR_KEY = { "errors.member.already_member": "email", "errors.member.already_invited": "email" };

function useMembersApi() {
  const { organization } = useStore();
  const base = `/v1/organizations/${organization.id}/members`;
  return {
    list: () => bff<ItemList<Member>>(base),
    invite: (body: { email: string; roles: RoleGrant[] }) => bff<InviteResult>(`${base}/invitations`, { method: "POST", body }),
    setRoles: (memberId: string, roles: RoleGrant[]) => bff<void>(`${base}/${memberId}/roles`, { method: "PUT", body: { roles } }),
  };
}

function RolesDialog({ member, open, onOpenChange, onSaved }: { member: Member | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { t, describeError } = useI18n();
  const { stores, grants } = useStore();
  const api = useMembersApi();
  const { toast } = useToast();
  // Keyed by member id by the caller, so the initial roles are the member's current roles.
  const [roles, setRoles] = useState<RoleGrant[]>(member?.roles.length ? member.roles : [{ role: "analyst", storeId: null }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setPending(true);
    setError(null);
    try {
      await api.setRoles(member.id, roles);
      toast({ tone: "success", title: t("team.rolesSaved", { name: member.name ?? member.email ?? "" }) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };
  const canGrantOwner = grants.some((g) => g.role === "organization_owner");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("team.editRolesTitle")}
      description={member ? t("team.editRolesDescription", { name: member.name ?? member.email ?? "" }) : undefined}
      size="lg"
      modalLock
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="member-roles-form" variant="primary" loading={pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="member-roles-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error ? <ErrorSummary message={describeError(error).message} items={[]} /> : null}
        <RoleGrantsEditor value={roles} onChange={setRoles} stores={stores} canGrantOwner={canGrantOwner} disabled={pending} idPrefix="edit" />
        <p className="text-sm text-fg-muted">{t("team.rolesReplaceNote")}</p>
      </form>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange, onInvited }: { open: boolean; onOpenChange: (open: boolean) => void; onInvited: (email: string) => void }) {
  const { t, describeError } = useI18n();
  const { stores, store, grants } = useStore();
  const api = useMembersApi();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<RoleGrant[]>([{ role: "analyst", storeId: store.id }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const described = error ? describeError(error, FIELD_FOR_KEY) : null;
  const reset = () => {
    setEmail("");
    setRoles([{ role: "analyst", storeId: store.id }]);
    setError(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.invite({ email: email.trim(), roles });
      onInvited(email.trim());
      reset();
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };
  const emailError = described?.fields.email ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={t("team.inviteTitle")}
      description={t("team.inviteDescription")}
      size="lg"
      modalLock
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="member-invite-form" variant="primary" loading={pending}>
            {t("team.inviteSubmit")}
          </Button>
        </>
      }
    >
      <form id="member-invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {described && !emailError ? <ErrorSummary message={described.message} items={[]} /> : null}
        {emailError ? <ErrorSummary items={[{ fieldId: "invite-email", message: emailError, label: t("team.email") }]} /> : null}
        <InlineAlert tone="warning" title={t("team.inviteDeliveryTitle")}>
          {t("team.inviteDeliveryBody")}
        </InlineAlert>
        <Field id="invite-email" label={t("team.email")} required error={emailError}>
          <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ad@ornek.com" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("team.roles")}</legend>
          <RoleGrantsEditor value={roles} onChange={setRoles} stores={stores} canGrantOwner={grants.some((g) => g.role === "organization_owner")} disabled={pending} idPrefix="invite" />
        </fieldset>
      </form>
    </Dialog>
  );
}

/** Settings › Team: organization members with their roles, role changes and invitations. */
export function TeamManager({ initial }: { initial: Member[] }) {
  const { t } = useI18n();
  const { user, stores, organization, organizationPermissions } = useStore();
  const api = useMembersApi();
  const { toast, toastError } = useToast();
  const [members, setMembers] = useState(initial);
  const [editing, setEditing] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const canManage = organizationPermissions.includes("members:manage");

  const reload = async () => {
    try {
      setMembers((await api.list()).items);
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    }
  };

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? t("team.unknownStore", { id: id.slice(0, 8) });
  const sorted = [...members].sort((a, b) => (a.status === b.status ? (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "") : a.status === "active" ? -1 : 1));

  const columns: Column<Member>[] = [
    {
      id: "member",
      header: t("team.columns.member"),
      sortValue: (m) => m.name ?? m.email ?? "",
      cell: (m) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 font-medium text-fg">
            {m.name ?? m.email ?? t("common.unknown")}
            {m.userId === user.id ? <Badge tone="accent">{t("team.you")}</Badge> : null}
          </span>
          {m.name && m.email ? <span className="truncate text-sm text-fg-muted">{m.email}</span> : null}
        </span>
      ),
    },
    { id: "status", header: t("team.columns.status"), sortValue: (m) => m.status, cell: (m) => <StatusPill domain="member" value={m.status} /> },
    {
      id: "roles",
      header: t("team.columns.roles"),
      cell: (m) => (
        <ul className="flex flex-col gap-0.5">
          {m.roles.map((r, i) => (
            <li key={i} className="text-sm">
              <span className="text-fg">{t.maybe(`roles.${r.role}`) ?? r.role}</span>
              <span className="text-fg-muted"> · {r.storeId ? storeName(r.storeId) : t("team.scope.all")}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (m) =>
        canManage ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label={t("team.editRolesFor", { name: m.name ?? m.email ?? "" })}>
            <Pencil aria-hidden="true" />
            {t("team.editRoles")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={t("team.title")}
        meta={t("team.meta", { organization: organization.name })}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <MailPlus aria-hidden="true" />
              {t("team.invite")}
            </Button>
          ) : null
        }
      />
      {!canManage ? <InlineAlert tone="info">{t("team.readOnly")}</InlineAlert> : null}
      <Card flush title={t("team.membersTitle")} description={t("team.membersDescription", { count: members.length })}>
        <DataTable
          caption={t("team.membersTitle")}
          columns={columns}
          rows={sorted}
          rowKey={(m) => m.id}
          sortable
          empty={<EmptyState icon={Users} title={t("team.empty")} />}
        />
      </Card>
      <RolesDialog key={editing?.id ?? "none"} member={editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} onSaved={() => void reload()} />
      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onInvited={(email) => {
          toast({ tone: "success", title: t("team.invited", { email }) });
          void reload();
        }}
      />
    </div>
  );
}
