/**
 * Conversion between the API's structured rich text ("richDoc", used by rich-text@2 and faq@2)
 * and the editor's document JSON. The editor covers the everyday subset: paragraphs, headings
 * (h2–h4), bullet and numbered lists, quotes, line breaks, bold/italic/underline/strike/code and
 * links to URLs. A stored document with anything else (tables, embeds, callouts, links to pages
 * or products…) is shown read-only so saving never drops content the editor cannot represent.
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote"]);
const INLINE = new Set(["text", "hardBreak"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "code", "link"]);

/** True when every node and mark of the document can be edited (and saved back) losslessly. */
export function isEditableRichDoc(value: unknown): boolean {
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as DocNode;
    if (n.type !== "doc" && !BLOCKS.has(n.type) && !INLINE.has(n.type)) return false;
    for (const m of n.marks ?? []) {
      if (!MARKS.has(m.type)) return false;
      if (m.type === "link") {
        const target = m.attrs?.target as { type?: string } | undefined;
        if (target?.type !== "url" || m.attrs?.rel) return false;
      }
    }
    return (n.content ?? []).every(visit);
  };
  return value === undefined || value === null || visit(value);
}

/** API document → editor JSON. */
export function richDocToEditor(doc: unknown): DocNode {
  const convert = (n: DocNode): DocNode => {
    const out: DocNode = { type: n.type };
    if (n.type === "heading") out.attrs = { level: Number(n.attrs?.level ?? 2) };
    if (n.type === "orderedList" && n.attrs?.start !== undefined) out.attrs = { start: Number(n.attrs.start) };
    if (n.text !== undefined) out.text = n.text;
    if (n.marks?.length) {
      out.marks = n.marks.map((m) => {
        if (m.type !== "link") return { type: m.type };
        const target = m.attrs?.target as { url?: string } | undefined;
        return { type: "link", attrs: { href: target?.url ?? "", target: m.attrs?.openInNewTab ? "_blank" : null } };
      });
    }
    if (n.content?.length) out.content = n.content.map(convert);
    return out;
  };
  if (!doc || typeof doc !== "object") return { type: "doc", content: [{ type: "paragraph" }] };
  const d = convert(doc as DocNode);
  if (!d.content?.length) d.content = [{ type: "paragraph" }];
  return d;
}

/** Nodes that may sit inside list items and quotes in the API format. */
const NESTED_BLOCKS = new Set(["paragraph", "bulletList", "orderedList"]);

/** Editor JSON → API document. Headings inside lists and quotes become paragraphs (the API allows none). */
export function editorToRichDoc(json: DocNode): DocNode {
  const marks = (list: DocNode["marks"]) => {
    const out = (list ?? []).flatMap((m) => {
      if (m.type === "link") {
        const href = typeof m.attrs?.href === "string" ? m.attrs.href.trim() : "";
        if (!href) return [];
        return [{ type: "link", attrs: { target: { type: "url", url: href }, ...(m.attrs?.target === "_blank" ? { openInNewTab: true } : {}) } }];
      }
      return MARKS.has(m.type) ? [{ type: m.type }] : [];
    });
    return out.length ? out : undefined;
  };
  const inline = (nodes: DocNode[] | undefined): DocNode[] =>
    (nodes ?? []).flatMap((n) => {
      if (n.type === "hardBreak") return [{ type: "hardBreak" }];
      if (n.type === "text" && n.text) {
        const m = marks(n.marks);
        return [{ type: "text", text: n.text, ...(m ? { marks: m } : {}) }];
      }
      return [];
    });
  const block = (n: DocNode, nested: boolean): DocNode[] => {
    // Inside lists and quotes the API accepts only paragraphs and lists: a nested quote is
    // unwrapped and a heading becomes a paragraph.
    if (nested && n.type === "blockquote") return (n.content ?? []).flatMap((c) => block(c, true));
    const type = nested && !NESTED_BLOCKS.has(n.type) ? "paragraph" : n.type;
    switch (type) {
      case "paragraph": {
        const content = inline(n.content);
        return [{ type: "paragraph", ...(content.length ? { content } : {}) }];
      }
      case "heading": {
        const level = Math.min(4, Math.max(2, Number(n.attrs?.level ?? 2)));
        const content = inline(n.content);
        return [{ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) }];
      }
      case "bulletList":
      case "orderedList": {
        const items = (n.content ?? []).flatMap((li) => {
          const content = (li.content ?? []).flatMap((c) => block(c, true));
          return content.length ? [{ type: "listItem", content }] : [];
        });
        if (!items.length) return [];
        const start = Number(n.attrs?.start ?? 1);
        return [{ type, ...(type === "orderedList" && start !== 1 ? { attrs: { start } } : {}), content: items }];
      }
      case "blockquote": {
        const content = (n.content ?? []).flatMap((c) => block(c, true));
        return content.length ? [{ type: "blockquote", content }] : [];
      }
      default:
        return [];
    }
  };
  return { type: "doc", content: (json.content ?? []).flatMap((n) => block(n, false)) };
}

/** A document without any text (an empty editor). */
export function isEmptyDoc(doc: DocNode | null | undefined): boolean {
  const hasText = (n: DocNode): boolean => (n.type === "text" && Boolean(n.text?.trim())) || (n.content ?? []).some(hasText);
  return !doc || !hasText(doc);
}

/** The editor's HTML for an empty document. */
export function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}
