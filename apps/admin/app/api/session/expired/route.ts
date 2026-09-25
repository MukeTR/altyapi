import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/cookies";
import { safeNextPath } from "@/lib/redirects";

/**
 * Server components cannot modify cookies, so an expired or revoked session is sent here: the
 * stale cookie is removed and the user signs in again, returning to where they were.
 */
export function GET(req: NextRequest) {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const url = new URL("/login", req.url);
  url.searchParams.set("reason", "expired");
  if (next !== "/") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  res.headers.set("cache-control", "no-store");
  return res;
}
