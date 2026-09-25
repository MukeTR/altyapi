import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/tenancy/onboarding-wizard";
import { SetupError } from "@/components/tenancy/setup-error";
import { SetupFrame } from "@/components/tenancy/setup-frame";
import { serverEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";
import { getMe, listStores } from "@/lib/store-context";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("onboarding.metaTitle") };
}

export default async function OnboardingPage() {
  const { t } = await getI18n();
  const me = await getMe();
  if (!me.ok) return <SetupError error={me.error} />;
  // Users who already have a store go straight to it.
  for (const org of me.data.organizations) {
    const stores = await listStores(org.id);
    if (stores.ok && stores.data.items.length > 0) redirect("/");
  }
  return (
    <SetupFrame title={t("onboarding.title")} subtitle={t("onboarding.subtitle")}>
      <OnboardingWizard initialOrganization={me.data.organizations[0] ?? null} rootDomain={serverEnv.storeRootDomain()} />
    </SetupFrame>
  );
}
