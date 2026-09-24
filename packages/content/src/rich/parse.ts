import { parseDocument } from "htmlparser2";
import { isTag, isText, type ChildNode, type Element } from "domhandler";
import { anchorId, e164Phone, externalUrl, type LinkTarget } from "../links";
import { sanitizeDescriptionHtml, sanitizeRichText } from "./sanitize";
import {
  RICH_BLOCK_TYPES,
  RICH_MARK_TYPES,
  type RichBlock,
  type RichBlockType,
  type RichDoc,
  type RichFlowBlock,
  type RichInline,
  type RichListItem,
  type RichMark,
  type RichMarkType,
  type RichParagraph,
  type RichTableCell,
  type RichTableRow,
} from "./schema";

/**
 * Pasted or imported HTML → richDoc. The HTML is first cleaned with the shared sanitizer (the
 * same allow-list as stored rich text), then parsed with a real HTML parser and mapped onto
 * the node allow-list of the target field: structure the field does not allow degrades to what
 * it does (headings to bold paragraphs, lists and tables to paragraphs), never to raw HTML.
 */

export interface HtmlToDocOptions {
  /** Block types of the target field (default: all). */
  nodes?: readonly RichBlockType[] | undefined;
  /** Marks of the target field (default: all). */
  marks?: readonly RichMarkType[] | undefined;
  /**
   * Maps the https source of an imported image to an uploaded asset id. Without it (or when it
   * returns null) images are dropped: rich text only references assets, never external hosts.
   */
  imageAsset?: ((src: string, alt: string) => string | null) | undefined;
  /**
   * Maps an href that is not an https/mailto/tel URL or an #anchor (a relative site path such
   * as "/pages/hakkimizda") to a link target. Unmapped links keep their text only.
   */
  resolveHref?: ((href: string) => LinkTarget | null) | undefined;
}

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "del", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "u", "var",
]);

const MAX_LIST_DEPTH = 3;

interface Ctx {
  nodes: Set<string>;
  marks: Set<string>;
  options: HtmlToDocOptions;
}

function collapse(text: string): string {
  return text.replace(/[\t\n\r\f ]+/g, " ");
}

function linkMark(el: Element, ctx: Ctx): RichMark | null {
  const href = (el.attribs.href ?? "").trim();
  if (!href) return null;
  let target: LinkTarget | null = null;
  if (/^(https:|mailto:)/i.test(href)) {
    const parsed = externalUrl.safeParse(href);
    target = parsed.success ? { type: "url", url: parsed.data } : null;
  } else if (/^tel:/i.test(href)) {
    const phone = e164Phone.safeParse(href.slice(4).replace(/[\s().-]/g, ""));
    target = phone.success ? { type: "tel", phone: phone.data } : null;
  } else if (href.startsWith("#")) {
    const anchor = anchorId.safeParse(href.slice(1).toLowerCase());
    target = anchor.success ? { type: "anchor", anchor: anchor.data } : null;
  } else {
    target = ctx.options.resolveHref?.(href) ?? null;
  }
  if (!target) return null;
  const rel = (el.attribs.rel ?? "")
    .split(/\s+/)
    .filter((r): r is "nofollow" | "sponsored" | "ugc" => r === "nofollow" || r === "sponsored" || r === "ugc");
  return {
    type: "link",
    attrs: { target, ...(el.attribs.target === "_blank" ? { openInNewTab: true } : {}), ...(rel.length ? { rel } : {}) },
  };
}

function markFor(el: Element, ctx: Ctx): RichMark | null {
  switch (el.name) {
    case "strong":
    case "b":
      return { type: "bold" };
    case "em":
    case "i":
      return { type: "italic" };
    case "u":
      return { type: "underline" };
    case "s":
    case "strike":
    case "del":
      return { type: "strike" };
    case "code":
    case "kbd":
    case "samp":
      return { type: "code" };
    case "a":
      return linkMark(el, ctx);
    default:
      return null;
  }
}

