import type { Metadata } from "next";
import { MediaLibrary } from "@/components/media/media-library";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import { MEDIA_KINDS, MEDIA_PAGE_SIZE, type Asset, type MediaKind } from "@/lib/media/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("media.title") };
}

/** Storefront › Media: the store's media library (first page of the chosen file type). */
export default async function MediaPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const raw = (await searchParams).kind;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const kind: MediaKind = MEDIA_KINDS.includes(requested as MediaKind) ? (requested as MediaKind) : "image";
  const res = await load<ItemList<Asset>>(`${ctx.apiBase}/assets`, { query: { kind: kind === "all" ? undefined : kind, limit: MEDIA_PAGE_SIZE } });
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <PageHeader title={t("media.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      </div>
    );
  }
  return <MediaLibrary key={kind} initial={res.data.items} kind={kind} />;
}
