"use client";

import { useEffect, useRef, useState } from "react";
import type { AddressView, ApiErrorBody } from "@/lib/client/cart-types";
import { track } from "@/lib/client/track";
import { syncAttribution } from "@/lib/client/attribution";
import { formatMoney } from "@/lib/format";
import { CartLines, CartSummary, useCart } from "./cart";

interface Rate {
  id: string;
  name: string;
  amount: string;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
}

interface PaymentStart {
  orderId: string;
  orderNumber: string;
  statusUrl: string;
  payment: { provider: "paytr" | "iyzico"; kind: string; url: string | null; html: string | null };
}

const T = {
  tr: {
    contact: "İletişim",
    email: "E-posta",
    phone: "Telefon",
    marketing: "Kampanya ve yeniliklerden e-posta ile haberdar olmak istiyorum.",
    shipping: "Teslimat adresi",
    firstName: "Ad",
    lastName: "Soyad",
    address: "Adres",
    district: "Mahalle / Semt",
    city: "İlçe",
    province: "İl",
    postalCode: "Posta kodu",
    identity: "T.C. kimlik no (fatura için, isteğe bağlı)",
    method: "Kargo seçimi",
    free: "Ücretsiz",
    days: "iş günü",
    payment: "Ödeme",
    pay: "Ödemeye geç",
    continue: "Devam et",
    edit: "Düzenle",
    paying: "Güvenli ödeme sayfası yükleniyor…",
    secure: "Kart bilgileriniz ödeme kuruluşu tarafından işlenir; mağaza kart bilgilerinizi görmez.",
    errors: {
      default: "İşlem tamamlanamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
      phone_required: "Bu ödeme yöntemi için telefon numarası gerekli.",
      unavailable_lines: "Sepetinizdeki bazı ürünler artık satışta değil.",
      shipping_method_required: "Lütfen kargo seçin.",
      payment_session_failed: "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.",
      no_active_provider: "Mağaza şu anda online ödeme kabul etmiyor.",
    } as Record<string, string>,
  },
  en: {
    contact: "Contact",
    email: "E-mail",
    phone: "Phone",
    marketing: "E-mail me with news and offers.",
    shipping: "Shipping address",
    firstName: "First name",
    lastName: "Last name",
    address: "Address",
    district: "Neighbourhood",
    city: "District / City",
    province: "Province / State",
    postalCode: "Postal code",
    identity: "National ID (optional, for invoices)",
    method: "Shipping method",
    free: "Free",
    days: "business days",
    payment: "Payment",
    pay: "Continue to payment",
    continue: "Continue",
    edit: "Edit",
    paying: "Loading secure payment page…",
    secure: "Card details are processed by the payment provider; the store never sees them.",
    errors: {
      default: "Could not complete this step. Please check your details and try again.",
      phone_required: "A phone number is required for this payment method.",
      unavailable_lines: "Some items in your cart are no longer available.",
      shipping_method_required: "Please choose a shipping method.",
      payment_session_failed: "Could not open the payment page. Please try again.",
      no_active_provider: "The store is not accepting online payments right now.",
    } as Record<string, string>,
  },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-fg">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "rounded-theme border border-line bg-surface px-3 py-2";

/** Executes the provider's embeddable markup (iyzico checkout form) including its scripts. */
function ProviderMarkup({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '<div id="iyzipay-checkout-form" class="responsive"></div>';
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    tpl.content.querySelectorAll("script").forEach((old) => {
      const s = document.createElement("script");
      for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
      s.text = old.text;
      host.appendChild(s);
    });
  }, [html]);
  return <div ref={ref} />;
}

function PaytrFrame({ url }: { url: string }) {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://www.paytr.com/js/iframeResizer.min.js";
    s.onload = () => (window as unknown as { iFrameResize?: (o: object, sel: string) => void }).iFrameResize?.({}, "#paytriframe");
    document.body.appendChild(s);
    return () => s.remove();
  }, []);
  return <iframe id="paytriframe" src={url} title="PayTR" className="min-h-[640px] w-full border-0" allow="payment" />;
}

