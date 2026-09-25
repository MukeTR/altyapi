"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, errorFromResponse, type ApiErrorInfo } from "@/lib/api/errors";
import { apiFetch } from "@/lib/api/server";
import type { SessionResponse } from "@/lib/api/types";
import { PREFERENCE_COOKIES, PREFERENCE_MAX_AGE } from "@/lib/cookies";
import { serverEnv } from "@/lib/env";
import { isUiLocale, type UiLocale } from "@/lib/i18n/config";
import { safeNextPath } from "@/lib/redirects";
import { clearSessionCookie, getSessionToken, sessionTokenFromResponse, setSessionCookie } from "@/lib/session";

export interface AuthFormState {
  error: ApiErrorInfo | null;
  /** Values echoed back so the form keeps them after a failed submit (never the password). */
  values: { email?: string; name?: string; locale?: string };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** POSTs to login/register anonymously and stores the returned session in the admin cookie. */
async function startSession(path: string, body: Record<string, unknown>): Promise<{ ok: true; session: SessionResponse } | { ok: false; error: ApiErrorInfo }> {
  let res: Response;
  try {
    res = await apiFetch(path, { method: "POST", body, token: null });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.toInfo() };
    throw err;
  }
  if (!res.ok) return { ok: false, error: (await errorFromResponse(res)).toInfo() };
  const token = sessionTokenFromResponse(res);
  const session = (await res.json()) as SessionResponse;
  if (!token) {
    return { ok: false, error: { status: 502, code: "internal", messageKey: "errors.unexpected_response", correlationId: res.headers.get("x-correlation-id") } };
  }
  await setSessionCookie(token, new Date(session.expiresAt));
  return { ok: true, session };
}

async function setLocaleCookie(locale: UiLocale): Promise<void> {
  (await cookies()).set(PREFERENCE_COOKIES.locale, locale, { path: "/", sameSite: "lax", maxAge: PREFERENCE_MAX_AGE, secure: serverEnv.secureCookies() });
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email").trim();
  const result = await startSession("/v1/auth/login", { email, password: field(formData, "password") });
  if (!result.ok) return { error: result.error, values: { email } };
  // First sign-in on this browser: use the account's language.
  const jar = await cookies();
  if (!isUiLocale(jar.get(PREFERENCE_COOKIES.locale)?.value) && isUiLocale(result.session.user.locale)) {
    await setLocaleCookie(result.session.user.locale);
  }
  redirect(safeNextPath(field(formData, "next")));
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = field(formData, "name").trim();
  const email = field(formData, "email").trim();
  const locale = isUiLocale(field(formData, "locale")) ? (field(formData, "locale") as UiLocale) : "tr";
  const result = await startSession("/v1/auth/register", { name, email, password: field(formData, "password"), locale });
  if (!result.ok) return { error: result.error, values: { name, email, locale } };
  await setLocaleCookie(locale);
  redirect("/onboarding");
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      // Revokes the session server-side; the cookie is cleared regardless of the outcome.
      await apiFetch("/v1/auth/logout", { method: "POST", token });
    } catch {
      // API unreachable: the local cookie is still removed below.
    }
  }
  await clearSessionCookie();
  redirect("/login?reason=signed_out");
}
