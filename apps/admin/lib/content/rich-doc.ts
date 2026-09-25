import type { RichBlockType, RichMarkType } from "./types";

/**
 * Conversion between richDoc (packages/content/src/rich/schema.ts: the stored format of every
 * content rich text field) and the document JSON of the content editor (Tiptap).
 *
 * Text blocks map one to one: paragraph, heading (h2–h4), bullet and ordered lists with list
 * items, blockquote, text and hard breaks; the marks bold, italic, underline, strike, code,
 * citation and link (with a LinkTarget, never a raw href). Every other block (table, image,
 * callout, statistic, quote, faqGroup, cta, entryEmbed, productEmbed, embed) is carried whole
 * by the editor's atom node `richBlock` and edited in a dialog, so its attributes and nested
 * content survive editing untouched.
 *
 * editorToRichDoc also enforces the node rules the API checks: only paragraphs and lists inside
 * list items, quotes, callouts and FAQ answers; headings h2–h4; no empty text nodes; and the
 * field's allowed nodes and marks (a pasted heading in a field without headings becomes a
 * paragraph instead of failing the save).
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichDoc {
  type: "doc";
  content: DocNode[];
}

/** Blocks the editor edits as text; everything else is an atom block. */
export const TEXT_BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote"]);

/** Editor node type of atom blocks. */
export const ATOM_NODE = "richBlock";

/** Atom block types in insert-menu order. */
export const ATOM_BLOCKS = ["image", "table", "callout", "statistic", "quote", "faqGroup", "cta", "entryEmbed", "productEmbed", "embed"] as const satisfies readonly RichBlockType[];
export type AtomBlockType = (typeof ATOM_BLOCKS)[number];

const MARK_ORDER: readonly RichMarkType[] = ["bold", "italic", "underline", "strike", "code", "citation", "link"];

export interface RichDocRules {
  /** Allowed block types (undefined: all). */
  nodes?: readonly RichBlockType[] | undefined;
  /** Allowed marks (undefined: all). */
  marks?: readonly RichMarkType[] | undefined;
}

export function emptyRichDoc(): RichDoc {
  return { type: "doc", content: [] };
}

export function isRichDoc(value: unknown): value is RichDoc {
  return Boolean(value) && typeof value === "object" && (value as { type?: unknown }).type === "doc" && Array.isArray((value as { content?: unknown }).content);
}

// ---------------------------------------------------------------------------
// richDoc → editor
// ---------------------------------------------------------------------------

function markToEditor(m: DocMark): DocMark | null {
  switch (m.type) {
    case "link":
      return {
        type: "link",
        attrs: {
          target: m.attrs?.target ?? null,
          openInNewTab: m.attrs?.openInNewTab === true,
          rel: Array.isArray(m.attrs?.rel) && m.attrs.rel.length ? m.attrs.rel : null,
        },
      };
    case "citation":
      return { type: "citation", attrs: { title: m.attrs?.title ?? "", url: m.attrs?.url ?? null } };
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "code":
      return { type: m.type };
    default:
      return null;
  }
}

function inlineToEditor(nodes: DocNode[] | undefined): DocNode[] | undefined {
  const out = (nodes ?? []).flatMap((n): DocNode[] => {
    if (n.type === "hardBreak") return [{ type: "hardBreak" }];
    if (n.type !== "text" || !n.text) return [];
    const marks = (n.marks ?? []).map(markToEditor).filter((m): m is DocMark => m !== null);
    return [{ type: "text", text: n.text, ...(marks.length ? { marks } : {}) }];
  });
  return out.length ? out : undefined;
}

function blockToEditor(n: DocNode): DocNode {
  switch (n.type) {
    case "paragraph": {
      const content = inlineToEditor(n.content);
      return { type: "paragraph", ...(content ? { content } : {}) };
    }
    case "heading": {
      const content = inlineToEditor(n.content);
      return { type: "heading", attrs: { level: Math.min(4, Math.max(2, Number(n.attrs?.level ?? 2))) }, ...(content ? { content } : {}) };
    }
    case "bulletList":
    case "orderedList": {
      const items = (n.content ?? []).map((li) => ({ type: "listItem", content: (li.content ?? []).map(blockToEditor) }));
      const start = n.type === "orderedList" && typeof n.attrs?.start === "number" ? n.attrs.start : 1;
      return { type: n.type, ...(n.type === "orderedList" ? { attrs: { start } } : {}), content: items.length ? items : [{ type: "listItem", content: [{ type: "paragraph" }] }] };
    }
    case "blockquote": {
      const content = (n.content ?? []).map(blockToEditor);
      return { type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] };
    }
    default:
      return { type: ATOM_NODE, attrs: { node: n } };
  }
}

