import type { Metadata } from "next";
import { getSite } from "@/lib/site";
import { CheckoutFlow } from "@/components/client/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default async function CheckoutPage() {
  const { site } = await getSite();
  return (
    <div className="container-theme py-10">
      <CheckoutFlow locale={site.locale} mediaBase={site.mediaBaseUrl} />
    </div>
  );
}
