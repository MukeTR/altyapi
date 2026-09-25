import type { Metadata } from "next";
import { BrandProfileForm } from "@/components/settings/brand-profile-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { BrandProfile } from "@/lib/ekosistem/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("brand.title") };
}

/** Settings › Brand profile (settings:read), served to linked peers on GET /ekosistem/v1/brand. */
export default async function BrandPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<BrandProfile>(`${ctx.apiBase}/ekosistem/brand-profile`);
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("brand.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      </div>
    );
  }
  return <BrandProfileForm initial={res.data} />;
}
