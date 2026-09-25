import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Store } from "lucide-react";
import { CreateStoreForm } from "@/components/tenancy/create-store-form";
import { SetupError } from "@/components/tenancy/setup-error";
import { SetupFrame } from "@/components/tenancy/setup-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { serverEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";
import { getMe, getPermissions, listStores } from "@/lib/store-context";

type Params = Promise<{ org: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org } = await params;
  const me = await getMe();
  return { title: me.ok ? (me.data.organizations.find((o) => o.slug === org)?.name ?? org) : org };
}

/** Opens the organization's last or first store; without stores it offers to create one. */
export default async function OrganizationPage({ params }: { params: Params }) {
  const { org: orgSlug } = await params;
  const { t } = await getI18n();
  const me = await getMe();
  if (!me.ok) return <SetupError error={me.error} />;
  const organization = me.data.organizations.find((o) => o.slug === orgSlug);
  if (!organization) notFound();

  const stores = await listStores(organization.id);
  if (!stores.ok) return <SetupError error={stores.error} />;
  if (stores.data.items.length > 0) {
    const [lastOrg, lastStore] = ((await cookies()).get(PREFERENCE_COOKIES.lastStore)?.value ?? "").split("/");
    const target = (lastOrg === organization.slug && stores.data.items.find((s) => s.slug === lastStore)) || stores.data.items[0]!;
    redirect(`/o/${organization.slug}/${target.slug}`);
  }

  const perms = await getPermissions(organization.id);
  const canCreate = perms.ok && perms.data.permissions.includes("store:manage");
  return (
    <SetupFrame title={organization.name} subtitle={canCreate ? t("shell.createStore.description", { organization: organization.name }) : undefined}>
      {canCreate ? (
        <section aria-label={t("shell.createStore.title")} className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <CreateStoreForm organization={organization} rootDomain={serverEnv.storeRootDomain()} />
        </section>
      ) : (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={Store} title={t("onboarding.noStoreAccess.title")} description={t("onboarding.noStoreAccess.body")} />
        </div>
      )}
    </SetupFrame>
  );
}
