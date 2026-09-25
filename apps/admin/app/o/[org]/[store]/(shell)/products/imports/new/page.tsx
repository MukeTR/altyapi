import type { Metadata } from "next";
import { NewImport } from "@/components/imports/new-import";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { ImportProfile } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("imports.new.title") };
}

export default async function NewImportPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const profiles = await load<ItemList<ImportProfile>>(`${ctx.apiBase}/imports/profiles`);
  return <NewImport profiles={profiles.ok ? profiles.data.items : []} />;
}
