"use client";

import { useState } from "react";
import { track } from "@/lib/client/track";
import { pickDictionary, type UiDictionaries } from "@/lib/ui-locale";

const TEXT_TR = {
  consent: "Kampanya ve duyurular hakkında ticari elektronik ileti almayı kabul ediyorum. İstediğim zaman ayrılabilirim.",
  invalidEmail: "E-posta adresi geçersiz.",
  error: "Bir hata oluştu, lütfen tekrar deneyin.",
};

const TEXT: UiDictionaries<typeof TEXT_TR> = {
  tr: TEXT_TR,
  en: {
    consent: "I agree to receive campaign and announcement e-mails. I can unsubscribe at any time.",
    invalidEmail: "The e-mail address is not valid.",
    error: "Something went wrong. Please try again.",
  },
  de: {
    consent: "Ich willige ein, E-Mails zu Aktionen und Neuigkeiten zu erhalten. Ich kann mich jederzeit abmelden.",
    invalidEmail: "Die E-Mail-Adresse ist ungültig.",
    error: "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
  },
  ar: {
    consent: "أوافق على تلقي رسائل بريد إلكتروني بشأن العروض والإعلانات. يمكنني إلغاء الاشتراك في أي وقت.",
    invalidEmail: "عنوان البريد الإلكتروني غير صالح.",
    error: "حدث خطأ ما، يرجى المحاولة مرة أخرى.",
  },
  ru: {
    consent: "Я даю согласие на получение писем об акциях и новостях. Отписаться можно в любой момент.",
    invalidEmail: "Неверный адрес e-mail.",
    error: "Произошла ошибка. Попробуйте ещё раз.",
  },
  fr: {
    consent: "J'accepte de recevoir des e-mails sur les offres et les actualités. Je peux me désabonner à tout moment.",
    invalidEmail: "L'adresse e-mail n'est pas valide.",
    error: "Une erreur s'est produite. Veuillez réessayer.",
  },
};

export function NewsletterForm({
  placeholder,
  buttonLabel,
  successMessage,
  consentHtml,
  source,
  locale,
}: {
  placeholder: string;
  buttonLabel: string;
  successMessage: string;
  consentHtml: string;
  source: string;
  locale: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const tx = pickDictionary(TEXT, locale);
  // Explicit opt-in is always required for commercial e-mail (KVKK / İYS).
  const consentLabel = consentHtml || tx.consent;
  return state === "done" ? (
    <p role="status" className="font-medium">{successMessage}</p>
  ) : (
    <form
      className="flex w-full max-w-md flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setState("sending");
        setError(null);
        const res = await fetch("/api/newsletter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: form.get("email"),
            consent: form.get("consent") === "on",
            consentText: consentLabel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            source,
            locale,
          }),
        }).catch(() => null);
        if (res?.ok) {
          setState("done");
          track("lead_submitted", { source });
        } else {
          setState("error");
          const body = (await res?.json().catch(() => null)) as { error?: { message_key?: string } } | null;
          setError(body?.error?.message_key ?? "errors.network");
        }
      }}
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`nl-${source}`}>{placeholder}</label>
        <input
          id={`nl-${source}`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-theme border border-line bg-surface px-3 py-2 text-fg"
        />
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          {buttonLabel}
        </button>
      </div>
      <label className="flex items-start gap-2 text-start text-xs text-muted-fg">
        <input type="checkbox" name="consent" required className="mt-0.5" />
        {/* consentHtml comes from sanitized section rich text. */}
        <span className="prose-theme" dangerouslySetInnerHTML={{ __html: consentLabel }} />
      </label>
      {state === "error" && (
        <p role="alert" className="text-sm text-error">
          {error === "errors.newsletter.invalid_email" ? tx.invalidEmail : tx.error}
        </p>
      )}
    </form>
  );
}
