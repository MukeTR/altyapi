"use client";

import { useEffect, useState } from "react";
import { anonymousId, currentConsent, saveConsent, type ConsentState } from "@/lib/client/consent";
import { clearTouches } from "@/lib/client/attribution";
import { pickDictionary, type UiDictionaries } from "@/lib/ui-locale";

const TEXT_TR = {
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
};

// The shown text is stored with each choice as consent evidence, so every language
// states the same categories and purposes.
const TEXT: UiDictionaries<typeof TEXT_TR> = {
  tr: TEXT_TR,
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
  de: {
    title: "Cookie-Einstellungen",
    body: "Wir verwenden notwendige Cookies, damit diese Website funktioniert. Mit Ihrer Einwilligung verwenden wir außerdem Cookies, um Besuche zu messen (Analyse), relevante Werbung anzuzeigen (Marketing) und Ihr Erlebnis zu personalisieren. Sie können Ihre Auswahl jederzeit ändern.",
    acceptAll: "Alle akzeptieren",
    rejectAll: "Nur notwendige",
    customize: "Einstellungen verwalten",
    save: "Auswahl speichern",
    necessary: "Notwendig",
    necessaryHint: "Warenkorb, Sitzung und Sicherheit. Immer aktiv.",
    analytics: "Analyse",
    analyticsHint: "Messung von Besuchen und Leistung (z. B. Google Analytics).",
    marketing: "Marketing",
    marketingHint: "Werbemessung und Retargeting (z. B. Meta, TikTok, Google Ads).",
    personalization: "Personalisierung",
    personalizationHint: "Auf Sie zugeschnittene Empfehlungen und Inhalte.",
  },
  ar: {
    title: "تفضيلات ملفات تعريف الارتباط",
    body: "نستخدم ملفات تعريف الارتباط الضرورية لتشغيل هذا الموقع. وبموافقتك، نستخدم أيضًا ملفات تعريف ارتباط لقياس الزيارات (التحليلات)، وعرض إعلانات ملائمة (التسويق)، وتخصيص تجربتك. يمكنك تغيير اختيارك في أي وقت.",
    acceptAll: "قبول الكل",
    rejectAll: "الضرورية فقط",
    customize: "إدارة التفضيلات",
    save: "حفظ الاختيار",
    necessary: "ضرورية",
    necessaryHint: "السلة والجلسة والأمان. مفعّلة دائمًا.",
    analytics: "التحليلات",
    analyticsHint: "قياس الزيارات والأداء (مثل Google Analytics).",
    marketing: "التسويق",
    marketingHint: "قياس الإعلانات وإعادة الاستهداف (مثل Meta وTikTok وGoogle Ads).",
    personalization: "التخصيص",
    personalizationHint: "توصيات ومحتوى مخصّص لك.",
  },
  ru: {
    title: "Настройки cookie",
    body: "Мы используем необходимые файлы cookie для работы сайта. С вашего согласия мы также используем cookie для измерения посещаемости (аналитика), показа релевантной рекламы (маркетинг) и персонализации. Вы можете изменить свой выбор в любое время.",
    acceptAll: "Принять все",
    rejectAll: "Только необходимые",
    customize: "Настроить",
    save: "Сохранить выбор",
    necessary: "Необходимые",
    necessaryHint: "Корзина, сеанс и безопасность. Всегда включены.",
    analytics: "Аналитика",
    analyticsHint: "Измерение посещаемости и производительности (например, Google Analytics).",
    marketing: "Маркетинг",
    marketingHint: "Измерение эффективности рекламы и ретаргетинг (например, Meta, TikTok, Google Ads).",
    personalization: "Персонализация",
    personalizationHint: "Рекомендации и контент, подобранные для вас.",
  },
  fr: {
    title: "Préférences de cookies",
    body: "Nous utilisons des cookies nécessaires au fonctionnement de ce site. Avec votre accord, nous utilisons également des cookies pour mesurer la fréquentation (statistiques), afficher des publicités pertinentes (marketing) et personnaliser votre expérience. Vous pouvez modifier votre choix à tout moment.",
    acceptAll: "Tout accepter",
    rejectAll: "Nécessaires uniquement",
    customize: "Gérer les préférences",
    save: "Enregistrer mon choix",
    necessary: "Nécessaires",
    necessaryHint: "Panier, session et sécurité. Toujours actifs.",
    analytics: "Statistiques",
    analyticsHint: "Mesure de la fréquentation et des performances (p. ex. Google Analytics).",
    marketing: "Marketing",
    marketingHint: "Mesure publicitaire et reciblage (p. ex. Meta, TikTok, Google Ads).",
    personalization: "Personnalisation",
    personalizationHint: "Recommandations et contenus adaptés à vos centres d'intérêt.",
  },
};

type Choice = Pick<ConsentState, "analytics" | "marketing" | "personalization">;

/**
 * Consent banner rendered by the storefront shell, outside every theme section: design
 * changes cannot remove it or alter its behavior. Choices are stored as evidence.
 */
export function ConsentBanner({ policyVersion: initialVersion, locale }: { policyVersion: string; locale: string }) {
  const tx = pickDictionary(TEXT, locale);
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
        {pickDictionary(TEXT, locale).title}
      </button>
    </div>
  );
}
