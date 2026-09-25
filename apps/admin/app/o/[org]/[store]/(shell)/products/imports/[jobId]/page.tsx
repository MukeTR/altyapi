import type { Metadata } from "next";
import { ImportJobView } from "@/components/imports/import-job";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ImportJob } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; jobId: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("imports.job.title") };
}

/** One import job: mapping, preview, run progress and results (polled while the worker runs). */
export default async function ImportJobPage({ params }: { params: Params }) {
  const { org, store, jobId } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const [job, fields] = await Promise.all([
    load<ImportJob>(`${ctx.apiBase}/imports/${encodeURIComponent(jobId)}`, { notFoundOn404: true }),
    load<{ fields: string[] }>("/v1/import-fields"),
  ]);
  if (!job.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("imports.job.title")} breadcrumbs={[{ label: t("imports.title"), href: `${ctx.basePath}/products/imports` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={job.error} />
        </div>
      </div>
    );
  }
  return <ImportJobView initialJob={job.data} fields={fields.ok ? fields.data.fields : Object.keys(job.data.mapping ?? {})} />;
}
