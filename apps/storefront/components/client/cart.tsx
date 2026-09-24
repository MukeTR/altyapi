"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiErrorBody, CartView } from "@/lib/client/cart-types";
import { track } from "@/lib/client/track";
import { formatMoney } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import { interpolate, pickDictionary, type UiDictionaries } from "@/lib/ui-locale";

const TEXT_TR = {
  title: "Sepet",
  close: "Kapat",
  empty: "Sepetiniz boş",
  continueShopping: "Alışverişe devam et",
  checkout: "Ödemeye geç",
  viewCart: "Sepete git",
  quantity: "Adet",
  decrease: "Adedi azalt",
  increase: "Adedi artır",
  remove: "Kaldır",
  onlyAvailable: "Stokta {n} adet var",
  unavailable: "Satışta değil",
  subtotal: "Ara toplam",
  discount: "İndirim",
  shipping: "Kargo",
  total: "Toplam",
  taxIncluded: "KDV dahil: {amount}",
  discountCode: "İndirim kodu",
  apply: "Uygula",
  codeInvalid: "Bu kod geçerli değil.",
  genericError: "Bir hata oluştu.",
};

const TEXT: UiDictionaries<typeof TEXT_TR> = {
  tr: TEXT_TR,
  en: {
    title: "Cart",
    close: "Close",
    empty: "Your cart is empty",
    continueShopping: "Continue shopping",
    checkout: "Checkout",
    viewCart: "View cart",
    quantity: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    remove: "Remove",
    onlyAvailable: "Only {n} available",
    unavailable: "Unavailable",
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Shipping",
    total: "Total",
    taxIncluded: "Includes VAT of {amount}",
    discountCode: "Discount code",
    apply: "Apply",
    codeInvalid: "This code is not valid.",
    genericError: "Something went wrong.",
  },
  de: {
    title: "Warenkorb",
    close: "Schließen",
    empty: "Ihr Warenkorb ist leer",
    continueShopping: "Weiter einkaufen",
    checkout: "Zur Kasse",
    viewCart: "Warenkorb ansehen",
    quantity: "Menge",
    decrease: "Menge verringern",
    increase: "Menge erhöhen",
    remove: "Entfernen",
    onlyAvailable: "Nur {n} verfügbar",
    unavailable: "Nicht verfügbar",
    subtotal: "Zwischensumme",
    discount: "Rabatt",
    shipping: "Versand",
    total: "Gesamt",
    taxIncluded: "Inkl. {amount} MwSt.",
    discountCode: "Rabattcode",
    apply: "Einlösen",
    codeInvalid: "Dieser Code ist ungültig.",
    genericError: "Es ist ein Fehler aufgetreten.",
  },
  ar: {
    title: "سلة التسوق",
    close: "إغلاق",
    empty: "سلة التسوق فارغة",
    continueShopping: "متابعة التسوق",
    checkout: "إتمام الشراء",
    viewCart: "عرض السلة",
    quantity: "الكمية",
    decrease: "إنقاص الكمية",
    increase: "زيادة الكمية",
    remove: "إزالة",
    onlyAvailable: "المتوفر {n} فقط",
    unavailable: "غير متوفر",
    subtotal: "المجموع الفرعي",
    discount: "الخصم",
    shipping: "الشحن",
    total: "الإجمالي",
    taxIncluded: "شامل ضريبة القيمة المضافة: {amount}",
    discountCode: "رمز الخصم",
    apply: "تطبيق",
    codeInvalid: "هذا الرمز غير صالح.",
    genericError: "حدث خطأ ما.",
  },
  ru: {
    title: "Корзина",
    close: "Закрыть",
    empty: "Ваша корзина пуста",
    continueShopping: "Продолжить покупки",
    checkout: "Оформить заказ",
    viewCart: "Перейти в корзину",
    quantity: "Количество",
    decrease: "Уменьшить количество",
    increase: "Увеличить количество",
    remove: "Удалить",
    onlyAvailable: "В наличии только {n} шт.",
    unavailable: "Нет в продаже",
    subtotal: "Подытог",
    discount: "Скидка",
    shipping: "Доставка",
    total: "Итого",
    taxIncluded: "Включая НДС: {amount}",
    discountCode: "Промокод",
    apply: "Применить",
    codeInvalid: "Этот код недействителен.",
    genericError: "Произошла ошибка.",
  },
  fr: {
    title: "Panier",
    close: "Fermer",
    empty: "Votre panier est vide",
    continueShopping: "Continuer mes achats",
    checkout: "Passer la commande",
    viewCart: "Voir le panier",
    quantity: "Quantité",
    decrease: "Diminuer la quantité",
    increase: "Augmenter la quantité",
    remove: "Supprimer",
    onlyAvailable: "Seulement {n} disponible(s)",
    unavailable: "Indisponible",
    subtotal: "Sous-total",
    discount: "Remise",
    shipping: "Livraison",
    total: "Total",
    taxIncluded: "Dont TVA\u00a0: {amount}",
    discountCode: "Code promo",
    apply: "Appliquer",
    codeInvalid: "Ce code n'est pas valide.",
    genericError: "Une erreur s'est produite.",
  },
};

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
  /** Storefront path in the page's language ("/checkout" → "/ar/checkout"). */
  localePath: (path: string) => string;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}

