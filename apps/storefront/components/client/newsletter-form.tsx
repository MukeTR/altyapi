"use client";

import { useState } from "react";
import { track } from "@/lib/client/track";

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
  // Explicit opt-in is always required for commercial e-mail (KVKK / İYS).
  const consentLabel =
    consentHtml ||
    (locale === "en"
      ? "I agree to receive campaign and announcement e-mails. I can unsubscribe at any time."
      : "Kampanya ve duyurular hakkında ticari elektronik ileti almayı kabul ediyorum. İstediğim zaman ayrılabilirim.");
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
      <label className="flex items-start gap-2 text-left text-xs text-muted-fg">
        <input type="checkbox" name="consent" required className="mt-0.5" />
        {/* consentHtml comes from sanitized section rich text. */}
        <span className="prose-theme" dangerouslySetInnerHTML={{ __html: consentLabel }} />
      </label>
      {state === "error" && (
        <p role="alert" className="text-sm text-error">
          {error === "errors.newsletter.invalid_email" ? "E-posta adresi geçersiz." : "Bir hata oluştu, lütfen tekrar deneyin."}
        </p>
      )}
    </form>
  );
}
