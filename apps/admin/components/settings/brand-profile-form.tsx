"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DateTime } from "@/components/data/date-time";
import { TagInput } from "@/components/commerce/tag-input";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ErrorSummary, FormSection } from "@/components/ui/form-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { BrandCompetitor, BrandProfile } from "@/lib/ekosistem/types";

interface Draft {
  description: string;
  topics: string[];
  competitors: { name: string; website: string; aliases: string[] }[];
  socialProfiles: string[];
}

function toDraft(p: BrandProfile): Draft {
  return {
    description: p.description ?? "",
    topics: p.topics,
    competitors: p.competitors.map((c) => ({ name: c.name, website: c.website ?? "", aliases: c.aliases })),
    socialProfiles: p.socialProfiles,
  };
}

function toBody(d: Draft) {
  return {
    description: d.description.trim() || null,
    topics: d.topics,
    competitors: d.competitors
      .filter((c) => c.name.trim() || c.website.trim())
      .map((c): BrandCompetitor => ({ name: c.name.trim(), website: c.website.trim() || null, aliases: c.aliases })),
    socialProfiles: d.socialProfiles,
  };
}

/**
 * Settings › Brand profile: the description, topics, competitors and social profiles that linked
 * Kârmatik and Yanıt read (brand:read). Plain text only; addresses must be https.
 */
export function BrandProfileForm({ initial }: { initial: BrandProfile }) {
  const { t, describeError } = useI18n();
  const { apiBase, can } = useStore();
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const canEdit = can("settings:write");
  const dirty = JSON.stringify(toBody(draft)) !== JSON.stringify(toBody(toDraft(saved)));
  const described = error ? describeError(error) : null;
  const fieldLabel = (path: string): string => {
    const [head, index, field] = path.split(".");
    const n = Number(index) + 1;
    if (head === "description") return t("brand.description");
    if (head === "topics") return t("brand.topics");
    if (head === "socialProfiles") return t("brand.socialN", { n });
    if (head === "competitors" && field === "website") return t("brand.competitorWebsiteN", { n });
    if (head === "competitors") return t("brand.competitorN", { n });
    return path;
  };
  const fieldId = (path: string): string => {
    const [head, index, field] = path.split(".");
    if (head === "competitors" && index !== undefined) return `brand-competitor-${index}-${field === "website" ? "website" : "name"}`;
    if (head === "socialProfiles" || head === "topics") return `brand-${head}`;
    return "brand-description";
  };
  // Address fields only fail for not being https URLs; say so instead of a generic message.
  const isUrlPath = (path: string) => path.startsWith("socialProfiles.") || /^competitors\.\d+\.website$/.test(path);
  const items = described
    ? Object.entries(described.fields).map(([path, message]) => ({ fieldId: fieldId(path), message: isUrlPath(path) ? t("brand.httpsRequired") : message, label: fieldLabel(path) }))
    : [];

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const next = await bff<BrandProfile>(`${apiBase}/ekosistem/brand-profile`, { method: "PUT", body: toBody(draft) });
      setSaved(next);
      setDraft(toDraft(next));
      toast({ tone: "success", title: t("brand.saved") });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.toInfo());
    } finally {
      setPending(false);
    }
  };

  const setCompetitor = (i: number, patch: Partial<Draft["competitors"][number]>) =>
    setDraft((d) => ({ ...d, competitors: d.competitors.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader
        title={t("brand.title")}
        meta={saved.updatedAt ? <span>{t("brand.updated")} <DateTime value={saved.updatedAt} format="relative" /></span> : t("brand.meta")}
      />
      <InlineAlert tone="info">{t("brand.sharedNote")}</InlineAlert>
      {!canEdit ? <InlineAlert tone="info">{t("settings.readOnlyBody", { permission: "settings:write" })}</InlineAlert> : null}
      <FormSection
        title={t("brand.sectionTitle")}
        description={t("brand.sectionDescription")}
        canEdit={canEdit}
        pending={pending}
        dirty={dirty}
        onCancel={() => {
          setDraft(toDraft(saved));
          setError(null);
        }}
        onSubmit={() => void save()}
        error={described ? <ErrorSummary message={items.length ? undefined : described.message} items={items} /> : null}
      >
        <Field id="brand-description" label={t("brand.description")} description={t("brand.descriptionHelp")} optional>
          <Textarea rows={5} maxLength={4000} showCount value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        </Field>
        <Field id="brand-topics" label={t("brand.topics")} description={t("brand.topicsHelp")} optional>
          <TagInput value={draft.topics} onChange={(topics) => setDraft((d) => ({ ...d, topics }))} maxTags={30} maxLength={100} disabled={!canEdit} placeholder={t("brand.topicsPlaceholder")} />
        </Field>
        <Field id="brand-socialProfiles" label={t("brand.social")} description={t("brand.socialHelp")} optional>
          <TagInput
            value={draft.socialProfiles}
            onChange={(socialProfiles) => setDraft((d) => ({ ...d, socialProfiles }))}
            maxTags={15}
            maxLength={500}
            disabled={!canEdit}
            placeholder="https://instagram.com/…"
          />
        </Field>
      </FormSection>
      <FormSection
        title={t("brand.competitorsTitle")}
        description={t("brand.competitorsDescription")}
        canEdit={canEdit}
        pending={pending}
        dirty={dirty}
        onCancel={() => {
          setDraft(toDraft(saved));
          setError(null);
        }}
        onSubmit={() => void save()}
      >
        {draft.competitors.length === 0 ? <p className="text-sm text-fg-muted">{t("brand.noCompetitors")}</p> : null}
        <ul className="flex flex-col gap-3">
          {draft.competitors.map((c, i) => (
            <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-medium text-fg">{c.name.trim() || t("brand.competitorN", { n: i + 1 })}</h3>
                <Button size="icon-sm" variant="ghost" aria-label={t("brand.removeCompetitor", { n: i + 1 })} onClick={() => setDraft((d) => ({ ...d, competitors: d.competitors.filter((_, j) => j !== i) }))}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={`brand-competitor-${i}-name`} label={t("brand.competitorName")} required>
                  <Input value={c.name} maxLength={120} onChange={(e) => setCompetitor(i, { name: e.target.value })} />
                </Field>
                <Field id={`brand-competitor-${i}-website`} label={t("brand.competitorWebsite")} optional>
                  <Input type="url" value={c.website} maxLength={500} placeholder="https://" onChange={(e) => setCompetitor(i, { website: e.target.value })} />
                </Field>
              </div>
              <Field label={t("brand.aliases")} description={t("brand.aliasesHelp")} optional>
                <TagInput value={c.aliases} onChange={(aliases) => setCompetitor(i, { aliases })} maxTags={10} maxLength={120} disabled={!canEdit} />
              </Field>
            </li>
          ))}
        </ul>
        {draft.competitors.length < 30 ? (
          <Button size="sm" className="self-start" onClick={() => setDraft((d) => ({ ...d, competitors: [...d.competitors, { name: "", website: "", aliases: [] }] }))}>
            <Plus aria-hidden="true" />
            {t("brand.addCompetitor")}
          </Button>
        ) : null}
      </FormSection>
    </div>
  );
}
