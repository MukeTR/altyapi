import type { Metadata } from "next";
import { SiteProfileForm } from "@/components/site/site-profile-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { getI18n } from "@/lib/i18n/server";
import type { SiteProfile } from "@/lib/site/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.profile.title") };
}

/** Site › profile. */
export default async function SiteProfilePage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const profile = await load<SiteProfile>(`${ctx.apiBase}/site`);
  if (!profile.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("site.profile.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={profile.error} />
        </div>
      </div>
    );
  }
  return <SiteProfileForm initial={profile.data} />;
}
