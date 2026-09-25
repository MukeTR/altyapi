import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { apiResult, type ApiRequest, type ApiResult } from "./server";

/** Path of the page being rendered, set by proxy.ts, used to come back after signing in again. */
export async function currentPath(): Promise<string> {
  return (await headers()).get("x-admin-path") || "/";
}

/** Ends the request by sending the user through /api/session/expired (clears the cookie) to /login. */
export async function redirectToLogin(): Promise<never> {
  redirect(`/api/session/expired?next=${encodeURIComponent(await currentPath())}`);
}

export interface LoadOptions extends ApiRequest {
  /** Render the nearest not-found.tsx on 404 (for record pages). Defaults to false. */
  notFoundOn404?: boolean;
}

/**
 * Data loading for server components and layouts. A 401 (expired or revoked session) sends the
 * user to sign in again; with `notFoundOn404` a 404 renders not-found; every other failure is
 * returned so the page can show an ErrorState with the localized message and support code.
 */
export async function load<T>(path: string, opts: LoadOptions = {}): Promise<ApiResult<T>> {
  const { notFoundOn404, ...req } = opts;
  const result = await apiResult<T>(path, req);
  if (!result.ok) {
    if (result.error.status === 401) await redirectToLogin();
    if (notFoundOn404 && result.error.status === 404) notFound();
  }
  return result;
}
