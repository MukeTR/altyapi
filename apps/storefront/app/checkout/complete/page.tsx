import type { Metadata } from "next";
import { getSite } from "@/lib/site";
import { t } from "@/lib/i18n";
import { CheckoutComplete } from "@/components/client/checkout";

/** Title in the shopper's language (the layout appends the store name); never indexed. */
export async function generateMetadata(): Promise<Metadata> {
  const { site } = await getSite();
  return { title: t(site.locale, "orderTitle"), robots: { index: false, follow: false } };
}

export default async function CompletePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { site } = await getSite();
  const sp = await searchParams;
  if (!sp.order || !sp.t) return <p className="container-theme py-16 text-center">—</p>;
  return <CheckoutComplete orderId={sp.order} token={sp.t} failedHint={sp.failed === "1"} locale={site.locale} />;
}
