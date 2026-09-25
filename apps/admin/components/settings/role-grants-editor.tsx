"use client";

import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { RoleGrant, Store } from "@/lib/api/types";
import type { Role } from "@/lib/permissions";

/** Roles in the order the API defines them (packages/auth ROLES). */
export const ROLE_LIST = ["organization_owner", "store_admin", "catalog_manager", "order_manager", "marketing_manager", "analyst", "developer"] as const satisfies readonly Role[];

const ALL_STORES = "__all__";

export interface RoleGrantsEditorProps {
  value: RoleGrant[];
  onChange: (next: RoleGrant[]) => void;
  stores: readonly Store[];
  /** Only organization owners may grant the owner role. */
  canGrantOwner: boolean;
  disabled?: boolean;
  /** Prefix for control ids (error summary links). */
  idPrefix: string;
}

/** Editable list of role grants: each row is a role and its scope (every store or one store). */
export function RoleGrantsEditor({ value, onChange, stores, canGrantOwner, disabled, idPrefix }: RoleGrantsEditorProps) {
  const { t } = useI18n();
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? t("team.unknownStore", { id: id.slice(0, 8) });
  const update = (index: number, patch: Partial<RoleGrant>) => {
    onChange(
      value.map((g, i) => {
        if (i !== index) return g;
        const next = { ...g, ...patch };
        // The owner role always covers the whole organization.
        return next.role === "organization_owner" ? { ...next, storeId: null } : next;
      }),
    );
  };
  const roleOptions = ROLE_LIST.map((r) => ({ value: r, label: t(`roles.${r}`), disabled: r === "organization_owner" && !canGrantOwner }));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {value.map((grant, i) => {
          const scopeOptions = [
            { value: ALL_STORES, label: t("team.scope.all") },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
            ...(grant.storeId && !stores.some((s) => s.id === grant.storeId) ? [{ value: grant.storeId, label: storeName(grant.storeId) }] : []),
          ];
          return (
            <li key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted/50 p-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <span aria-hidden="true" className="text-sm font-medium text-fg">
                  {t("team.role")}
                </span>
                <Select
                  id={`${idPrefix}-role-${i}`}
                  aria-label={t("team.roleN", { n: i + 1 })}
                  value={grant.role}
                  disabled={disabled ?? false}
                  onValueChange={(v) => update(i, { role: v as Role })}
                  options={roleOptions}
                />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <span aria-hidden="true" className="text-sm font-medium text-fg">
                  {t("team.scope.label")}
                </span>
                <Select
                  aria-label={t("team.scopeN", { n: i + 1 })}
                  value={grant.storeId ?? ALL_STORES}
                  disabled={(disabled ?? false) || grant.role === "organization_owner"}
                  onValueChange={(v) => update(i, { storeId: v === ALL_STORES ? null : v })}
                  options={scopeOptions}
                />
              </div>
              <Button
                size="icon-md"
                variant="ghost"
                aria-label={t("team.removeGrant", { n: i + 1 })}
                disabled={(disabled ?? false) || value.length <= 1}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" className="self-start" disabled={disabled ?? false} onClick={() => onChange([...value, { role: "analyst", storeId: null }])}>
        <Plus aria-hidden="true" />
        {t("team.addGrant")}
      </Button>
      {!canGrantOwner ? <p className="text-sm text-fg-muted">{t("team.ownerOnly")}</p> : null}
    </div>
  );
}
