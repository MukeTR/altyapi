"use client";

import { useEffect, useRef, useState } from "react";
import type { AddressView, ApiErrorBody } from "@/lib/client/cart-types";
import { track } from "@/lib/client/track";
import { syncAttribution } from "@/lib/client/attribution";
import { formatMoney } from "@/lib/format";
import { interpolate, pickDictionary, type UiDictionaries } from "@/lib/ui-locale";
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

const T_TR = {
  title: "Siparişi tamamla",
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
  noShipping: "Bu adrese gönderim seçeneği bulunmuyor.",
  free: "Ücretsiz",
  days: "iş günü",
  payment: "Ödeme",
  card: "Kredi / banka kartı ({provider})",
  pay: "Ödemeye geç",
  continue: "Devam et",
  edit: "Düzenle",
  paying: "Güvenli ödeme sayfası yükleniyor…",
  secure: "Kart bilgileriniz ödeme kuruluşu tarafından işlenir; mağaza kart bilgilerinizi görmez.",
  cartEmpty: "Sepetiniz boş",
  thanks: "Siparişiniz alındı!",
  orderNumber: "Sipariş numarası",
  confirmationSent: "Onay bilgileri {email} adresine gönderilecek.",
  continueShopping: "Alışverişe devam et",
  paymentFailed: "Ödeme tamamlanamadı",
  noCharge: "Ödeme alınmadı. Tekrar deneyebilirsiniz.",
  tryAgain: "Tekrar dene",
  confirming: "Ödemeniz doğrulanıyor…",
  fewSeconds: "Bu işlem genellikle birkaç saniye sürer.",
  errors: {
    default: "İşlem tamamlanamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
    phone_required: "Bu ödeme yöntemi için telefon numarası gerekli.",
    unavailable_lines: "Sepetinizdeki bazı ürünler artık satışta değil.",
    shipping_method_required: "Lütfen kargo seçin.",
    payment_session_failed: "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.",
    no_active_provider: "Mağaza şu anda online ödeme kabul etmiyor.",
  },
};