/**
 * basePath is the page's language prefix ("" for the default language, "/ar" otherwise);
 * cart and checkout links keep the shopper in that language.
 */
export function CartProvider({ children, basePath = "" }: { children: ReactNode; basePath?: string }) {
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

  const localePath = useCallback((path: string) => (basePath ? `${basePath}${path === "/" ? "" : path}` : path), [basePath]);

  const value = useMemo(
    () => ({ cart, loading, error, open, setOpen, refresh, request, addLine, updateLine, localePath }),
    [cart, loading, error, open, refresh, request, addLine, updateLine, localePath],
  );
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
      {count > 0 && <span className="absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs text-primary-fg">{count}</span>}
    </button>
  );
}

export function QuantityInput({ value, max, onChange, locale }: { value: number; max: number | null; onChange: (v: number) => void; locale: string }) {
  const tx = pickDictionary(TEXT, locale);
  return (
    <div className="inline-flex items-center rounded-button border border-line" role="group" aria-label={tx.quantity}>
      <button type="button" className="px-3 py-1" aria-label={tx.decrease} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <span className="min-w-8 text-center tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className="px-3 py-1" aria-label={tx.increase} disabled={max !== null && value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function CartLines({ locale, mediaBase, compact = false }: { locale: string; mediaBase: string | null; compact?: boolean }) {
  const { cart, updateLine } = useCart();
  if (!cart?.lines.length) return null;
  const tx = pickDictionary(TEXT, locale);
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
                {l.issues.includes("insufficient_stock") && l.availableQuantity !== null ? interpolate(tx.onlyAvailable, { n: l.availableQuantity }) : tx.unavailable}
              </span>
            )}
            <div className="mt-auto flex items-center justify-between gap-2">
              <QuantityInput value={l.quantity} max={l.availableQuantity} onChange={(q) => void updateLine(l.id, q)} locale={locale} />
              <span className="text-end">
                {BigInt(l.discount) > 0n && <s className="me-2 text-muted-fg">{formatMoney(l.subtotal, cart.currency, locale)}</s>}
                <strong>{formatMoney(l.total, cart.currency, locale)}</strong>
              </span>
            </div>
          </div>
          {!compact && (
            <button type="button" onClick={() => void updateLine(l.id, 0)} className="self-start text-xs text-muted-fg underline">
              {tx.remove}
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
  const tx = pickDictionary(TEXT, locale);
  const row = (label: string, amount: string, negative = false) => (
    <div className="flex justify-between">
      <dt className="text-muted-fg">{label}</dt>
      <dd>{negative && BigInt(amount) > 0n ? "−" : ""}{formatMoney(amount, cart.currency, locale)}</dd>
    </div>
  );
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {row(tx.subtotal, cart.totals.subtotal)}
      {BigInt(cart.totals.discountTotal) > 0n && row(tx.discount, cart.totals.discountTotal, true)}
      {cart.shipping && row(tx.shipping, cart.totals.shippingTotal)}
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
        <dt>{tx.total}</dt>
        <dd>{formatMoney(cart.totals.total, cart.currency, locale)}</dd>
      </div>
      <p className="text-xs text-muted-fg">{interpolate(tx.taxIncluded, { amount: formatMoney(cart.totals.taxTotal, cart.currency, locale) })}</p>
    </dl>
  );
}

