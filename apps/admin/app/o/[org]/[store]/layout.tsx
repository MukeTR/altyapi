import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreProvider } from "@/components/providers/store-provider";
import { SetupError } from "@/components/tenancy/setup-error";
import { getStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store } = await params;
  const ctx = await getStoreContext(org, store);
  const name = ctx.ok ? ctx.data.store.name : store;
  return { title: { template: `%s · ${name} · altyapi`, default: `${name} · altyapi` } };
}

/**
 * Loads the store context once per request (user, organizations, stores, effective
 * permissions) and provides it to every screen below. It renders no chrome itself: the shell
 * and the full-screen editor add their own.
 */
export default async function StoreLayout({ params, children }: { params: Params; children: ReactNode }) {
  const { org, store } = await params;
  const ctx = await getStoreContext(org, store);
  if (!ctx.ok) return <SetupError error={ctx.error} />;
  return <StoreProvider value={ctx.data}>{children}</StoreProvider>;
}