function inlineFrom(nodes: ChildNode[], marks: RichMark[], ctx: Ctx): RichInline[] {
  const out: RichInline[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      const text = collapse(node.data);
      if (text) out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      continue;
    }
    if (!isTag(node)) continue;
    if (node.name === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    const mark = markFor(node, ctx);
    const next = mark && ctx.marks.has(mark.type) && !marks.some((m) => m.type === mark.type) ? [...marks, mark] : marks;
    // Block elements inside inline context (e.g. <a><div>…</div></a>) contribute their text.
    out.push(...inlineFrom(node.children, next, ctx));
  }
  return out;
}

/** Trims edges, drops empty runs and merges neighbours with identical marks. */
function normalizeInline(nodes: RichInline[]): RichInline[] {
  const merged: RichInline[] = [];
  for (const node of nodes) {
    const prev = merged[merged.length - 1];
    if (node.type === "text" && prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      merged[merged.length - 1] = { ...prev, text: prev.text + node.text };
    } else if (node.type === "text" && prev?.type === "hardBreak") {
      merged.push({ ...node, text: node.text.replace(/^ /, "") });
    } else {
      merged.push(node);
    }
  }
  while (merged[0]?.type === "hardBreak") merged.shift();
  while (merged[merged.length - 1]?.type === "hardBreak") merged.pop();
  const first = merged[0];
  if (first?.type === "text") merged[0] = { ...first, text: first.text.replace(/^ +/, "") };
  const last = merged[merged.length - 1];
  if (last?.type === "text") merged[merged.length - 1] = { ...last, text: last.text.replace(/ +$/, "") };
  return merged
    .map((n) => (n.type === "text" && n.text.length > 20_000 ? { ...n, text: n.text.slice(0, 20_000) } : n))
    .filter((n) => n.type === "hardBreak" || n.text.length > 0);
}

function paragraph(content: RichInline[]): RichParagraph | null {
  const normalized = normalizeInline(content);
  return normalized.length ? { type: "paragraph", content: normalized } : null;
}

function withBold(content: RichInline[], ctx: Ctx): RichInline[] {
  if (!ctx.marks.has("bold")) return content;
  return content.map((n) => (n.type === "text" && !n.marks?.some((m) => m.type === "bold") ? { ...n, marks: [...(n.marks ?? []), { type: "bold" as const }] } : n));
}