export function CartDrawer({ locale, mediaBase }: { locale: string; mediaBase: string | null }) {
  const { cart, open, setOpen, localePath } = useCart();
  const tx = pickDictionary(TEXT, locale);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside data-scheme="default" className="flex h-full w-full max-w-md flex-col p-6 shadow-xl" role="dialog" aria-modal="true" aria-label={tx.title}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl">{tx.title}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label={tx.close} className="text-2xl">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{cart?.lines.length ? <CartLines locale={locale} mediaBase={mediaBase} compact /> : <p className="text-muted-fg">{tx.empty}</p>}</div>
        {cart?.lines.length ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <CartSummary locale={locale} />
            <a href={localePath("/checkout")} className="btn btn-primary w-full">
              {tx.checkout}
            </a>
            <a href={localePath("/cart")} className="btn btn-outline w-full">
              {tx.viewCart}
            </a>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function CartPage({ locale, mediaBase }: { locale: string; mediaBase: string | null }) {
  const { cart, loading, request, error, localePath } = useCart();
  const [code, setCode] = useState("");
  const tx = pickDictionary(TEXT, locale);
  // The cart loads in the browser; the server-rendered page still carries its H1.
  if (loading) {
    return (
      <div className="py-16 text-center" aria-busy="true">
        <h1 className="mb-4 text-3xl">{tx.title}</h1>
        <p className="text-muted-fg">…</p>
      </div>
    );
  }
  if (!cart?.lines.length) {
    return (
      <div className="py-16 text-center">
        <h1 className="mb-4 text-3xl">{tx.empty}</h1>
        <a href={localePath("/collections/all")} className="btn btn-primary">{tx.continueShopping}</a>
      </div>
    );
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="mb-4 text-3xl">{tx.title}</h1>
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
          <label htmlFor="coupon" className="sr-only">{tx.discountCode}</label>
          <input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tx.discountCode} className="min-w-0 flex-1 rounded-theme border border-line bg-surface px-3 py-2 text-sm uppercase" />
          <button type="submit" className="btn btn-outline px-4 py-2 text-sm">{tx.apply}</button>
        </form>
        {error === "errors.coupon.rejected" && <p role="alert" className="text-sm text-error">{tx.codeInvalid}</p>}
        {cart.couponCodes.map((c) => (
          <p key={c} className="flex justify-between text-sm">
            <span className="font-mono">{c}</span>
            <button type="button" className="underline" onClick={() => void request("DELETE", `/coupons/${c}`)}>
              {tx.remove}
            </button>
          </p>
        ))}
        <CartSummary locale={locale} />
        <a href={localePath("/checkout")} className={`btn btn-primary w-full ${cart.lines.some((l) => !l.available) ? "pointer-events-none opacity-50" : ""}`} aria-disabled={cart.lines.some((l) => !l.available)}>
          {tx.checkout}
        </a>
      </aside>
    </div>
  );
}

export function AddToCart({ variantId, available, label, soldOutLabel, locale }: { variantId: string | null; available: boolean; label: string; soldOutLabel: string; locale: string }) {
  const { addLine, error } = useCart();
  const tx = pickDictionary(TEXT, locale);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <QuantityInput value={qty} max={99} onChange={(v) => setQty(Math.max(1, v))} locale={locale} />
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
      {error && error !== "errors.coupon.rejected" && <p role="alert" className="text-sm text-error">{error === "errors.cart.product_unavailable" ? soldOutLabel : tx.genericError}</p>}
    </div>
  );
}
