import type { Metadata } from "next";
import { PaymentsManager } from "@/components/settings/payments-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { PaymentConnection, PaymentProviderDefinition } from "@/lib/settings/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("payments.title") };
}

/** Settings › Payments: provider catalog (public) and the store's connections (payments:read). */
export default async function PaymentsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const [providers, connections] = await Promise.all([
    load<ItemList<PaymentProviderDefinition>>("/v1/payment-providers"),
    load<ItemList<PaymentConnection>>(`${ctx.apiBase}/payment-connections`),
  ]);
  const failed = !providers.ok ? providers.error : !connections.ok ? connections.error : null;
  if (failed || !providers.ok || !connections.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("payments.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={failed} />
        </div>
      </div>
    );
  }
  return <PaymentsManager providers={providers.data.items} initial={connections.data.items} />;
}