export function CheckoutFlow({ locale, mediaBase }: { locale: string; mediaBase: string | null }) {
  const t = locale === "en" ? T.en : T.tr;
  const { cart, loading, request } = useCart();
  const [step, setStep] = useState<"contact" | "address" | "shipping" | "payment">("contact");
  const [rates, setRates] = useState<Rate[]>([]);
  const [methods, setMethods] = useState<{ provider: "paytr" | "iyzico"; requiresPhone: boolean }[]>([]);
  const [provider, setProvider] = useState<"paytr" | "iyzico" | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/payment-methods")
      .then((r) => r.json())
      .then((d: { items?: { provider: "paytr" | "iyzico"; requiresPhone: boolean }[] }) => {
        setMethods(d.items ?? []);
        setProvider(d.items?.[0]?.provider ?? null);
      });
  }, []);

  useEffect(() => {
    if (cart?.lines.length && step === "contact") {
      track("checkout_started", {
        value: cart.totals.total,
        currency: cart.currency,
        items: cart.lines.map((l) => ({ itemId: l.variantId, productId: l.productId, title: l.title, unitPrice: l.unitPrice, quantity: l.quantity })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(cart?.lines.length)]);

  if (loading) return <p className="py-16 text-center" aria-busy="true">…</p>;
  if (!cart?.lines.length) {
    return (
      <p className="py-16 text-center">
        <a href="/cart" className="underline">{locale === "en" ? "Your cart is empty" : "Sepetiniz boş"}</a>
      </p>
    );
  }

  const fail = (body: ApiErrorBody | null) => {
    const problems = (body?.error?.details?.problems as string[] | undefined) ?? [];
    const key = problems[0] ?? body?.error?.message_key?.split(".").pop() ?? "default";
    setError(t.errors[key] ?? t.errors.default!);
  };

  async function submitContact(form: FormData) {
    setBusy(true);
    const next = await request("PUT", "/contact", { email: form.get("email"), phone: form.get("phone") || null, acceptsMarketing: form.get("marketing") === "on" });
    setBusy(false);
    if (next) {
      setError(null);
      setStep(cart!.requiresShipping ? "address" : "payment");
    } else setError(t.errors.default!);
  }

  async function submitAddress(form: FormData) {
    const address: AddressView = {
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      line1: String(form.get("line1") ?? ""),
      district: String(form.get("district") ?? "") || null,
      city: String(form.get("city") ?? ""),
      province: String(form.get("province") ?? "") || null,
      postalCode: String(form.get("postalCode") ?? "") || null,
      countryCode: "TR",
      phone: String(form.get("phone") ?? "") || cart!.phone,
      identityNumber: String(form.get("identityNumber") ?? "") || null,
    };
    setBusy(true);
    const next = await request("PUT", "/addresses", { shipping: address, billingSameAsShipping: true });
    if (next) {
      const r = await fetch("/api/cart/shipping-rates");
      const data = (await r.json()) as { items?: Rate[] } & ApiErrorBody;
      setRates(data.items ?? []);
      setError(null);
      setStep("shipping");
    } else setError(t.errors.default!);
    setBusy(false);
  }

  async function chooseRate(rateId: string) {
    setBusy(true);
    const next = await request("PUT", "/shipping-rate", { rateId });
    setBusy(false);
    if (next) {
      setError(null);
      setStep("payment");
    }
  }

  async function pay() {
    setBusy(true);
    setError(null);
    // Consent, attribution and browser identifiers must be on the cart before the order is created.
    await syncAttribution();
    const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
    const body = (await res.json().catch(() => null)) as (PaymentStart & ApiErrorBody) | null;
    setBusy(false);
    if (!res.ok || !body?.payment) return fail(body);
    track("payment_info_submitted", { provider, orderId: body.orderId, value: cart!.totals.total, currency: cart!.currency });
    if (body.payment.kind === "script" && !body.payment.html && body.payment.url) {
      window.location.href = body.payment.url;
      return;
    }
    setPayment(body);
  }

  const a = cart.shippingAddress;
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
      <div className="flex flex-col gap-8">
        {error && (
          <p role="alert" className="rounded-theme border border-error p-3 text-sm text-error">
            {error}
          </p>
        )}
        <section aria-labelledby="co-contact">
          <h2 id="co-contact" className="mb-4 text-xl">{t.contact}</h2>
          {step === "contact" ? (
            <form className="grid gap-3" action={(fd) => void submitContact(fd)}>
              <Field label={t.email}>
                <input name="email" type="email" required autoComplete="email" defaultValue={cart.email ?? ""} className={inputCls} />
              </Field>
              <Field label={t.phone}>
                <input name="phone" type="tel" autoComplete="tel" required={methods.some((m) => m.requiresPhone)} defaultValue={cart.phone ?? ""} className={inputCls} />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="marketing" defaultChecked={cart.acceptsMarketing} className="mt-1" />
                {t.marketing}
              </label>
              <button className="btn btn-primary justify-self-start" disabled={busy}>{t.continue}</button>
            </form>
          ) : (
            <p className="flex justify-between text-sm">
              <span>{cart.email} · {cart.phone}</span>
              <button type="button" className="underline" onClick={() => setStep("contact")}>{t.edit}</button>
            </p>
          )}
        </section>

        {cart.requiresShipping && (
          <section aria-labelledby="co-address">
            <h2 id="co-address" className="mb-4 text-xl">{t.shipping}</h2>
            {step === "address" ? (
              <form className="grid gap-3 sm:grid-cols-2" action={(fd) => void submitAddress(fd)}>
                <Field label={t.firstName}><input name="firstName" required autoComplete="given-name" defaultValue={a?.firstName ?? ""} className={inputCls} /></Field>
                <Field label={t.lastName}><input name="lastName" required autoComplete="family-name" defaultValue={a?.lastName ?? ""} className={inputCls} /></Field>
                <div className="sm:col-span-2"><Field label={t.address}><input name="line1" required minLength={3} autoComplete="address-line1" defaultValue={a?.line1 ?? ""} className={`${inputCls} w-full`} /></Field></div>
                <Field label={t.district}><input name="district" autoComplete="address-level3" defaultValue={a?.district ?? ""} className={inputCls} /></Field>
                <Field label={t.city}><input name="city" required autoComplete="address-level2" defaultValue={a?.city ?? ""} className={inputCls} /></Field>
                <Field label={t.province}><input name="province" required autoComplete="address-level1" defaultValue={a?.province ?? ""} className={inputCls} /></Field>
                <Field label={t.postalCode}><input name="postalCode" autoComplete="postal-code" inputMode="numeric" defaultValue={a?.postalCode ?? ""} className={inputCls} /></Field>
                <Field label={t.phone}><input name="phone" type="tel" autoComplete="tel" defaultValue={a?.phone ?? cart.phone ?? ""} className={inputCls} /></Field>
                <Field label={t.identity}><input name="identityNumber" inputMode="numeric" pattern="\d{10,11}" defaultValue={a?.identityNumber ?? ""} className={inputCls} /></Field>
                <button className="btn btn-primary justify-self-start sm:col-span-2" disabled={busy}>{t.continue}</button>
              </form>
            ) : a && step !== "contact" ? (
              <p className="flex justify-between text-sm">
                <span>{a.firstName} {a.lastName}, {a.line1}, {a.city}/{a.province}</span>
                <button type="button" className="underline" onClick={() => setStep("address")}>{t.edit}</button>
              </p>
            ) : null}
          </section>
        )}

        {cart.requiresShipping && step === "shipping" && (
          <section aria-labelledby="co-shipping">
            <h2 id="co-shipping" className="mb-4 text-xl">{t.method}</h2>
            {rates.length ? (
              <ul className="flex flex-col gap-2">
                {rates.map((r) => (
                  <li key={r.id}>
                    <button type="button" disabled={busy} onClick={() => void chooseRate(r.id)} className={`flex w-full justify-between rounded-theme border p-4 text-left ${cart.shipping?.rateId === r.id ? "border-fg" : "border-line"}`}>
                      <span>
                        {r.name}
                        {r.minDeliveryDays !== null && <span className="block text-xs text-muted-fg">{r.minDeliveryDays}–{r.maxDeliveryDays ?? r.minDeliveryDays} {t.days}</span>}
                      </span>
                      <strong>{BigInt(r.amount) === 0n ? t.free : formatMoney(r.amount, cart.currency, locale)}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-error">{locale === "en" ? "No shipping option is available for this address." : "Bu adrese gönderim seçeneği bulunmuyor."}</p>
            )}
          </section>
        )}

        {step === "payment" && (
          <section aria-labelledby="co-payment">
            <h2 id="co-payment" className="mb-4 text-xl">{t.payment}</h2>
            {payment ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-fg">{t.secure}</p>
                {payment.payment.provider === "paytr" && payment.payment.url ? <PaytrFrame url={payment.payment.url} /> : payment.payment.html ? <ProviderMarkup html={payment.payment.html} /> : <p>{t.paying}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {methods.length > 1 && (
                  <fieldset className="flex flex-col gap-2">
                    {methods.map((m) => (
                      <label key={m.provider} className="flex items-center gap-2 rounded-theme border border-line p-3">
                        <input type="radio" name="provider" checked={provider === m.provider} onChange={() => setProvider(m.provider)} />
                        {m.provider === "paytr" ? "Kredi / banka kartı (PayTR)" : "Kredi / banka kartı (iyzico)"}
                      </label>
                    ))}
                  </fieldset>
                )}
                {!methods.length && <p className="text-sm text-error">{t.errors.no_active_provider}</p>}
                <button type="button" className="btn btn-primary self-start" disabled={busy || !provider} onClick={() => void pay()}>
                  {t.pay} · {formatMoney(cart.totals.total, cart.currency, locale)}
                </button>
                <p className="text-xs text-muted-fg">{t.secure}</p>
              </div>
            )}
          </section>
        )}
      </div>
      <aside className="flex flex-col gap-4 rounded-theme bg-muted p-6 lg:self-start">
        <CartLines locale={locale} mediaBase={mediaBase} compact />
        <CartSummary locale={locale} />
      </aside>
    </div>
  );
}

interface OrderStatusView {
  number: string;
  status: string;
  paymentStatus: string;
  currency: string;
  email: string | null;
  totals: { total: string; taxTotal: string; shippingTotal: string };
  lines: { itemId: string; title: string; quantity: number; total: string }[];
}

/** Order result page: the payment redirect is only a hint; the order state decides. */
export function CheckoutComplete({ orderId, token, failedHint, locale }: { orderId: string; token: string; failedHint: boolean; locale: string }) {
  const [order, setOrder] = useState<OrderStatusView | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    // PayTR loads the return URL inside its iframe; move it to the top window.
    if (window.top && window.top !== window.self) window.top.location.href = window.location.href;
  }, []);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const res = await fetch(`/api/orders/${orderId}?t=${encodeURIComponent(token)}`);
      if (!res.ok || stop) return;
      const o = (await res.json()) as OrderStatusView;
      setOrder(o);
      if (o.paymentStatus === "paid" && !sessionStorage.getItem(`sf_oc_${orderId}`)) {
        sessionStorage.setItem(`sf_oc_${orderId}`, "1");
        track("order_completed", {
          orderId,
          orderNumber: o.number,
          value: o.totals.total,
          tax: o.totals.taxTotal,
          shipping: o.totals.shippingTotal,
          currency: o.currency,
          items: o.lines.map((l) => ({ itemId: l.itemId, title: l.title, quantity: l.quantity, unitPrice: String(BigInt(l.total) / BigInt(Math.max(1, l.quantity))) })),
        });
      }
      if (o.paymentStatus === "paid" || o.status === "cancelled" || tries > 30) return;
      setTimeout(() => setTries((x) => x + 1), 2000);
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [orderId, token, tries]);

  const paid = order?.paymentStatus === "paid";
  const failed = !paid && (order?.status === "cancelled" || (failedHint && tries > 3) || order?.paymentStatus === "failed");
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center" aria-live="polite">
      {paid ? (
        <>
          <h1 className="text-3xl">{locale === "en" ? "Thank you for your order!" : "Siparişiniz alındı!"}</h1>
          <p>
            {locale === "en" ? "Order number" : "Sipariş numarası"}: <strong>#{order.number}</strong>
          </p>
          <p className="text-muted-fg">{locale === "en" ? `A confirmation will be sent to ${order.email}.` : `Onay bilgileri ${order.email} adresine gönderilecek.`}</p>
          <a href="/" className="btn btn-primary">{locale === "en" ? "Continue shopping" : "Alışverişe devam et"}</a>
        </>
      ) : failed ? (
        <>
          <h1 className="text-3xl">{locale === "en" ? "Payment was not completed" : "Ödeme tamamlanamadı"}</h1>
          <p className="text-muted-fg">{locale === "en" ? "No charge was made. You can try again." : "Ödeme alınmadı. Tekrar deneyebilirsiniz."}</p>
          <a href="/checkout" className="btn btn-primary">{locale === "en" ? "Try again" : "Tekrar dene"}</a>
        </>
      ) : (
        <>
          <h1 className="text-2xl">{locale === "en" ? "Confirming your payment…" : "Ödemeniz doğrulanıyor…"}</h1>
          <p className="text-muted-fg">{locale === "en" ? "This usually takes a few seconds." : "Bu işlem genellikle birkaç saniye sürer."}</p>
        </>
      )}
    </div>
  );
}
