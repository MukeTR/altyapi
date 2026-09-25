"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Stepper } from "@/components/ui/stepper";
import type { OrganizationSummary } from "@/lib/api/types";
import { CreateOrganizationForm } from "./create-organization-form";
import { CreateStoreForm } from "./create-store-form";

/** First organization (skipped when the user already has one), then the first store. */
export function OnboardingWizard({ initialOrganization, rootDomain }: { initialOrganization: OrganizationSummary | null; rootDomain: string }) {
  const { t } = useI18n();
  const [organization, setOrganization] = useState(initialOrganization);
  const onCreated = useCallback((org: OrganizationSummary) => setOrganization(org), []);
  const steps = [
    { id: "organization", label: t("onboarding.steps.organization") },
    { id: "store", label: t("onboarding.steps.store") },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Stepper steps={steps} current={organization ? 1 : 0} aria-label={t("onboarding.steps.label")} />
      <section aria-labelledby="onboarding-step" className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex flex-col gap-1">
          <h2 id="onboarding-step" className="text-lg font-semibold text-fg">
            {organization ? t("onboarding.store.title") : t("onboarding.organization.title")}
          </h2>
          <p className="text-base text-fg-muted">{organization ? t("onboarding.store.description") : t("onboarding.organization.description")}</p>
        </div>
        {organization ? <CreateStoreForm organization={organization} rootDomain={rootDomain} /> : <CreateOrganizationForm onCreated={onCreated} />}
      </section>
    </div>
  );
}
