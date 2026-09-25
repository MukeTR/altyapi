"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { AssetField } from "@/components/media/asset-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { plainText, textToParagraphs, toFlowContent, type AtomBlockType, type DocNode, type RichDoc } from "@/lib/content/rich-doc";
import { editorToRichDoc as flowEditorToDoc, isEditableRichDoc, richDocToEditor as flowDocToEditor } from "@/lib/storefront/rich-doc";
import { LinkTargetField, targetProblem, type LinkTarget } from "./link-target-field";
import { RecordPicker, useRecordLabels } from "./record-pickers";

/**
 * Dialog forms of the richDoc blocks the editor carries as atoms (image, table, callout,
 * statistic, quote, FAQ group, call to action, entry and product embeds, third-party embeds).
 * Each form edits the block's attributes in the exact shape packages/content validates.
 */

type Attrs = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const opt = (v: string) => (v.trim() ? v.trim() : undefined);

function clean<T extends Attrs>(attrs: T): T {
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== "")) as T;
}

/** A new block of a type with empty attributes (opened in the dialog before it is inserted). */
export function newBlock(type: AtomBlockType): DocNode {
  switch (type) {
    case "image":
      return { type, attrs: { assetId: "" } };
    case "table":
      return {
        type,
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph" }] }, { type: "tableHeader", content: [{ type: "paragraph" }] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
        ],
      };
    case "callout":
      return { type, attrs: { tone: "info" }, content: [{ type: "paragraph" }] };
    case "statistic":
      return { type, attrs: { value: "", label: "" } };
    case "quote":
      return { type, attrs: { text: "" } };
    case "faqGroup":
      return { type, content: [{ type: "faqItem", attrs: { question: "" }, content: [{ type: "paragraph" }] }] };
    case "cta":
      return { type, attrs: { label: "", target: { type: "url", url: "" }, variant: "primary" } };
    case "entryEmbed":
      return { type, attrs: { entryId: "" } };
    case "productEmbed":
      return { type, attrs: { productId: "" } };
    case "embed":
      return { type, attrs: { provider: "youtube", id: "" } };
  }
}

const EMBED_PATTERNS: Record<string, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d{6,12}$/,
  google_maps: /^[A-Za-z0-9_-]{16,512}$/,
  spotify: /^(?:track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{22}$/,
};

/** Takes the provider id out of a pasted address (only the id is stored, never the URL). */
export function embedIdFrom(provider: string, input: string): string {
  const v = input.trim();
  try {
    const url = new URL(v);
    if (provider === "youtube") return url.hostname.includes("youtu.be") ? url.pathname.slice(1, 12) : (url.searchParams.get("v") ?? url.pathname.split("/").pop() ?? v);
    if (provider === "vimeo") return url.pathname.split("/").filter(Boolean).find((s) => /^\d+$/.test(s)) ?? v;
    if (provider === "spotify") {
      const [kind, id] = url.pathname.split("/").filter(Boolean).filter((s) => !s.startsWith("intl-"));
      return kind && id ? `${kind}/${id}` : v;
    }
  } catch {
    // Not a URL: the id itself.
  }
  return v;
}

/** Key of the problem that keeps a block from being applied, or null. */
function blockProblem(node: DocNode): string | null {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "image":
      return str(a.assetId) ? null : "content.blocks.image.required";
    case "statistic":
      return str(a.value).trim() && str(a.label).trim() ? null : "content.blocks.statistic.required";
    case "quote":
      return str(a.text).trim() ? null : "content.blocks.quote.required";
    case "cta":
      return !str(a.label).trim() ? "content.blocks.cta.labelRequired" : targetProblem(a.target as LinkTarget);
    case "entryEmbed":
      return str(a.entryId) ? null : "content.link.chooseTarget";
    case "productEmbed":
      return str(a.productId) ? null : "content.link.chooseTarget";
    case "embed":
      return EMBED_PATTERNS[str(a.provider)]?.test(str(a.id)) ? null : "content.blocks.embed.idInvalid";
    case "faqGroup":
      return (node.content ?? []).every((i) => str(i.attrs?.question).trim()) ? null : "content.blocks.faq.questionRequired";
    case "table":
      return null;
    case "callout":
      return plainText(node.content) ? null : "content.blocks.callout.required";
    default:
      return null;
  }
}

