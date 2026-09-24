import type { Metadata } from "next";
import { getSite } from "@/lib/site";
import { t } from "@/lib/i18n";
import { CheckoutFlow } from "@/components/client/checkout";

/** Title in the shopper's language (the layout appends the store name); never indexed. */
export async function generateMetadata(): Promise<Metadata> {
  const { site } = await getSite();
  return { title: t(site.locale, "checkoutTitle"), robots: { index: false, follow: false } };
}

export default async function CheckoutPage() {
  const { site } = await getSite();
  return (
    <div className="container-theme py-10">
      <CheckoutFlow locale={site.locale} mediaBase={site.mediaBaseUrl} />
    </div>
  );
}
