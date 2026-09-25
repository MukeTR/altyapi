import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SetupError } from "@/components/tenancy/setup-error";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { getMe, listStores } from "@/lib/store-context";

/** Resolver: last opened store → first store of the first organization that has one → onboarding. */
export default async function HomePage() {
  const me = await getMe();
  if (!me.ok) return <SetupError error={me.error} />;
  const organizations = me.data.organizations;
  if (organizations.length === 0) redirect("/onboarding");

  const [lastOrg, lastStore] = ((await cookies()).get(PREFERENCE_COOKIES.lastStore)?.value ?? "").split("/");
  const remembered = organizations.find((o) => o.slug === lastOrg);
  if (remembered && lastStore) {
    const stores = await listStores(remembered.id);
    if (stores.ok && stores.data.items.some((s) => s.slug === lastStore)) redirect(`/o/${remembered.slug}/${lastStore}`);
  }
  for (const org of organizations) {
    const stores = await listStores(org.id);
    const first = stores.ok ? stores.data.items[0] : undefined;
    if (first) redirect(`/o/${org.slug}/${first.slug}`);
  }
  redirect(`/o/${organizations[0]!.slug}`);
}
