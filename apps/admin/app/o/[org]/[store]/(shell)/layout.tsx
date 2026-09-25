import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { serverEnv } from "@/lib/env";

/**
 * Screens with the admin chrome. A new screen is a folder here, e.g. (shell)/orders/page.tsx,
 * with loading.tsx for its skeleton; set `ready: true` on its entry in lib/nav.ts to show it.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const collapsed = (await cookies()).get(PREFERENCE_COOKIES.sidebar)?.value === "1";
  return (
    <AppShell initialCollapsed={collapsed} rootDomain={serverEnv.storeRootDomain()}>
      {children}
    </AppShell>
  );
}
