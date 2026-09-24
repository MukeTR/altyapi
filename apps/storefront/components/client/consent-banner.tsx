"use client";

import { useEffect, useState } from "react";
import { anonymousId, currentConsent, saveConsent, type ConsentState } from "@/lib/client/consent";
import { clearTouches } from "@/lib/client/attribution";

const TEXT = {
  tr: {
    title: "Çerez tercihleri",
    body: "Sitenin çalışması için zorunlu çerezleri kullanıyoruz. İzin verirseniz ziyaretleri ölçmek (analitik), size uygun reklamlar göstermek (pazarlama) ve deneyimi kişiselleştirmek için ek çerezler kullanırız. Tercihinizi istediğiniz zaman değiştirebilirsiniz.",
    acceptAll: "Tümünü kabul et",
    rejectAll: "Yalnızca zorunlu",
    customize: "Tercihleri yönet",
    save: "Seçimi kaydet",
    necessary: "Zorunlu",
    necessaryHint: "Sepet, oturum ve güvenlik. Kapatılamaz.",
    analytics: "Analitik",
    analyticsHint: "Ziyaret ve performans ölçümü (ör. Google Analytics).",
    marketing: "Pazarlama",
    marketingHint: "Reklam ölçümü ve yeniden hedefleme (ör. Meta, TikTok, Google Ads).",
    personalization: "Kişiselleştirme",
    personalizationHint: "Size özel öneriler ve içerik.",
  },
  en: {
    title: "Cookie preferences",
    body: "We use necessary cookies to run this site. With your permission we also use cookies to measure visits (analytics), show relevant ads (marketing) and personalize your experience. You can change your choice at any time.",
    acceptAll: "Accept all",
    rejectAll: "Necessary only",
    customize: "Manage preferences",
    save: "Save choice",
    necessary: "Necessary",
    necessaryHint: "Cart, session and security. Always on.",
    analytics: "Analytics",
    analyticsHint: "Visit and performance measurement (e.g. Google Analytics).",
    marketing: "Marketing",
    marketingHint: "Ad measurement and retargeting (e.g. Meta, TikTok, Google Ads).",
    personalization: "Personalization",
    personalizationHint: "Recommendations and content tailored to you.",
  },
};

type Choice = Pick<ConsentState, "analytics" | "marketing" | "personalization">;

/**
 * Consent banner rendered by the storefront shell, outside every theme section: design
 * changes cannot remove it or alter its behavior. Choices are stored as evidence.
 */
export function ConsentBanner({ policyVersion: initialVersion, locale }: { policyVersion: string; locale: string }) {
  const tx = locale === "en" ? TEXT.en : TEXT.tr;
  const [policyVersion, setPolicyVersion] = useState(initialVersion);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [choice, setChoice] = useState<Choice>({ analytics: false, marketing: false, personalization: false });

  useEffect(() => {
    const existing = currentConsent(policyVersion);
    if (!existing) setOpen(true);
    else setChoice({ analytics: existing.analytics, marketing: existing.marketing, personalization: existing.personalization });
    const reopen = () => {
      setExpanded(true);
      setOpen(true);
    };
    window.addEventListener("sf:open-consent", reopen);
    return () => window.removeEventListener("sf:open-consent", reopen);
  }, [policyVersion]);

  async function decide(next: Choice, source: "banner" | "preferences") {
    const saved = saveConsent({ policyVersion, ...next });
    if (!next.analytics && !next.marketing) clearTouches();
    setChoice(next);
    setOpen(false);
    const send = (version: string) =>
      fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anonymousId: anonymousId(), categories: next, policyVersion: version, textSnapshot: tx.body, source }),
      });
    const res = await send(saved.policyVersion).catch(() => null);
    if (res?.status === 409) {
      // The page was cached with an older policy; ask again with the current one.
      const body = (await res.json().catch(() => null)) as { error?: { details?: { policyVersion?: string } } } | null;
      const current = body?.error?.details?.policyVersion;
      if (current) {
        saveConsent({ policyVersion: current, analytics: false, marketing: false, personalization: false });
        setPolicyVersion(current);
        setOpen(true);
      }
    }
  }

  if (!open) return null;
  const toggle = (key: keyof Choice) => setChoice((c) => ({ ...c, [key]: !c[key] }));
  const row = (key: keyof Choice | "necessary", label: string, hint: string) => (
    <label key={key} className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={key === "necessary" ? true : choice[key]}
        disabled={key === "necessary"}
        onChange={key === "necessary" ? undefined : () => toggle(key)}
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-fg">{hint}</span>
      </span>
    </label>
  );

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="sf-consent-title" className="fixed inset-x-0 bottom-0 z-[1000] p-3 sm:p-4">
      <div className="mx-auto max-w-3xl rounded-theme border border-line bg-surface p-4 text-fg shadow-2xl sm:p-5">
        <h2 id="sf-consent-title" className="text-base font-semibold">
          {tx.title}
        </h2>
        <p className="mt-2 text-sm text-muted-fg">{tx.body}</p>
        {expanded && (
          <div className="mt-3 divide-y divide-line">
            {row("necessary", tx.necessary, tx.necessaryHint)}
            {row("analytics", tx.analytics, tx.analyticsHint)}
            {row("marketing", tx.marketing, tx.marketingHint)}
            {row("personalization", tx.personalization, tx.personalizationHint)}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Accept and reject are equally prominent (no dark pattern). */}
          <button type="button" className="btn btn-primary" onClick={() => void decide({ analytics: true, marketing: true, personalization: true }, expanded ? "preferences" : "banner")}>
            {tx.acceptAll}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void decide({ analytics: false, marketing: false, personalization: false }, expanded ? "preferences" : "banner")}>
            {tx.rejectAll}
          </button>
          {expanded ? (
            <button type="button" className="btn btn-outline" onClick={() => void decide(choice, "preferences")}>
              {tx.save}
            </button>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => setExpanded(true)}>
              {tx.customize}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConsentPreferencesLink({ locale }: { locale: string }) {
  return (
    <div className="container-theme py-3 text-center text-xs text-muted-fg">
      <button type="button" className="underline" onClick={() => window.dispatchEvent(new Event("sf:open-consent"))}>
        {locale === "en" ? TEXT.en.title : TEXT.tr.title}
      </button>
    </div>
  );
}