/** Stored richDoc → editor JSON (an empty document becomes one empty paragraph). */
export function richDocToEditor(value: unknown): DocNode {
  const blocks = isRichDoc(value) ? value.content : [];
  const content = blocks.map(blockToEditor);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ---------------------------------------------------------------------------
// editor → richDoc
// ---------------------------------------------------------------------------

function markFromEditor(m: DocMark, allowed: ReadonlySet<string>): DocMark | null {
  if (!allowed.has(m.type)) return null;
  switch (m.type) {
    case "link": {
      const target = m.attrs?.target;
      if (!target || typeof target !== "object") return null;
      const rel = Array.isArray(m.attrs?.rel) ? (m.attrs.rel as string[]).filter((r) => r === "nofollow" || r === "sponsored" || r === "ugc") : [];
      return { type: "link", attrs: { target, ...(m.attrs?.openInNewTab ? { openInNewTab: true } : {}), ...(rel.length ? { rel } : {}) } };
    }
    case "citation": {
      const title = typeof m.attrs?.title === "string" ? m.attrs.title.trim() : "";
      if (!title) return null;
      const url = typeof m.attrs?.url === "string" && m.attrs.url.trim() ? m.attrs.url.trim() : undefined;
      return { type: "citation", attrs: { title, ...(url ? { url } : {}) } };
    }
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "code":
      return { type: m.type };
    default:
      return null;
  }
}

interface Ctx {
  nodes: ReadonlySet<string>;
  marks: ReadonlySet<string>;
}

function inlineFromEditor(nodes: DocNode[] | undefined, ctx: Ctx): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (n.type !== "text" || !n.text) continue;
    const seen = new Set<string>();
    const marks = (n.marks ?? [])
      .map((m) => markFromEditor(m, ctx.marks))
      .filter((m): m is DocMark => m !== null && !seen.has(m.type) && Boolean(seen.add(m.type)))
      .sort((a, b) => MARK_ORDER.indexOf(a.type as RichMarkType) - MARK_ORDER.indexOf(b.type as RichMarkType));
    const prev = out[out.length - 1];
    // Adjacent text with the same marks is one text node (the editor may split them).
    if (prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) {
      prev.text = `${prev.text ?? ""}${n.text}`;
      continue;
    }
    out.push({ type: "text", text: n.text, ...(marks.length ? { marks } : {}) });
  }
  return out;
}

function paragraph(content: DocNode[]): DocNode {
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

/** A block inside a list item, quote, callout or FAQ answer: paragraphs and lists only. */
function flowFromEditor(n: DocNode, ctx: Ctx): DocNode[] {
  if (n.type === "paragraph" || n.type === "heading") return [paragraph(inlineFromEditor(n.content, ctx))];
  if (n.type === "blockquote") return (n.content ?? []).flatMap((c) => flowFromEditor(c, ctx));
  if (n.type === "bulletList" || n.type === "orderedList") return listFromEditor(n, ctx);
  return [];
}

function listFromEditor(n: DocNode, ctx: Ctx): DocNode[] {
  const items = (n.content ?? []).flatMap((li) => {
    const content = (li.content ?? []).flatMap((c) => flowFromEditor(c, ctx));
    return content.length ? [{ type: "listItem", content }] : [];
  });
  if (!items.length) return [];
  if (!ctx.nodes.has(n.type)) {
    // A list pasted into a field without lists keeps its text as paragraphs.
    return items.flatMap((i) => i.content.filter((c) => c.type === "paragraph"));
  }
  const start = Number(n.attrs?.start ?? 1);
  return [{ type: n.type, ...(n.type === "orderedList" && start !== 1 ? { attrs: { start } } : {}), content: items }];
}

function blockFromEditor(n: DocNode, ctx: Ctx): DocNode[] {
  switch (n.type) {
    case "paragraph":
      return [paragraph(inlineFromEditor(n.content, ctx))];
    case "heading": {
      const content = inlineFromEditor(n.content, ctx);
      if (!ctx.nodes.has("heading")) return [paragraph(content)];
      const level = Math.min(4, Math.max(2, Number(n.attrs?.level ?? 2)));
      return [{ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) }];
    }
    case "bulletList":
    case "orderedList":
      return listFromEditor(n, ctx);
    case "blockquote": {
      const content = (n.content ?? []).flatMap((c) => flowFromEditor(c, ctx));
      if (!content.length) return [];
      return ctx.nodes.has("blockquote") ? [{ type: "blockquote", content }] : content;
    }
    case ATOM_NODE: {
      const node = n.attrs?.node as DocNode | undefined;
      return node && typeof node.type === "string" ? [node] : [];
    }
    default:
      return [];
  }
}