/** One-line summary of a block for its card in the editor. */
export function useBlockSummary() {
  const { t } = useI18n();
  return (node: DocNode, entryLabel?: (id: string) => string | undefined): string => {
    const a = node.attrs ?? {};
    switch (node.type) {
      case "image":
        return str(a.alt) || (a.decorative ? t("content.blocks.image.decorative") : t("content.blocks.image.noAlt"));
      case "table": {
        const rows = node.content?.length ?? 0;
        const cols = node.content?.[0]?.content?.length ?? 0;
        return t("content.blocks.table.size", { rows, cols });
      }
      case "callout":
        return plainText(node.content).slice(0, 120);
      case "statistic":
        return `${str(a.value)} · ${str(a.label)}`;
      case "quote":
        return `“${str(a.text).slice(0, 100)}”${a.attribution ? ` — ${str(a.attribution)}` : ""}`;
      case "faqGroup":
        return t("content.blocks.faq.count", { count: node.content?.length ?? 0 });
      case "cta":
        return str(a.label);
      case "entryEmbed":
        return entryLabel?.(str(a.entryId)) ?? str(a.entryId);
      case "productEmbed":
        return entryLabel?.(str(a.productId)) ?? str(a.productId);
      case "embed":
        return `${t(`content.blocks.embed.providers.${str(a.provider) as "youtube"}`)} · ${str(a.title) || str(a.id)}`;
      default:
        return node.type;
    }
  };
}

/** Paragraphs and lists edited with the simple rich text editor (callout text, FAQ answers). */
function FlowField({ label, value, onChange, resetKey }: { label: string; value: DocNode[]; onChange: (content: DocNode[]) => void; resetKey: string }) {
  const { t } = useI18n();
  const id = useId();
  const doc = useMemo(() => ({ type: "doc", content: value }), [value]);
  const editable = isEditableRichDoc(doc);
  const initial = useMemo(() => flowDocToEditor(doc), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!editable) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-medium text-fg">{label}</span>
        <InlineAlert tone="info">{t("content.blocks.flowReadOnly")}</InlineAlert>
        <p className="whitespace-pre-wrap text-sm text-fg-muted">{plainText(value, "\n")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label id={`${id}-label`} htmlFor={id} className="text-base font-medium text-fg">
        {label}
      </label>
      <RichTextEditor id={id} aria-labelledby={`${id}-label`} initialContent={initial} resetKey={resetKey} onChange={(c) => onChange(toFlowContent(flowEditorToDoc(c.json as never) as unknown as RichDoc))} />
    </div>
  );
}

