import type { Metadata } from "next";
import { IdentityForm } from "@/components/site/identity-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { getI18n } from "@/lib/i18n/server";
import type { BusinessIdentity } from "@/lib/site/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.identity.title") };
}

/** Site › business identity (künye). */
export default async function IdentityPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const identity = await load<BusinessIdentity>(`${ctx.apiBase}/site/identity`);
  if (!identity.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("site.identity.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={identity.error} />
        </div>
      </div>
    );
  }
  return <IdentityForm key={identity.data.updatedAt ?? "new"} initial={identity.data} />;
}
