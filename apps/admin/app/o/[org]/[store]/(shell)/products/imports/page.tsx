import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { ImportsView } from "@/components/imports/imports-view";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { ImportJob, ImportProfile } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("imports.title") };
}

/** Import history (last 50 jobs) and saved column mappings. */
export default async function ImportsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const [jobs, profiles] = await Promise.all([load<ItemList<ImportJob>>(`${ctx.apiBase}/imports`), load<ItemList<ImportProfile>>(`${ctx.apiBase}/imports/profiles`)]);
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={t("imports.title")}
        breadcrumbs={[{ label: t("products.title"), href: `${ctx.basePath}/products` }]}
        actions={
          ctx.permissions.includes("catalog:write") ? (
            <ButtonLink href={`${ctx.basePath}/products/imports/new`} variant="primary">
              <Upload aria-hidden="true" />
              {t("imports.actions.new")}
            </ButtonLink>
          ) : null
        }
      />
      <ImportsView jobs={jobs} profiles={profiles.ok ? profiles.data.items : []} />
    </div>
  );
}
