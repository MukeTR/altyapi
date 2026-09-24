"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiErrorBody, CartView } from "@/lib/client/cart-types";
import { track } from "@/lib/client/track";
import { formatMoney } from "@/lib/format";
import { mediaUrl } from "@/lib/media";

interface CartContextValue {
  cart: CartView | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  setOpen: (v: boolean) => void;
  refresh: () => Promise<void>;
  request: (method: string, path: string, body?: unknown) => Promise<CartView | null>;
  addLine: (variantId: string, quantity: number) => Promise<boolean>;
  updateLine: (lineId: string, quantity: number) => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const request = useCallback(async (method: string, path: string, body?: unknown): Promise<CartView | null> => {
    setError(null);
    const res = await fetch(`/api/cart${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as (CartView & ApiErrorBody & { cart?: CartView | null }) | null;
    if (!res.ok) {
      setError(data?.error?.message_key ?? "errors.network");
      return null;
    }
    const next = data && "cart" in data && data.cart !== undefined ? data.cart : (data as CartView);
    setCart(next ?? null);
    return next ?? null;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await request("GET", "");
    setLoading(false);
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addLine = useCallback(
    async (variantId: string, quantity: number) => {
      const next = await request("POST", "/lines", { variantId, quantity });
      if (next) {
        setOpen(true);
        const line = next.lines.find((l) => l.variantId === variantId);
        track("product_added_to_cart", {
          variantId,
          quantity,
          value: line ? String(BigInt(line.unitPrice) * BigInt(quantity)) : undefined,
          currency: next.currency,
          items: line ? [{ itemId: variantId, productId: line.productId, title: line.title, unitPrice: line.unitPrice, quantity }] : [],
        });
      }
      return Boolean(next);
    },
    [request],
  );

  const updateLine = useCallback(
    async (lineId: string, quantity: number) => {
      await request("PATCH", `/lines/${lineId}`, { quantity });
    },
    [request],
  );

  const value = useMemo(() => ({ cart, loading, error, open, setOpen, refresh, request, addLine, updateLine }), [cart, loading, error, open, refresh, request, addLine, updateLine]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartButton({ label, locale }: { label: string; locale: string }) {
  const { cart, setOpen } = useCart();
  const count = cart?.itemCount ?? 0;
  return (
    <button type="button" onClick={() => setOpen(true)} className="relative p-2" aria-label={`${label} (${count})`} data-locale={locale}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M6 7h12l-1 13H7L6 7Z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs text-primary-fg">{count}</span>}
    </button>
  );
}

export function QuantityInput({ value, max, onChange, label }: { value: number; max: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center rounded-button border border-line" role="group" aria-label={label}>
      <button type="button" className="px-3 py-1" aria-label="-" onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <span className="min-w-8 text-center tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className="px-3 py-1" aria-label="+" disabled={max !== null && value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function CartLines({ locale, mediaBase, compact = false }: { locale: string; mediaBase: string | null; compact?: boolean }) {
  const { cart, updateLine } = useCart();
  if (!cart?.lines.length) return null;
  return (
    <ul className="divide-y divide-line">
      {cart.lines.map((l) => (
        <li key={l.id} className="flex gap-4 py-4">
          <div className="h-20 w-16 shrink-0 overflow-hidden rounded-theme bg-muted">
            {l.imageObjectKey && <img src={mediaUrl(mediaBase, l.imageObjectKey, "thumbnail") ?? undefined} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="flex flex-1 flex-col gap-1 text-sm">
            <a href={l.handle ? `/products/${l.handle}` : "#"} className="font-medium">{l.title}</a>
            {l.variantTitle && <span className="text-muted-fg">{l.variantTitle}</span>}
            {!l.available && (
              <span className="text-error">
                {l.issues.includes("insufficient_stock") && l.availableQuantity !== null
                  ? locale === "en"
                    ? `Only ${l.availableQuantity} available`
                    : `Stokta ${l.availableQuantity} adet var`
                  : locale === "en"
                    ? "Unavailable"
                    : "Satışta değil"}
              </span>
            )}
            <div className="mt-auto flex items-center justify-between gap-2">
              <QuantityInput value={l.quantity} max={l.availableQuantity} onChange={(q) => void updateLine(l.id, q)} label={locale === "en" ? "Quantity" : "Adet"} />
              <span className="text-right">
                {BigInt(l.discount) > 0n && <s className="mr-2 text-muted-fg">{formatMoney(l.subtotal, cart.currency, locale)}</s>}
                <strong>{formatMoney(l.total, cart.currency, locale)}</strong>
              </span>
            </div>
          </div>
          {!compact && (
            <button type="button" onClick={() => void updateLine(l.id, 0)} className="self-start text-xs text-muted-fg underline">
              {locale === "en" ? "Remove" : "Kaldır"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CartSummary({ locale }: { locale: string }) {
  const { cart } = useCart();
  if (!cart) return null;
  const row = (label: string, amount: string, negative = false) => (
    <div className="flex justify-between">
      <dt className="text-muted-fg">{label}</dt>
      <dd>{negative && BigInt(amount) > 0n ? "−" : ""}{formatMoney(amount, cart.currency, locale)}</dd>
    </div>
  );
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {row(locale === "en" ? "Subtotal" : "Ara toplam", cart.totals.subtotal)}
      {BigInt(cart.totals.discountTotal) > 0n && row(locale === "en" ? "Discount" : "İndirim", cart.totals.discountTotal, true)}
      {cart.shipping && row(locale === "en" ? "Shipping" : "Kargo", cart.totals.shippingTotal)}
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
        <dt>{locale === "en" ? "Total" : "Toplam"}</dt>
        <dd>{formatMoney(cart.totals.total, cart.currency, locale)}</dd>
      </div>
      <p className="text-xs text-muted-fg">
        {locale === "en" ? "Includes VAT of " : "KDV dahil: "}
        {formatMoney(cart.totals.taxTotal, cart.currency, locale)}
      </p>
    </dl>
  );
}

export function CartDrawer({ locale, mediaBase, labels }: { locale: string; mediaBase: string | null; labels: { cart: string; close: string; checkout: string; viewCart: string; empty: string } }) {
  const { cart, open, setOpen } = useCart();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside data-scheme="default" className="flex h-full w-full max-w-md flex-col p-6 shadow-xl" role="dialog" aria-modal="true" aria-label={labels.cart}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl">{labels.cart}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="text-2xl">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{cart?.lines.length ? <CartLines locale={locale} mediaBase={mediaBase} compact /> : <p className="text-muted-fg">{labels.empty}</p>}</div>
        {cart?.lines.length ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <CartSummary locale={locale} />
            <a href="/checkout" className="btn btn-primary w-full">
              {labels.checkout}
            </a>
            <a href="/cart" className="btn btn-outline w-full">
              {labels.viewCart}
            </a>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function CartPage({ locale, mediaBase }: { locale: string; mediaBase: string | null }) {
  const { cart, loading, request, error } = useCart();
  const [code, setCode] = useState("");
  if (loading) return <p className="py-16 text-center text-muted-fg" aria-busy="true">…</p>;
  if (!cart?.lines.length) {
    return (
      <div className="py-16 text-center">
        <h1 className="mb-4 text-3xl">{locale === "en" ? "Your cart is empty" : "Sepetiniz boş"}</h1>
        <a href="/collections/all" className="btn btn-primary">{locale === "en" ? "Continue shopping" : "Alışverişe devam et"}</a>
      </div>
    );
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="mb-4 text-3xl">{locale === "en" ? "Cart" : "Sepet"}</h1>
        <CartLines locale={locale} mediaBase={mediaBase} />
      </div>
      <aside className="flex flex-col gap-4 rounded-theme border border-line p-6 lg:self-start">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) return;
            const ok = await request("POST", "/coupons", { code });
            if (ok) {
              track("coupon_applied", { code: code.toUpperCase() });
              setCode("");
            }
          }}
        >
          <label htmlFor="coupon" className="sr-only">{locale === "en" ? "Discount code" : "İndirim kodu"}</label>
          <input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder={locale === "en" ? "Discount code" : "İndirim kodu"} className="min-w-0 flex-1 rounded-theme border border-line bg-surface px-3 py-2 text-sm uppercase" />
          <button type="submit" className="btn btn-outline px-4 py-2 text-sm">{locale === "en" ? "Apply" : "Uygula"}</button>
        </form>
        {error === "errors.coupon.rejected" && <p role="alert" className="text-sm text-error">{locale === "en" ? "This code is not valid." : "Bu kod geçerli değil."}</p>}
        {cart.couponCodes.map((c) => (
          <p key={c} className="flex justify-between text-sm">
            <span className="font-mono">{c}</span>
            <button type="button" className="underline" onClick={() => void request("DELETE", `/coupons/${c}`)}>
              {locale === "en" ? "Remove" : "Kaldır"}
            </button>
          </p>
        ))}
        <CartSummary locale={locale} />
        <a href="/checkout" className={`btn btn-primary w-full ${cart.lines.some((l) => !l.available) ? "pointer-events-none opacity-50" : ""}`} aria-disabled={cart.lines.some((l) => !l.available)}>
          {locale === "en" ? "Checkout" : "Ödemeye geç"}
        </a>
      </aside>
    </div>
  );
}

export function AddToCart({ variantId, available, label, soldOutLabel }: { variantId: string | null; available: boolean; label: string; soldOutLabel: string }) {
  const { addLine, error } = useCart();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <QuantityInput value={qty} max={99} onChange={(v) => setQty(Math.max(1, v))} label="Adet" />
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={!variantId || !available || busy}
          onClick={async () => {
            if (!variantId) return;
            setBusy(true);
            await addLine(variantId, qty);
            setBusy(false);
          }}
        >
          {available ? label : soldOutLabel}
        </button>
      </div>
      {error && error !== "errors.coupon.rejected" && <p role="alert" className="text-sm text-error">{error === "errors.cart.product_unavailable" ? soldOutLabel : "Bir hata oluştu."}</p>}
    </div>
  );
}
