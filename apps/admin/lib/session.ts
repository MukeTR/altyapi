import "server-only";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/cookies";

/**
 * The browser never talks to the API directly: the API only accepts cookie-authenticated
 * writes from its configured admin origin, and its cookie is host-only. The admin keeps the API
 * session token in its own httpOnly cookie and sends it to the API as a Bearer token from the
 * server (server components, server actions and the /api/bff proxy).
 */
export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value || null;
}

/** Only callable from server actions and route handlers. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: serverEnv.secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/" });
}

/** Reads the API session token from the API's Set-Cookie header (login and register responses). */
export function sessionTokenFromResponse(res: Response): string | null {
  const name = serverEnv.apiSessionCookieName();
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === name) {
      const value = decodeURIComponent(pair.slice(eq + 1).trim());
      return value || null;
    }
  }
  return null;
}
