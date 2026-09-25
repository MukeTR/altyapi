"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { SITE_KINDS, VERIFICATION_META_NAMES, VERIFICATION_PROVIDERS, type SiteKind, type SiteProfile, type VerificationProvider } from "@/lib/site/types";

interface Draft {
  kind: SiteKind;
  pageUrlStyle: SiteProfile["pageUrlStyle"];
  untranslatedPolicy: SiteProfile["untranslatedPolicy"];
  training: "allow" | "deny";
  verification: Record<VerificationProvider, string>;
}

function toDraft(p: SiteProfile): Draft {
  return {
    kind: p.kind,
    pageUrlStyle: p.pageUrlStyle,
    untranslatedPolicy: p.untranslatedPolicy,
    training: p.aiCrawlers.training,
    verification: Object.fromEntries(VERIFICATION_PROVIDERS.map((v) => [v, p.verificationMeta[v] ?? ""])) as Record<VerificationProvider, string>,
  };
}

/** Accepts the bare token or the whole <meta> tag (the API does the same). */
function tokenOf(value: string): string {
  const tag = /content\s*=\s*["']([^"']*)["']/i.exec(value);
  return (tag ? tag[1]! : value).trim();
}

const TOKEN = /^[A-Za-z0-9_\-.=]{4,128}$/;

/**
 * Site › profile: the site kind (the onboarding preset; modules are switched separately), page
 * URL style, what visitors get in a language a page is not translated to, the AI training
 * crawler preference for robots.txt, and search console verification tags.
 */