/** Text-only fallback of a block (for containers that only take paragraphs). */
function asParagraphs(blocks: RichBlock[]): RichParagraph[] {
  const out: RichParagraph[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph") out.push(b);
    else if (b.type === "heading") {
      const p = paragraph(b.content ?? []);
      if (p) out.push(p);
    } else if (b.type === "bulletList" || b.type === "orderedList") {
      b.content.forEach((item, i) => {
        const inner = asParagraphs(item.content);
        const [head, ...rest] = inner;
        if (!head) return;
        const bullet = b.type === "orderedList" ? `${(b.attrs?.start ?? 1) + i}. ` : "• ";
        out.push({ type: "paragraph", content: [{ type: "text", text: bullet }, ...(head.content ?? [])] }, ...rest);
      });
    } else if (b.type === "blockquote" || b.type === "callout") out.push(...asParagraphs(b.content));
    else if (b.type === "table") {
      for (const row of b.content) {
        const cells = row.content.map((c) => asParagraphs(c.content).map((p) => (p.content ?? []).map((n) => (n.type === "text" ? n.text : " ")).join("")).join(" "));
        const p = paragraph([{ type: "text", text: cells.join(" | ") }]);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

function flowOnly(blocks: RichBlock[]): RichFlowBlock[] {
  const out: RichFlowBlock[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "bulletList" || b.type === "orderedList") out.push(b);
    else out.push(...asParagraphs([b]));
  }
  return out;
}

function listFrom(el: Element, ctx: Ctx, depth: number): RichBlock[] {
  const ordered = el.name === "ol";
  const items: RichListItem[] = [];
  for (const child of el.children) {
    if (!isTag(child)) continue;
    const content = child.name === "li" ? blocksFrom(child.children, ctx, depth + 1) : blocksFrom([child], ctx, depth + 1);
    const flow = flowOnly(content).slice(0, 20);
    if (flow.length) items.push({ type: "listItem", content: flow });
  }
  if (!items.length) return [];
  const start = ordered ? Number.parseInt(el.attribs.start ?? "1", 10) : 1;
  const list: RichBlock = ordered
    ? { type: "orderedList", ...(Number.isFinite(start) && start !== 1 && start >= 0 ? { attrs: { start } } : {}), content: items.slice(0, 500) }
    : { type: "bulletList", content: items.slice(0, 500) };
  if (!ctx.nodes.has(list.type) || depth >= MAX_LIST_DEPTH) return asParagraphs([list]);
  return [list];
}

function tableFrom(el: Element, ctx: Ctx, depth: number): RichBlock[] {
  const rows: Element[] = [];
  const collect = (nodes: ChildNode[]) => {
    for (const n of nodes) {
      if (!isTag(n)) continue;
      if (n.name === "tr") rows.push(n);
      else if (n.name === "thead" || n.name === "tbody" || n.name === "tfoot") collect(n.children);
    }
  };
  collect(el.children);
  const tableRows: RichTableRow[] = [];
  for (const [i, row] of rows.slice(0, 200).entries()) {
    const cells: RichTableCell[] = [];
    for (const cell of row.children) {
      if (!isTag(cell) || (cell.name !== "td" && cell.name !== "th")) continue;
      const content = asParagraphs(blocksFrom(cell.children, ctx, depth + 1)).slice(0, 20);
      const colspan = Number.parseInt(cell.attribs.colspan ?? "1", 10);
      const rowspan = Number.parseInt(cell.attribs.rowspan ?? "1", 10);
      const attrs = {
        ...(colspan > 1 && colspan <= 20 ? { colspan } : {}),
        ...(rowspan > 1 && rowspan <= 200 ? { rowspan } : {}),
      };
      cells.push({
        // The first row is always the header row.
        type: i === 0 || cell.name === "th" ? "tableHeader" : "tableCell",
        ...(Object.keys(attrs).length ? { attrs } : {}),
        content: content.length ? content : [{ type: "paragraph" }],
      });
    }
    if (cells.length) tableRows.push({ type: "tableRow", content: cells.slice(0, 20) });
  }
  if (!tableRows.length) return [];
  tableRows[0] = { ...tableRows[0]!, content: tableRows[0]!.content.map((c) => ({ ...c, type: "tableHeader" })) };
  const table: RichBlock = { type: "table", content: tableRows };
  return ctx.nodes.has("table") ? [table] : asParagraphs([table]);
}

function imageFrom(img: Element, caption: string | null, ctx: Ctx): RichBlock[] {
  if (!ctx.nodes.has("image") || !ctx.options.imageAsset) return [];
  const src = img.attribs.src ?? "";
  const alt = collapse(img.attribs.alt ?? "").trim().slice(0, 300);
  const assetId = src ? ctx.options.imageAsset(src, alt) : null;
  if (!assetId) return [];
  return [
    {
      type: "image",
      attrs: { assetId, ...(alt ? { alt } : {}), ...(caption ? { caption: caption.slice(0, 500) } : {}) },
    },
  ];
}

function textOf(nodes: ChildNode[]): string {
  return nodes.map((n) => (isText(n) ? n.data : isTag(n) ? textOf(n.children) : "")).join("");
}

function blockFrom(el: Element, ctx: Ctx, depth: number): RichBlock[] {
  switch (el.name) {
    case "p": {
      const p = paragraph(inlineFrom(el.children, [], ctx));
      return p ? [p] : [];
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const content = normalizeInline(inlineFrom(el.children, [], ctx));
      if (!content.length) return [];
      if (!ctx.nodes.has("heading")) return [{ type: "paragraph", content: withBold(content, ctx) }];
      // h1 belongs to the page; deeper levels than h4 flatten to h4.
      const level = Math.min(4, Math.max(2, Number(el.name[1]))) as 2 | 3 | 4;
      return [{ type: "heading", attrs: { level }, content }];
    }
    case "ul":
    case "ol":
      return listFrom(el, ctx, depth);
    case "blockquote": {
      const content = flowOnly(blocksFrom(el.children, ctx, depth + 1)).slice(0, 200);
      if (!content.length) return [];
      return ctx.nodes.has("blockquote") ? [{ type: "blockquote", content }] : content;
    }
    case "table":
      return tableFrom(el, ctx, depth);
    case "img":
      return imageFrom(el, null, ctx);
    case "figure": {
      const img = el.children.find((c): c is Element => isTag(c) && c.name === "img");
      const cap = el.children.find((c): c is Element => isTag(c) && c.name === "figcaption");
      const caption = cap ? collapse(textOf(cap.children)).trim() : null;
      if (img) return imageFrom(img, caption, ctx);
      return blocksFrom(el.children, ctx, depth);
    }
    case "pre": {
      const text = textOf(el.children).replace(/\s+$/, "");
      if (!text.trim()) return [];
      return text.split(/\n/).flatMap((line) => {
        const p = line.trim() ? paragraph([{ type: "text", text: line, ...(ctx.marks.has("code") ? { marks: [{ type: "code" as const }] } : {}) }]) : null;
        return p ? [p] : [];
      });
    }
    case "hr":
    case "script":
    case "style":
    case "template":
    case "noscript":
      return [];
    default:
      // div, section, article, figcaption outside a figure…: their content.
      return blocksFrom(el.children, ctx, depth);
  }
}

function blocksFrom(nodes: ChildNode[], ctx: Ctx, depth: number): RichBlock[] {
  const out: RichBlock[] = [];
  let run: RichInline[] = [];
  const flush = () => {
    const p = paragraph(run);
    if (p) out.push(p);
    run = [];
  };
  for (const node of nodes) {
    if (isText(node)) {
      run.push(...inlineFrom([node], [], ctx));
      continue;
    }
    if (!isTag(node)) continue;
    if (INLINE_TAGS.has(node.name)) {
      run.push(...inlineFrom([node], [], ctx));
      continue;
    }
    flush();
    out.push(...blockFrom(node, ctx, depth));
  }
  flush();
  return out;
}

/** Converts HTML into a richDoc that fits the given field options. */
export function htmlToDoc(html: string, options: HtmlToDocOptions = {}): RichDoc {
  const clean = options.imageAsset ? sanitizeDescriptionHtml(html) : sanitizeRichText(html);
  const dom = parseDocument(clean, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const ctx: Ctx = {
    nodes: new Set(options.nodes ?? RICH_BLOCK_TYPES),
    marks: new Set(options.marks ?? RICH_MARK_TYPES),
    options,
  };
  let content = blocksFrom(dom.children, ctx, 0);
  if (!ctx.nodes.has("paragraph")) content = content.filter((b) => b.type !== "paragraph");
  return { type: "doc", content: content.slice(0, 5_000) };
}

/** Plain text split into paragraphs on blank lines (text fields imported into richDoc). */
export function textToDoc(text: string): RichDoc {
  const content: RichBlock[] = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const inline: RichInline[] = [];
    lines.forEach((line, i) => {
      if (i > 0) inline.push({ type: "hardBreak" });
      inline.push({ type: "text", text: line.slice(0, 20_000) });
    });
    if (inline.length) content.push({ type: "paragraph", content: inline });
  }
  return { type: "doc", content };
}
