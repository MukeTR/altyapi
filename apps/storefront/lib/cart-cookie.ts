import "server-only";
import { cookies } from "next/headers";

export const CART_COOKIE = "altyapi_cart";

export async function getCartToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

export async function setCartToken(token: string) {
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    secure: (process.env.APP_ENV ?? "local") !== "local",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearCartToken() {
  (await cookies()).delete(CART_COOKIE);
}
