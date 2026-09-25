"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { CreateOrganizationForm } from "@/components/tenancy/create-organization-form";
import { CreateStoreForm } from "@/components/tenancy/create-store-form";
import { Dialog } from "@/components/ui/dialog";

export function CreateStoreDialog({ open, onOpenChange, rootDomain }: { open: boolean; onOpenChange: (open: boolean) => void; rootDomain: string }) {
  const { t } = useI18n();
  const { organization } = useStore();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      modalLock
      title={t("shell.createStore.title")}
      description={t("shell.createStore.description", { organization: organization.name })}
    >
      {open ? <CreateStoreForm organization={organization} rootDomain={rootDomain} onCancel={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modalLock title={t("shell.createOrganization.title")} description={t("shell.createOrganization.description")}>
      {open ? <CreateOrganizationForm redirectToOrganization onCancel={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}
