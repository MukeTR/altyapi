import type { Metadata } from "next";
import { TypeSettings } from "@/components/content/type-settings";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { labelText } from "@/lib/content/fields";
import type { ContentTypeDetail, TypeTemplates } from "@/lib/content/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; typeKey: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, typeKey } = await params;
  const { t, locale } = await getI18n();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const type = await load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`);
  return { title: type.ok ? t("content.typeSettings.title", { name: labelText(type.data.labels.namePlural, locale, type.data.key) }) : t("content.title") };
}

/** Content › type settings. */
export default async function TypeSettingsPage({ params }: { params: Params }) {
  const { org, store, typeKey } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const [type, templates] = await Promise.all([
    load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`, { notFoundOn404: true }),
    load<TypeTemplates>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}/templates`),
  ]);
  if (!type.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("content.title")} breadcrumbs={[{ label: t("content.title"), href: `${ctx.basePath}/content` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={type.error} />
        </div>
      </div>
    );
  }
  return <TypeSettings key={type.data.id} initial={type.data} templates={templates} />;
}
