import "server-only";
import { cookies, headers } from "next/headers";

export interface Tenant {
  storeId: string | null;
  devHost: string | null;
  host: string;
  path: string;
  search: string;
  previewToken: string | null;
}

/** Tenant established by proxy.ts (never from client-controlled headers). */
export async function getTenant(): Promise<Tenant> {
  const h = await headers();
  const c = await cookies();
  return {
    storeId: h.get("x-sf-store-id"),
    devHost: h.get("x-sf-dev-host"),
    host: h.get("x-sf-host") ?? "",
    path: h.get("x-sf-path") ?? "/",
    search: h.get("x-sf-search") ?? "",
    previewToken: c.get("altyapi_preview")?.value ?? null,
  };
}

/** Locale segment of the current path, if it is one of the store's non-default locales. */
export function localeFromPath(path: string, supported: string[], defaultLocale: string): string {
  const seg = path.split("/")[1];
  return seg && seg !== defaultLocale && supported.includes(seg) ? seg : defaultLocale;
}