const T: UiDictionaries<typeof T_TR> = {
  tr: T_TR,
  en: {
    title: "Checkout",
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
    noShipping: "No shipping option is available for this address.",
    free: "Free",
    days: "business days",
    payment: "Payment",
    card: "Credit / debit card ({provider})",
    pay: "Continue to payment",
    continue: "Continue",
    edit: "Edit",
    paying: "Loading secure payment page…",
    secure: "Card details are processed by the payment provider; the store never sees them.",
    cartEmpty: "Your cart is empty",
    thanks: "Thank you for your order!",
    orderNumber: "Order number",
    confirmationSent: "A confirmation will be sent to {email}.",
    continueShopping: "Continue shopping",
    paymentFailed: "Payment was not completed",
    noCharge: "No charge was made. You can try again.",
    tryAgain: "Try again",
    confirming: "Confirming your payment…",
    fewSeconds: "This usually takes a few seconds.",
    errors: {
      default: "Could not complete this step. Please check your details and try again.",
      phone_required: "A phone number is required for this payment method.",
      unavailable_lines: "Some items in your cart are no longer available.",
      shipping_method_required: "Please choose a shipping method.",
      payment_session_failed: "Could not open the payment page. Please try again.",
      no_active_provider: "The store is not accepting online payments right now.",
    },
  },
  de: {
    title: "Kasse",
    contact: "Kontakt",
    email: "E-Mail",
    phone: "Telefon",
    marketing: "Ich möchte per E-Mail über Angebote und Neuigkeiten informiert werden.",
    shipping: "Lieferadresse",
    firstName: "Vorname",
    lastName: "Nachname",
    address: "Adresse",
    district: "Stadtteil",
    city: "Bezirk / Stadt",
    province: "Provinz / Bundesland",
    postalCode: "Postleitzahl",
    identity: "Ausweisnummer (optional, für die Rechnung)",
    method: "Versandart",
    noShipping: "Für diese Adresse ist keine Versandoption verfügbar.",
    free: "Kostenlos",
    days: "Werktage",
    payment: "Zahlung",
    card: "Kredit-/Debitkarte ({provider})",
    pay: "Weiter zur Zahlung",
    continue: "Weiter",
    edit: "Bearbeiten",
    paying: "Sichere Zahlungsseite wird geladen…",
    secure: "Ihre Kartendaten werden vom Zahlungsdienstleister verarbeitet; der Shop sieht sie nie.",
    cartEmpty: "Ihr Warenkorb ist leer",
    thanks: "Vielen Dank für Ihre Bestellung!",
    orderNumber: "Bestellnummer",
    confirmationSent: "Eine Bestätigung wird an {email} gesendet.",
    continueShopping: "Weiter einkaufen",
    paymentFailed: "Die Zahlung wurde nicht abgeschlossen",
    noCharge: "Es wurde nichts abgebucht. Sie können es erneut versuchen.",
    tryAgain: "Erneut versuchen",
    confirming: "Ihre Zahlung wird bestätigt…",
    fewSeconds: "Das dauert in der Regel nur wenige Sekunden.",
    errors: {
      default: "Dieser Schritt konnte nicht abgeschlossen werden. Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.",
      phone_required: "Für diese Zahlungsart ist eine Telefonnummer erforderlich.",
      unavailable_lines: "Einige Artikel in Ihrem Warenkorb sind nicht mehr verfügbar.",
      shipping_method_required: "Bitte wählen Sie eine Versandart.",
      payment_session_failed: "Die Zahlungsseite konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.",
      no_active_provider: "Der Shop akzeptiert derzeit keine Online-Zahlungen.",
    },
  },
  ar: {
    title: "إتمام الشراء",
    contact: "معلومات التواصل",
    email: "البريد الإلكتروني",
    phone: "الهاتف",
    marketing: "أرغب في تلقي العروض والأخبار عبر البريد الإلكتروني.",
    shipping: "عنوان التوصيل",
    firstName: "الاسم الأول",
    lastName: "اسم العائلة",
    address: "العنوان",
    district: "الحي",
    city: "المنطقة / المدينة",
    province: "المحافظة / الولاية",
    postalCode: "الرمز البريدي",
    identity: "رقم الهوية الوطنية (اختياري، للفاتورة)",
    method: "طريقة الشحن",
    noShipping: "لا يتوفر خيار شحن لهذا العنوان.",
    free: "مجاني",
    days: "أيام عمل",
    payment: "الدفع",
    card: "بطاقة ائتمان / خصم ({provider})",
    pay: "المتابعة إلى الدفع",
    continue: "متابعة",
    edit: "تعديل",
    paying: "جارٍ تحميل صفحة الدفع الآمنة…",
    secure: "تتم معالجة بيانات بطاقتك من قِبل مزوّد خدمة الدفع، ولا يطّلع المتجر عليها أبدًا.",
    cartEmpty: "سلة التسوق فارغة",
    thanks: "شكرًا لطلبك!",
    orderNumber: "رقم الطلب",
    confirmationSent: "سيتم إرسال تأكيد الطلب إلى {email}.",
    continueShopping: "متابعة التسوق",
    paymentFailed: "لم تكتمل عملية الدفع",
    noCharge: "لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى.",
    tryAgain: "حاول مرة أخرى",
    confirming: "جارٍ تأكيد الدفع…",
    fewSeconds: "يستغرق ذلك عادةً بضع ثوانٍ.",
    errors: {
      default: "تعذّر إكمال هذه الخطوة. يرجى التحقق من بياناتك والمحاولة مرة أخرى.",
      phone_required: "رقم الهاتف مطلوب لطريقة الدفع هذه.",
      unavailable_lines: "بعض المنتجات في سلتك لم تعد متوفرة.",
      shipping_method_required: "يرجى اختيار طريقة الشحن.",
      payment_session_failed: "تعذّر فتح صفحة الدفع. يرجى المحاولة مرة أخرى.",
      no_active_provider: "لا يقبل المتجر المدفوعات الإلكترونية حاليًا.",
    },
  },
  ru: {
    title: "Оформление заказа",
    contact: "Контактные данные",
    email: "E-mail",
    phone: "Телефон",
    marketing: "Я хочу получать новости и специальные предложения по e-mail.",
    shipping: "Адрес доставки",
    firstName: "Имя",
    lastName: "Фамилия",
    address: "Адрес",
    district: "Микрорайон",
    city: "Район / город",
    province: "Область / регион",
    postalCode: "Почтовый индекс",
    identity: "Идентификационный номер (необязательно, для счёта)",
    method: "Способ доставки",
    noShipping: "Для этого адреса нет доступных способов доставки.",
    free: "Бесплатно",
    days: "рабочих дней",
    payment: "Оплата",
    card: "Кредитная / дебетовая карта ({provider})",
    pay: "Перейти к оплате",
    continue: "Продолжить",
    edit: "Изменить",
    paying: "Загружается защищённая страница оплаты…",
    secure: "Данные карты обрабатывает платёжная система; магазин их не видит.",
    cartEmpty: "Ваша корзина пуста",
    thanks: "Спасибо за заказ!",
    orderNumber: "Номер заказа",
    confirmationSent: "Подтверждение будет отправлено на {email}.",
    continueShopping: "Продолжить покупки",
    paymentFailed: "Оплата не завершена",
    noCharge: "Средства не списаны. Вы можете попробовать ещё раз.",
    tryAgain: "Попробовать снова",
    confirming: "Подтверждаем оплату…",
    fewSeconds: "Обычно это занимает несколько секунд.",
    errors: {
      default: "Не удалось выполнить этот шаг. Проверьте данные и попробуйте ещё раз.",
      phone_required: "Для этого способа оплаты требуется номер телефона.",
      unavailable_lines: "Некоторые товары в корзине больше недоступны.",
      shipping_method_required: "Пожалуйста, выберите способ доставки.",
      payment_session_failed: "Не удалось открыть страницу оплаты. Попробуйте ещё раз.",
      no_active_provider: "Магазин сейчас не принимает онлайн-оплату.",
    },
  },
  fr: {
    title: "Finaliser la commande",
    contact: "Coordonnées",
    email: "E-mail",
    phone: "Téléphone",
    marketing: "Je souhaite recevoir par e-mail les offres et nouveautés.",
    shipping: "Adresse de livraison",
    firstName: "Prénom",
    lastName: "Nom",
    address: "Adresse",
    district: "Quartier",
    city: "Arrondissement / Ville",
    province: "Province / Région",
    postalCode: "Code postal",
    identity: "Numéro d'identité (facultatif, pour la facture)",
    method: "Mode de livraison",
    noShipping: "Aucune option de livraison n'est disponible pour cette adresse.",
    free: "Gratuit",
    days: "jours ouvrés",
    payment: "Paiement",
    card: "Carte de crédit / débit ({provider})",
    pay: "Procéder au paiement",
    continue: "Continuer",
    edit: "Modifier",
    paying: "Chargement de la page de paiement sécurisée…",
    secure: "Vos données de carte sont traitées par le prestataire de paiement\u00a0; la boutique n'y a jamais accès.",
    cartEmpty: "Votre panier est vide",
    thanks: "Merci pour votre commande\u00a0!",
    orderNumber: "Numéro de commande",
    confirmationSent: "Une confirmation sera envoyée à {email}.",
    continueShopping: "Continuer mes achats",
    paymentFailed: "Le paiement n'a pas abouti",
    noCharge: "Aucun montant n'a été débité. Vous pouvez réessayer.",
    tryAgain: "Réessayer",
    confirming: "Confirmation de votre paiement…",
    fewSeconds: "Cela ne prend généralement que quelques secondes.",
    errors: {
      default: "Impossible de finaliser cette étape. Veuillez vérifier vos informations et réessayer.",
      phone_required: "Un numéro de téléphone est requis pour ce moyen de paiement.",
      unavailable_lines: "Certains articles de votre panier ne sont plus disponibles.",
      shipping_method_required: "Veuillez choisir un mode de livraison.",
      payment_session_failed: "Impossible d'ouvrir la page de paiement. Veuillez réessayer.",
      no_active_provider: "La boutique n'accepte pas les paiements en ligne pour le moment.",
    },
  },
};

