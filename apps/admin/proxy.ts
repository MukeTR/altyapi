import { NextResponse, type NextRequest } from "next/server";
import { PREFERENCE_COOKIES, PREFERENCE_MAX_AGE, SESSION_COOKIE } from "@/lib/cookies";

const AUTH_PAGES = new Set(["/login", "/register"]);
const STORE_PATH = /^\/o\/([^/]+)\/([^/]+)/;

/**
 * Coarse session gate. Pages without a session cookie redirect to /login (keeping the target
 * in ?next=); whether the session is still valid is decided by the API on the first request,
 * which sends an expired session through /api/session/expired. The proxy also passes the
 * current path to server components and remembers the last opened store.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (AUTH_PAGES.has(pathname)) {
    if (hasSession && !req.nextUrl.searchParams.has("reason")) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/login", req.url);
    const target = `${pathname}${search}`;
    if (target !== "/") url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-admin-path", `${pathname}${search}`);
  const res = NextResponse.next({ request: { headers } });
  const store = STORE_PATH.exec(pathname);
  if (store && req.method === "GET") {
    const value = `${store[1]}/${store[2]}`;
    if (req.cookies.get(PREFERENCE_COOKIES.lastStore)?.value !== value) {
      res.cookies.set(PREFERENCE_COOKIES.lastStore, value, { path: "/", sameSite: "lax", maxAge: PREFERENCE_MAX_AGE, httpOnly: true });
    }
  }
  return res;
}

export const config = {
  // Everything except the BFF and session routes (they answer with JSON or handle the cookie
  // themselves), Next internals and static files.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