export function SiteProfileForm({ initial }: { initial: SiteProfile }) {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const router = useRouter();
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ section: string; info: ApiErrorInfo } | null>(null);
  const canEdit = can("site:manage");
  const base = toDraft(saved);

  /** Draft fields each section edits; saving one section keeps unsaved edits in the others. */
  const SECTION_FIELDS: Record<string, (keyof Draft)[]> = { kind: ["kind"], urls: ["pageUrlStyle", "untranslatedPolicy"], ai: ["training"], verification: ["verification"] };
  const save = async (section: string, body: Record<string, unknown>) => {
    setPending(section);
    setError(null);
    try {
      const next = await bff<SiteProfile>(`${apiBase}/site`, { method: "PUT", body });
      setSaved(next);
      const fresh = toDraft(next);
      setDraft((d) => ({ ...d, ...Object.fromEntries((SECTION_FIELDS[section] ?? []).map((k) => [k, fresh[k]])) }));
      toast({ tone: "success", title: t("site.profile.saved") });
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError({ section, info: err.toInfo() });
    } finally {
      setPending(null);
    }
  };
  const errorFor = (section: string) => (error?.section === section ? describeError(error.info) : null);
  const reset = (section: string) => {
    const fresh = toDraft(saved);
    setDraft((d) => ({ ...d, ...Object.fromEntries((SECTION_FIELDS[section] ?? []).map((k) => [k, fresh[k]])) }));
    setError(null);
  };

  const tokenProblems = Object.fromEntries(VERIFICATION_PROVIDERS.map((p) => [p, draft.verification[p].trim() && !TOKEN.test(tokenOf(draft.verification[p])) ? t("site.profile.tokenInvalid") : null]));
  const verificationError = errorFor("verification");

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader
        title={t("site.profile.title")}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {t("site.profile.kindLabel")}: <Badge tone="accent">{t(`site.kinds.${saved.kind}`)}</Badge>
            <span>·</span>
            {t("site.profile.updated")} <DateTime value={saved.updatedAt} format="relative" />
          </span>
        }
      />
      {!canEdit ? <InlineAlert tone="info">{t("site.readOnly", { permission: "site:manage" })}</InlineAlert> : null}

      <FormSection
        title={t("site.profile.kindTitle")}
        description={t("site.profile.kindDescription")}
        canEdit={canEdit}
        pending={pending === "kind"}
        dirty={draft.kind !== base.kind}
        onCancel={() => reset("kind")}
        onSubmit={() => void save("kind", { kind: draft.kind })}
        error={errorFor("kind") ? <InlineAlert tone="danger">{errorFor("kind")!.message}</InlineAlert> : null}
      >
        <Field label={t("site.profile.kindLabel")} description={t(`site.kindHints.${draft.kind}`)}>
          <Select value={draft.kind} disabled={!canEdit} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as SiteKind }))} options={SITE_KINDS.map((k) => ({ value: k, label: t(`site.kinds.${k}`) }))} />
        </Field>
        <InlineAlert tone="info">{t("site.profile.kindModulesNote")}</InlineAlert>
        <p className="text-sm text-fg-muted">
          {t("site.profile.activeModules")}: {saved.modules.map((m) => <Badge key={m} tone="neutral" className="me-1">{m}</Badge>)}
        </p>
        {saved.primaryPack ? <p className="text-sm text-fg-muted">{t("site.profile.pack", { pack: saved.primaryPack })}</p> : null}
      </FormSection>

      <FormSection
        title={t("site.profile.urlsTitle")}
        description={t("site.profile.urlsDescription")}
        canEdit={canEdit}
        pending={pending === "urls"}
        dirty={draft.pageUrlStyle !== base.pageUrlStyle || draft.untranslatedPolicy !== base.untranslatedPolicy}
        onCancel={() => reset("urls")}
        onSubmit={() => void save("urls", { pageUrlStyle: draft.pageUrlStyle, untranslatedPolicy: draft.untranslatedPolicy })}
        error={errorFor("urls") ? <InlineAlert tone="danger" live="alert">{errorFor("urls")!.message}</InlineAlert> : null}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("site.profile.pageUrlStyle")}</legend>
          <RadioGroup
            value={draft.pageUrlStyle}
            disabled={!canEdit}
            aria-label={t("site.profile.pageUrlStyle")}
            onValueChange={(v) => setDraft((d) => ({ ...d, pageUrlStyle: v as Draft["pageUrlStyle"] }))}
            options={[
              { value: "prefixed", label: t("site.profile.urlStyles.prefixed"), description: t("site.profile.urlStyleHints.prefixed") },
              { value: "root", label: t("site.profile.urlStyles.root"), description: t("site.profile.urlStyleHints.root") },
            ]}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-fg">{t("site.profile.untranslatedPolicy")}</legend>
          <RadioGroup
            value={draft.untranslatedPolicy}
            disabled={!canEdit}
            aria-label={t("site.profile.untranslatedPolicy")}
            onValueChange={(v) => setDraft((d) => ({ ...d, untranslatedPolicy: v as Draft["untranslatedPolicy"] }))}
            options={[
              { value: "hide", label: t("site.profile.policies.hide"), description: t("site.profile.policyHints.hide") },
              { value: "fallback_noindex", label: t("site.profile.policies.fallback_noindex"), description: t("site.profile.policyHints.fallback_noindex") },
            ]}
          />
        </fieldset>
      </FormSection>

      <FormSection
        title={t("site.profile.aiTitle")}
        description={t("site.profile.aiDescription")}
        canEdit={canEdit}
        pending={pending === "ai"}
        dirty={draft.training !== base.training}
        onCancel={() => reset("ai")}
        onSubmit={() => void save("ai", { aiCrawlers: { training: draft.training } })}
        error={errorFor("ai") ? <InlineAlert tone="danger">{errorFor("ai")!.message}</InlineAlert> : null}
      >
        <RadioGroup
          value={draft.training}
          disabled={!canEdit}
          aria-label={t("site.profile.aiTitle")}
          onValueChange={(v) => setDraft((d) => ({ ...d, training: v as "allow" | "deny" }))}
          options={[
            { value: "deny", label: t("site.profile.training.deny"), description: t("site.profile.trainingHints.deny") },
            { value: "allow", label: t("site.profile.training.allow"), description: t("site.profile.trainingHints.allow") },
          ]}
        />
        <p className="text-sm text-fg-muted">{t("site.profile.aiNote")}</p>
      </FormSection>

      <FormSection
        title={t("site.profile.verificationTitle")}
        description={t("site.profile.verificationDescription")}
        canEdit={canEdit}
        pending={pending === "verification"}
        dirty={JSON.stringify(draft.verification) !== JSON.stringify(base.verification)}
        onCancel={() => reset("verification")}
        onSubmit={() => {
          if (Object.values(tokenProblems).some(Boolean)) return;
          void save("verification", { verificationMeta: Object.fromEntries(VERIFICATION_PROVIDERS.map((p) => [p, draft.verification[p].trim() ? tokenOf(draft.verification[p]) : null])) });
        }}
        error={verificationError && !Object.keys(verificationError.fields).length ? <InlineAlert tone="danger">{verificationError.message}</InlineAlert> : null}
      >
        {VERIFICATION_PROVIDERS.map((p) => (
          <Field
            key={p}
            label={t(`site.profile.providers.${p}`)}
            description={<span>{t("site.profile.metaName")} <code className="font-mono">{VERIFICATION_META_NAMES[p]}</code></span>}
            optional
            error={tokenProblems[p] ?? verificationError?.fields[`verificationMeta.${p}`] ?? null}
          >
            <Input value={draft.verification[p]} maxLength={400} className="font-mono" disabled={!canEdit} placeholder={t("site.profile.tokenPlaceholder")} onChange={(e) => setDraft((d) => ({ ...d, verification: { ...d.verification, [p]: e.target.value } }))} />
          </Field>
        ))}
      </FormSection>
    </div>
  );
}