/** Maps an API error (problem code or message key suffix) to a checkout message. */
function errorText(t: typeof T_TR, key: string): string {
  return (t.errors as Record<string, string>)[key] ?? t.errors.default;
}

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
  const t = pickDictionary(T, locale);
  // Every state of the checkout page carries the same H1; the steps below are H2s.
  const title = <h1 className="sr-only">{t.title}</h1>;
  const { cart, loading, request, localePath } = useCart();
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

  if (loading) {
    return (
      <>
        {title}
        <p className="py-16 text-center" aria-busy="true">…</p>
      </>
    );
  }
  if (!cart?.lines.length) {
    return (
      <>
        {title}
        <p className="py-16 text-center">
          <a href={localePath("/cart")} className="underline">{t.cartEmpty}</a>
        </p>
      </>
    );
  }

  const fail = (body: ApiErrorBody | null) => {
    const problems = (body?.error?.details?.problems as string[] | undefined) ?? [];
    const key = problems[0] ?? body?.error?.message_key?.split(".").pop() ?? "default";
    setError(errorText(t, key));
  };

  async function submitContact(form: FormData) {
    setBusy(true);
    const next = await request("PUT", "/contact", { email: form.get("email"), phone: form.get("phone") || null, acceptsMarketing: form.get("marketing") === "on" });
    setBusy(false);
    if (next) {
      setError(null);
      setStep(cart!.requiresShipping ? "address" : "payment");
    } else setError(t.errors.default);
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
    } else setError(t.errors.default);
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
      {title}
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
                    <button type="button" disabled={busy} onClick={() => void chooseRate(r.id)} className={`flex w-full justify-between rounded-theme border p-4 text-start ${cart.shipping?.rateId === r.id ? "border-fg" : "border-line"}`}>
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
              <p className="text-sm text-error">{t.noShipping}</p>
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
                        {interpolate(t.card, { provider: m.provider === "paytr" ? "PayTR" : "iyzico" })}
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
  const { localePath } = useCart();
  const t = pickDictionary(T, locale);
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
          <h1 className="text-3xl">{t.thanks}</h1>
          <p>
            {t.orderNumber}: <strong>#{order.number}</strong>
          </p>
          {order.email && <p className="text-muted-fg">{interpolate(t.confirmationSent, { email: order.email })}</p>}
          <a href={localePath("/")} className="btn btn-primary">{t.continueShopping}</a>
        </>
      ) : failed ? (
        <>
          <h1 className="text-3xl">{t.paymentFailed}</h1>
          <p className="text-muted-fg">{t.noCharge}</p>
          <a href={localePath("/checkout")} className="btn btn-primary">{t.tryAgain}</a>
        </>
      ) : (
        <>
          <h1 className="text-2xl">{t.confirming}</h1>
          <p className="text-muted-fg">{t.fewSeconds}</p>
        </>
      )}
    </div>
  );
}