/** Editor JSON → richDoc, limited to the field's nodes and marks. */
export function editorToRichDoc(json: DocNode, rules: RichDocRules = {}): RichDoc {
  const ctx: Ctx = {
    nodes: new Set<string>(rules.nodes ?? ["paragraph", "heading", "bulletList", "orderedList", "blockquote", ...ATOM_BLOCKS]),
    marks: new Set<string>(rules.marks ?? MARK_ORDER),
  };
  ctx.nodes = new Set([...ctx.nodes, "paragraph"]);
  const content = (json.content ?? []).flatMap((n) => blockFromEditor(n, ctx));
  // Trailing empty paragraphs are editor chrome (the cursor line), not content.
  while (content.length) {
    const last = content[content.length - 1]!;
    if (last.type === "paragraph" && !last.content?.length) content.pop();
    else break;
  }
  return { type: "doc", content };
}

/** True when a document has no text and no media, embed or CTA (packages/content isRichDocEmpty). */
export function isRichDocEmpty(doc: unknown): boolean {
  if (!isRichDoc(doc) || doc.content.length === 0) return true;
  const atoms = new Set(["image", "statistic", "quote", "cta", "entryEmbed", "productEmbed", "embed"]);
  const visit = (n: DocNode): boolean => (n.type === "text" && Boolean(n.text?.trim())) || atoms.has(n.type) || (n.content ?? []).some(visit);
  return !doc.content.some(visit);
}

/** Plain text of nodes (tables, answers, previews). */
export function plainText(nodes: readonly DocNode[] | undefined, separator = " "): string {
  const parts: string[] = [];
  const visit = (n: DocNode) => {
    if (n.type === "text" && n.text) parts.push(n.text);
    else if (n.type === "hardBreak") parts.push("\n");
    n.content?.forEach(visit);
  };
  for (const n of nodes ?? []) {
    const before = parts.length;
    visit(n);
    if (parts.length > before) parts.push(separator);
  }
  return parts.join("").trim();
}

/** Text characters of a document, attribute text included (the per-locale size limit of the API). */
export function richDocCharCount(doc: unknown): number {
  if (!isRichDoc(doc)) return 0;
  let count = 0;
  const visit = (n: DocNode) => {
    if (n.type === "text") count += n.text?.length ?? 0;
    for (const key of ["alt", "caption", "value", "label", "text", "attribution", "role", "question", "title"]) {
      const v = n.attrs?.[key];
      if (typeof v === "string") count += v.length;
    }
    n.content?.forEach(visit);
  };
  doc.content.forEach(visit);
  return count;
}

/** Paragraphs of plain text (one per line), for simple nested content such as table cells. */
export function textToParagraphs(text: string): DocNode[] {
  const lines = text.split("\n");
  return [{ type: "paragraph", ...(text.trim() ? { content: lines.flatMap((line, i) => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]) } : {}) }];
}

/** Flow content (paragraphs and lists) of a nested editor's document, for callouts and FAQ answers. */
export function toFlowContent(doc: RichDoc): DocNode[] {
  const ctx: Ctx = { nodes: new Set(["paragraph", "bulletList", "orderedList"]), marks: new Set(MARK_ORDER) };
  return doc.content.flatMap((n) => flowFromEditor(n, ctx));
}
