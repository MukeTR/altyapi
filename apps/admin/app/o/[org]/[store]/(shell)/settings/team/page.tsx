import type { Metadata } from "next";
import { TeamManager } from "@/components/settings/team-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { Member } from "@/lib/settings/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("team.title") };
}

/** Settings › Team (organization level: GET /v1/organizations/:id/members needs members:read). */
export default async function TeamPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const res = await load<ItemList<Member>>(`/v1/organizations/${ctx.organization.id}/members`);
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("team.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={res.error} />
        </div>
      </div>
    );
  }
  return <TeamManager initial={res.data.items} />;
}