function TableForm({ node, onChange }: { node: DocNode; onChange: (n: DocNode) => void }) {
  const { t } = useI18n();
  const rows = node.content ?? [];
  const cols = Math.max(1, ...rows.map((r) => r.content?.length ?? 0));
  const cellText = (r: number, c: number) => plainText(rows[r]?.content?.[c]?.content, "\n");
  const cellType = (r: number) => (r === 0 ? "tableHeader" : "tableCell");
  const setCell = (r: number, c: number, text: string) => {
    const next = rows.map((row, ri) =>
      ri !== r
        ? row
        : { ...row, content: Array.from({ length: cols }, (_, ci) => (ci === c ? { type: cellType(ri), content: textToParagraphs(text) } : (row.content?.[ci] ?? { type: cellType(ri), content: [{ type: "paragraph" }] }))) },
    );
    onChange({ ...node, content: next });
  };
  const emptyRow = (ri: number): DocNode => ({ type: "tableRow", content: Array.from({ length: cols }, () => ({ type: cellType(ri), content: [{ type: "paragraph" }] })) });
  const addRow = () => onChange({ ...node, content: [...rows, emptyRow(rows.length)] });
  const addCol = () => onChange({ ...node, content: rows.map((row, ri) => ({ ...row, content: [...(row.content ?? []), { type: cellType(ri), content: [{ type: "paragraph" }] }] })) });
  const removeRow = (r: number) => onChange({ ...node, content: rows.filter((_, i) => i !== r).map((row, ri) => ({ ...row, content: (row.content ?? []).map((cell) => ({ ...cell, type: cellType(ri) })) })) });
  const removeCol = (c: number) => onChange({ ...node, content: rows.map((row) => ({ ...row, content: (row.content ?? []).filter((_, i) => i !== c) })) });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t("content.blocks.table.hint")}</p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <caption className="sr-only">{t("content.blocks.types.table")}</caption>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="border border-border p-1 align-top">
                    <Textarea
                      aria-label={r === 0 ? t("content.blocks.table.headerCell", { col: c + 1 }) : t("content.blocks.table.cell", { row: r, col: c + 1 })}
                      rows={1}
                      maxRows={6}
                      className={r === 0 ? "font-semibold" : undefined}
                      value={cellText(r, c)}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td className="ps-1">
                  {r > 0 && rows.length > 2 ? (
                    <Button size="icon-sm" variant="ghost" aria-label={t("content.blocks.table.removeRow", { row: r })} onClick={() => removeRow(r)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="pt-1 text-center">
                  {cols > 1 ? (
                    <Button size="icon-sm" variant="ghost" aria-label={t("content.blocks.table.removeCol", { col: c + 1 })} onClick={() => removeCol(c)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={addRow} disabled={rows.length >= 200}>
          <Plus aria-hidden="true" />
          {t("content.blocks.table.addRow")}
        </Button>
        <Button size="sm" onClick={addCol} disabled={cols >= 20}>
          <Plus aria-hidden="true" />
          {t("content.blocks.table.addCol")}
        </Button>
      </div>
    </div>
  );
}

function FaqForm({ node, onChange, resetKey }: { node: DocNode; onChange: (n: DocNode) => void; resetKey: string }) {
  const { t } = useI18n();
  const items = node.content ?? [];
  const set = (i: number, item: DocNode) => onChange({ ...node, content: items.map((x, j) => (j === i ? item : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange({ ...node, content: next });
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg-muted">{t("content.blocks.faq.itemN", { n: i + 1 })}</span>
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveDown")} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={t("content.blocks.faq.remove", { n: i + 1 })} disabled={items.length === 1} onClick={() => onChange({ ...node, content: items.filter((_, j) => j !== i) })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </div>
            <Field label={t("content.blocks.faq.question")} required>
              <Input value={str(item.attrs?.question)} maxLength={300} onChange={(e) => set(i, { ...item, attrs: { question: e.target.value } })} />
            </Field>
            <FlowField label={t("content.blocks.faq.answer")} value={item.content ?? []} resetKey={`${resetKey}-${i}-${items.length}`} onChange={(content) => set(i, { ...item, content: content.length ? content : [{ type: "paragraph" }] })} />
          </li>
        ))}
      </ol>
      <Button size="sm" className="self-start" disabled={items.length >= 100} onClick={() => onChange({ ...node, content: [...items, { type: "faqItem", attrs: { question: "" }, content: [{ type: "paragraph" }] }] })}>
        <Plus aria-hidden="true" />
        {t("content.blocks.faq.add")}
      </Button>
    </div>
  );
}

function BlockForm({ node, onChange, resetKey }: { node: DocNode; onChange: (n: DocNode) => void; resetKey: string }) {
  const { t } = useI18n();
  const a = (node.attrs ?? {}) as Attrs;
  const setAttrs = (patch: Attrs) => onChange({ ...node, attrs: clean({ ...a, ...patch }) });
  switch (node.type) {
    case "image":
      return (
        <div className="flex flex-col gap-4">
          <AssetField label={t("content.blocks.image.asset")} value={str(a.assetId) || null} clearable={false} onChange={(id) => setAttrs({ assetId: id ?? "" })} />
          <Checkbox checked={a.decorative === true} onCheckedChange={(v) => setAttrs({ decorative: v ? true : undefined })} label={t("content.blocks.image.decorativeLabel")} description={t("content.blocks.image.decorativeHint")} />
          {a.decorative !== true ? (
            <Field label={t("content.blocks.image.alt")} description={t("content.blocks.image.altHint")}>
              <Input value={str(a.alt)} maxLength={300} onChange={(e) => setAttrs({ alt: opt(e.target.value) })} />
            </Field>
          ) : null}
          <Field label={t("content.blocks.image.caption")} optional>
            <Input value={str(a.caption)} maxLength={500} onChange={(e) => setAttrs({ caption: opt(e.target.value) })} />
          </Field>
          <Field label={t("content.blocks.image.width")}>
            <Select
              value={str(a.width) || "normal"}
              onValueChange={(v) => setAttrs({ width: v === "normal" ? undefined : v })}
              options={(["normal", "wide", "full"] as const).map((w) => ({ value: w, label: t(`content.blocks.image.widths.${w}`) }))}
            />
          </Field>
        </div>
      );
    case "table":
      return <TableForm node={node} onChange={onChange} />;
    case "callout":
      return (
        <div className="flex flex-col gap-4">
          <Field label={t("content.blocks.callout.tone")}>
            <Select value={str(a.tone) || "info"} onValueChange={(v) => setAttrs({ tone: v })} options={(["info", "note", "success", "warning"] as const).map((tone) => ({ value: tone, label: t(`content.blocks.callout.tones.${tone}`) }))} />
          </Field>
          <FlowField label={t("content.blocks.callout.text")} value={node.content ?? []} resetKey={resetKey} onChange={(content) => onChange({ ...node, content: content.length ? content : [{ type: "paragraph" }] })} />
        </div>
      );
    case "statistic": {
      const source = (a.source ?? {}) as Attrs;
      const setSource = (patch: Attrs) => {
        const next = clean({ ...source, ...patch });
        setAttrs({ source: Object.keys(next).length ? next : undefined });
      };
      return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={t("content.blocks.statistic.value")} required>
              <Input value={str(a.value)} maxLength={40} placeholder="%87" onChange={(e) => setAttrs({ value: e.target.value })} />
            </Field>
            <Field label={t("content.blocks.statistic.label")} required>
              <Input value={str(a.label)} maxLength={200} onChange={(e) => setAttrs({ label: e.target.value })} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-fg">{t("content.blocks.statistic.source")}</legend>
            <p className="text-sm text-fg-muted">{t("content.blocks.statistic.sourceHint")}</p>
            <Field label={t("content.sources.title")}>
              <Input value={str(source.title)} maxLength={300} onChange={(e) => setSource({ title: opt(e.target.value) })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("content.sources.url")} optional>
                <Input value={str(source.url)} inputMode="url" placeholder="https://" onChange={(e) => setSource({ url: opt(e.target.value) })} />
              </Field>
              <Field label={t("content.sources.publisher")} optional>
                <Input value={str(source.publisher)} maxLength={200} onChange={(e) => setSource({ publisher: opt(e.target.value) })} />
              </Field>
            </div>
            <Field label={t("content.sources.date")} description={t("content.sources.dateHint")} optional>
              <Input value={str(source.date)} maxLength={10} placeholder="2025-06" onChange={(e) => setSource({ date: opt(e.target.value) })} />
            </Field>
          </fieldset>
        </div>
      );
    }
    case "quote":
      return (
        <div className="flex flex-col gap-4">
          <Field label={t("content.blocks.quote.text")} required>
            <Textarea value={str(a.text)} maxLength={2000} rows={3} onChange={(e) => setAttrs({ text: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("content.blocks.quote.attribution")} optional>
              <Input value={str(a.attribution)} maxLength={200} onChange={(e) => setAttrs({ attribution: opt(e.target.value) })} />
            </Field>
            <Field label={t("content.blocks.quote.role")} optional>
              <Input value={str(a.role)} maxLength={200} onChange={(e) => setAttrs({ role: opt(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("content.blocks.quote.sourceUrl")} optional>
            <Input value={str(a.sourceUrl)} inputMode="url" placeholder="https://" onChange={(e) => setAttrs({ sourceUrl: opt(e.target.value) })} />
          </Field>
        </div>
      );
    case "faqGroup":
      return <FaqForm node={node} onChange={onChange} resetKey={resetKey} />;
    case "cta":
      return (
        <div className="flex flex-col gap-4">
          <Field label={t("content.blocks.cta.label")} required>
            <Input value={str(a.label)} maxLength={80} onChange={(e) => setAttrs({ label: e.target.value })} />
          </Field>
          <LinkTargetField value={(a.target as LinkTarget) ?? { type: "url", url: "" }} onChange={(target) => setAttrs({ target })} showErrors={false} />
          <Field label={t("content.blocks.cta.variant")}>
            <Select value={str(a.variant) || "primary"} onValueChange={(v) => setAttrs({ variant: v })} options={(["primary", "secondary"] as const).map((v) => ({ value: v, label: t(`content.blocks.cta.variants.${v}`) }))} />
          </Field>
        </div>
      );
    case "entryEmbed":
      return (
        <Field label={t("content.blocks.types.entryEmbed")} required>
          <RecordPicker to="entry" value={str(a.entryId) || null} onChange={(v) => setAttrs({ entryId: v ?? "" })} />
        </Field>
      );
    case "productEmbed":
      return (
        <Field label={t("content.blocks.types.productEmbed")} required>
          <RecordPicker to="product" value={str(a.productId) || null} onChange={(v) => setAttrs({ productId: v ?? "" })} />
        </Field>
      );
    case "embed": {
      const provider = str(a.provider) || "youtube";
      return (
        <div className="flex flex-col gap-4">
          <InlineAlert tone="info">{t("content.blocks.embed.privacy")}</InlineAlert>
          <Field label={t("content.blocks.embed.provider")}>
            <Select value={provider} onValueChange={(v) => setAttrs({ provider: v, id: "", start: undefined })} options={(["youtube", "vimeo", "google_maps", "spotify"] as const).map((p) => ({ value: p, label: t(`content.blocks.embed.providers.${p}`) }))} />
          </Field>
          <Field label={t("content.blocks.embed.id")} description={t(`content.blocks.embed.idHints.${provider as "youtube"}`)} required>
            <Input value={str(a.id)} maxLength={512} className="font-mono" onChange={(e) => setAttrs({ id: embedIdFrom(provider, e.target.value) })} />
          </Field>
          <Field label={t("content.blocks.embed.title")} description={t("content.blocks.embed.titleHint")} optional>
            <Input value={str(a.title)} maxLength={200} onChange={(e) => setAttrs({ title: opt(e.target.value) })} />
          </Field>
          {provider === "youtube" || provider === "vimeo" ? (
            <Field label={t("content.blocks.embed.start")} optional>
              <Input type="number" min={0} max={86400} value={typeof a.start === "number" ? String(a.start) : ""} onChange={(e) => setAttrs({ start: e.target.value === "" ? undefined : Math.max(0, Math.trunc(Number(e.target.value))) })} />
            </Field>
          ) : null}
        </div>
      );
    }
    default:
      return <p className="text-sm text-fg-muted">{node.type}</p>;
  }
}

/** Edits one atom block; `onApply` receives the block (insert or replace). */
export function BlockDialog({ open, onOpenChange, initial, onApply, isNew }: { open: boolean; onOpenChange: (open: boolean) => void; initial: DocNode; onApply: (node: DocNode) => void; isNew: boolean }) {
  const { t } = useI18n();
  const [node, setNode] = useState(initial);
  const [tried, setTried] = useState(false);
  const [resetKey] = useState(() => String(Math.random()));
  const problem = blockProblem(node);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size={node.type === "table" || node.type === "faqGroup" ? "lg" : "md"}
      title={isNew ? t("content.blocks.insertTitle", { block: t(`content.blocks.types.${node.type as AtomBlockType}`) }) : t("content.blocks.editTitle", { block: t(`content.blocks.types.${node.type as AtomBlockType}`) })}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTried(true);
              if (problem) return;
              onApply(node);
              onOpenChange(false);
            }}
          >
            {isNew ? t("content.blocks.insert") : t("content.blocks.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <BlockForm node={node} onChange={setNode} resetKey={resetKey} />
        {tried && problem ? (
          <InlineAlert tone="danger" live="alert">
            {t(problem as "content.blocks.image.required")}
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Label of an entry or product embed target, loading titles as needed. */
export function useEmbedLabels(node: DocNode): (id: string) => string | undefined {
  const entryId = node.type === "entryEmbed" ? str(node.attrs?.entryId) : "";
  const productId = node.type === "productEmbed" ? str(node.attrs?.productId) : "";
  const entries = useRecordLabels("entry", entryId ? [entryId] : []);
  const products = useRecordLabels("product", productId ? [productId] : []);
  return (id: string) => (id === entryId ? entries(id)?.label : id === productId ? products(id)?.label : undefined);
}

export function BlockIconLabel({ icon, label, children }: { icon: ReactNode; label: string; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted [&_svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-fg">{label}</span>
        {children}
      </span>
    </span>
  );
}
