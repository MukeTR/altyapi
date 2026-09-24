import { slugify } from "@altyapi/commerce-core";
import { internalToken, isExternalTarget, linkTargetHref, type InternalLinkKind, type LinkTarget, type TokenKind } from "../links";
import type {
  EmbedProvider,
  RichBlock,
  RichDoc,
  RichFaqItem,
  RichFlowBlock,
  RichHeading,
  RichImage,
  RichInline,
  RichListItem,
  RichMark,
  RichParagraph,
  RichTable,
  RichTableCell,
  RichTextNode,
} from "./schema";
import { walkRichDoc } from "./schema";

/**
 * Renderers of richDoc. Output is built from a validated tree with every text and attribute
 * escaped, so it is safe by construction; nothing user-supplied reaches the output as markup.
 *
 * Internal references are emitted as tokens so derived output can be stored at publish time
 * and resolved against what is live when it is rendered:
 *   - links:  <a href="alt:entry/{id}">…</a>      Markdown [text](alt:entry/{id})
 *   - images: <figure class="rt-image …" data-alt-asset="{id}"><img src="alt:asset/{id}" …></figure>
 *   - record embeds: <div class="rt-embed-record" data-alt-embed="entry/{id}"></div>
 * resolveHtmlTokens / resolveMarkdownTokens replace them; a target that is not live renders
 * as plain text (links) or is left out (images, embeds, CTAs).
 */

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  src: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  srcset?: string | null | undefined;
  sizes?: string | null | undefined;
}

export interface ResolvedEmbed {
  href: string;
  title: string;
  summary?: string | null | undefined;
}

export interface RichResolver {
  /** Live URL of an internal link target; null when it is not live. */
  href(kind: InternalLinkKind, id: string): string | null;
  /** Image source of an asset; null (or no resolver) leaves the image out. */
  asset?(id: string): ResolvedAsset | null;
  /** Card of an embedded entry or product; null (or no resolver) leaves the embed out. */
  embed?(kind: "entry" | "product", id: string): ResolvedEmbed | null;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Escapes Markdown syntax characters in running text. */
export function escapeMarkdown(value: string): string {
  return value
    .replace(/([\\`*_[\]<>|~])/g, "\\$1")
    .replace(/\r?\n/g, " ")
    .replace(/^(\s*)([#>+-]|\d+\.)(?=\s)/, "$1\\$2");
}

// ---------------------------------------------------------------------------
// Headings and anchors
// ---------------------------------------------------------------------------

export interface OutlineItem {
  level: 2 | 3 | 4;
  text: string;
  /** Unique, Turkish-aware slug used as the heading id. */
  anchor: string;
}

function inlineText(content: RichInline[] | undefined): string {
  return (content ?? []).map((n) => (n.type === "text" ? n.text : " ")).join("").replace(/\s+/g, " ").trim();
}

/** Headings in document order with de-duplicated anchors ("sss", "sss-2", …). */
function headingAnchors(doc: RichDoc): Map<RichHeading, OutlineItem> {
  const used = new Map<string, number>();
  const out = new Map<RichHeading, OutlineItem>();
  walkRichDoc(doc, (node) => {
    if (node.type !== "heading") return;
    const heading = node as unknown as RichHeading;
    const text = inlineText(heading.content);
    if (!text) return;
    const base = slugify(text, 60) || "bolum";
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    let anchor = seen === 0 ? base : `${base}-${seen + 1}`;
    // A generated suffix can collide with a heading literally named "x-2".
    while (seen > 0 && used.has(anchor)) anchor = `${anchor}-${seen + 1}`;
    if (seen > 0) used.set(anchor, 1);
    out.set(heading, { level: heading.attrs.level, text, anchor });
  });
  return out;
}

export function outline(doc: RichDoc): OutlineItem[] {
  return [...headingAnchors(doc).values()];
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const MARK_ORDER: RichMark["type"][] = ["citation", "bold", "italic", "underline", "strike", "code"];

function wrapMarks(text: string, marks: RichMark[]): string {
  let html = escapeHtml(text);
  // Innermost first: code, strike, underline, italic, bold, citation.
  for (const type of [...MARK_ORDER].reverse()) {
    const mark = marks.find((m) => m.type === type);
    if (!mark) continue;
    if (mark.type === "code") html = `<code>${html}</code>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "citation") html = `<cite class="rt-citation" title="${escapeHtml(mark.attrs.title)}">${html}</cite>`;
  }
  return html;
}

function linkOf(node: RichInline): Extract<RichMark, { type: "link" }> | undefined {
  return node.type === "text" ? (node.marks?.find((m) => m.type === "link") as Extract<RichMark, { type: "link" }> | undefined) : undefined;
}

function sameLink(a: Extract<RichMark, { type: "link" }> | undefined, b: Extract<RichMark, { type: "link" }> | undefined): boolean {
  return !!a && !!b && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
}

/** Opening tag of a link; internal targets are always the bare token form so they can be resolved later. */
function anchorOpen(target: LinkTarget, openInNewTab: boolean | undefined, rel: string[] | undefined): string {
  const href = linkTargetHref(target)!;
  if (!isExternalTarget(target)) return `<a href="${escapeHtml(href)}">`;
  const rels = new Set(rel ?? []);
  let attrs = "";
  if (openInNewTab) {
    rels.add("noopener");
    rels.add("noreferrer");
    attrs = ' target="_blank"';
  }
  return `<a href="${escapeHtml(href)}"${attrs}${rels.size ? ` rel="${[...rels].join(" ")}"` : ""}>`;
}

function inlineHtml(content: RichInline[] | undefined): string {
  const nodes = content ?? [];
  let html = "";
  for (let i = 0; i < nodes.length; ) {
    const link = linkOf(nodes[i]!);
    if (!link) {
      const n = nodes[i]!;
      html += n.type === "hardBreak" ? "<br>" : wrapMarks(n.text, n.marks ?? []);
      i++;
      continue;
    }
    // Consecutive text with the same link becomes one anchor.
    let inner = "";
    while (i < nodes.length && sameLink(linkOf(nodes[i]!), link)) {
      const n = nodes[i] as RichTextNode;
      inner += wrapMarks(n.text, (n.marks ?? []).filter((m) => m.type !== "link"));
      i++;
    }
    html += `${anchorOpen(link.attrs.target, link.attrs.openInNewTab, link.attrs.rel)}${inner}</a>`;
  }
  return html;
}

/** Content of a list item or cell: a single paragraph renders inline, without <p>. */
function compactFlowHtml(content: (RichParagraph | RichFlowBlock)[], anchors: Map<RichHeading, OutlineItem>): string {
  if (content.length === 1 && content[0]!.type === "paragraph") return inlineHtml(content[0]!.content);
  return content.map((b) => blockHtml(b, anchors)).join("");
}

function listItemsHtml(items: RichListItem[], anchors: Map<RichHeading, OutlineItem>): string {
  return items.map((item) => `<li>${compactFlowHtml(item.content, anchors)}</li>`).join("");
}

function cellHtml(cell: RichTableCell, anchors: Map<RichHeading, OutlineItem>, header: boolean): string {
  const tag = header ? "th" : cell.type === "tableHeader" ? "th" : "td";
  const span = `${cell.attrs?.colspan && cell.attrs.colspan > 1 ? ` colspan="${cell.attrs.colspan}"` : ""}${cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? ` rowspan="${cell.attrs.rowspan}"` : ""}`;
  const scope = header ? ' scope="col"' : tag === "th" ? ' scope="row"' : "";
  return `<${tag}${scope}${span}>${compactFlowHtml(cell.content, anchors)}</${tag}>`;
}

function tableHtml(table: RichTable, anchors: Map<RichHeading, OutlineItem>): string {
  const [head, ...rows] = table.content;
  const thead = head ? `<thead><tr>${head.content.map((c) => cellHtml(c, anchors, true)).join("")}</tr></thead>` : "";
  const tbody = rows.length ? `<tbody>${rows.map((r) => `<tr>${r.content.map((c) => cellHtml(c, anchors, false)).join("")}</tr>`).join("")}</tbody>` : "";
  return `<div class="rt-table"><table>${thead}${tbody}</table></div>`;
}

function imageHtml(image: RichImage): string {
  const a = image.attrs;
  const alt = a.decorative ? "" : (a.alt ?? "");
  const caption = a.caption ? `<figcaption>${escapeHtml(a.caption)}</figcaption>` : "";
  return `<figure class="rt-image rt-image-${a.width ?? "normal"}" data-alt-asset="${a.assetId}"><img src="${internalToken("asset", a.assetId)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">${caption}</figure>`;
}

const PROVIDER_NAMES: Record<EmbedProvider, string> = { youtube: "YouTube", vimeo: "Vimeo", google_maps: "Google Maps", spotify: "Spotify" };

/** Public page of an embedded item (the consent-free fallback link). */
export function embedUrl(provider: EmbedProvider, id: string, start?: number): string {
  switch (provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
    case "vimeo":
      return `https://vimeo.com/${id}${start ? `#t=${start}s` : ""}`;
    case "google_maps":
      return `https://www.google.com/maps/place/?q=place_id:${id}`;
    case "spotify":
      return `https://open.spotify.com/${id}`;
  }
}

function faqItemHtml(item: RichFaqItem, anchors: Map<RichHeading, OutlineItem>): string {
  return `<details class="rt-faq-item"><summary>${escapeHtml(item.attrs.question)}</summary><div class="rt-faq-answer">${item.content.map((b) => blockHtml(b, anchors)).join("")}</div></details>`;
}

function blockHtml(block: RichBlock, anchors: Map<RichHeading, OutlineItem>): string {
  switch (block.type) {
    case "paragraph": {
      const inner = inlineHtml(block.content);
      return inner.trim() ? `<p>${inner}</p>` : "";
    }
    case "heading": {
      const item = anchors.get(block);
      if (!item) return "";
      return `<h${block.attrs.level} id="${item.anchor}">${inlineHtml(block.content)}</h${block.attrs.level}>`;
    }
    case "bulletList":
      return `<ul>${listItemsHtml(block.content, anchors)}</ul>`;
    case "orderedList": {
      const start = block.attrs?.start;
      return `<ol${start !== undefined && start !== 1 ? ` start="${start}"` : ""}>${listItemsHtml(block.content, anchors)}</ol>`;
    }
    case "blockquote":
      return `<blockquote>${block.content.map((b) => blockHtml(b, anchors)).join("")}</blockquote>`;
    case "table":
      return tableHtml(block, anchors);
    case "image":
      return imageHtml(block);
    case "callout":
      return `<aside class="rt-callout rt-callout-${block.attrs.tone}" role="note">${block.content.map((b) => blockHtml(b, anchors)).join("")}</aside>`;
    case "statistic": {
      const a = block.attrs;
      const s = a.source;
      const sourceTitle = s ? (s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)) : "";
      const sourceMeta = s ? [s.publisher, s.date].filter(Boolean).map((v) => escapeHtml(v!)).join(", ") : "";
      const source = s ? ` <cite class="rt-statistic-source">${sourceTitle}${sourceMeta ? ` (${sourceMeta})` : ""}</cite>` : "";
      return `<figure class="rt-statistic"><p class="rt-statistic-value">${escapeHtml(a.value)}</p><figcaption><span class="rt-statistic-label">${escapeHtml(a.label)}</span>${source}</figcaption></figure>`;
    }
    case "quote": {
      const a = block.attrs;
      const cite = a.sourceUrl ? ` cite="${escapeHtml(a.sourceUrl)}"` : "";
      const by = a.attribution ? `<figcaption>${escapeHtml(a.attribution)}${a.role ? `, ${escapeHtml(a.role)}` : ""}</figcaption>` : "";
      return `<figure class="rt-quote"><blockquote${cite}><p>${escapeHtml(a.text)}</p></blockquote>${by}</figure>`;
    }
    case "faqGroup":
      return `<div class="rt-faq">${block.content.map((item) => faqItemHtml(item, anchors)).join("")}</div>`;
    case "cta": {
      const a = block.attrs;
      const href = linkTargetHref(a.target)!;
      // Internal CTAs keep the bare token form (resolved, or dropped as a whole, later).
      const external = isExternalTarget(a.target) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<p class="rt-cta rt-cta-${a.variant}"><a href="${escapeHtml(href)}"${external}>${escapeHtml(a.label)}</a></p>`;
    }
    case "entryEmbed":
      return `<div class="rt-embed-record" data-alt-embed="entry/${block.attrs.entryId}"></div>`;
    case "productEmbed":
      return `<div class="rt-embed-record" data-alt-embed="product/${block.attrs.productId}"></div>`;
    case "embed": {
      const a = block.attrs;
      const title = a.title || PROVIDER_NAMES[a.provider];
      const start = a.start ? ` data-embed-start="${a.start}"` : "";
      // No iframe: the storefront swaps the placeholder for the player after consent.
      return `<figure class="rt-embed rt-embed-${a.provider}" data-embed-provider="${a.provider}" data-embed-id="${escapeHtml(a.id)}"${start}><a href="${escapeHtml(embedUrl(a.provider, a.id, a.start))}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></figure>`;
    }
  }
}

/**
 * Sanitized HTML of a document. Without a resolver, internal links, images and record embeds
 * are tokens (the form stored at publish time); with one, the output is final.
 */
export function toHtml(doc: RichDoc, options: { resolver?: RichResolver } = {}): string {
  const anchors = headingAnchors(doc);
  const html = doc.content.map((b) => blockHtml(b, anchors)).join("");
  return options.resolver ? resolveHtmlTokens(html, options.resolver) : html;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LINK_KINDS = "page|entry|product|collection";

/** Resolves the tokens of stored (derived) HTML against what is live now. */
export function resolveHtmlTokens(html: string, resolver: RichResolver): string {
  return html
    .replace(new RegExp(`<figure class="([^"]*)" data-alt-asset="(${UUID})">([\\s\\S]*?)</figure>`, "g"), (_m, cls: string, id: string, inner: string) => {
      const asset = resolver.asset?.(id);
      if (!asset) return "";
      const size = `${asset.width ? ` width="${asset.width}"` : ""}${asset.height ? ` height="${asset.height}"` : ""}`;
      const srcset = asset.srcset ? ` srcset="${escapeHtml(asset.srcset)}"${asset.sizes ? ` sizes="${escapeHtml(asset.sizes)}"` : ""}` : "";
      return `<figure class="${cls}">${inner.replace(`src="${internalToken("asset", id)}"`, `src="${escapeHtml(asset.src)}"${size}${srcset}`)}</figure>`;
    })
    .replace(new RegExp(`<div class="rt-embed-record" data-alt-embed="(entry|product)/(${UUID})"></div>`, "g"), (_m, kind: "entry" | "product", id: string) => {
      const card = resolver.embed?.(kind, id);
      if (!card) return "";
      const summary = card.summary ? `<p>${escapeHtml(card.summary)}</p>` : "";
      return `<aside class="rt-card rt-card-${kind}"><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a>${summary}</aside>`;
    })
    .replace(new RegExp(`<p class="(rt-cta [^"]*)"><a href="alt:(${LINK_KINDS})/(${UUID})">([\\s\\S]*?)</a></p>`, "g"), (_m, cls: string, kind: InternalLinkKind, id: string, label: string) => {
      const href = resolver.href(kind, id);
      return href ? `<p class="${cls}"><a href="${escapeHtml(href)}">${label}</a></p>` : "";
    })
    .replace(new RegExp(`<a href="alt:(${LINK_KINDS})/(${UUID})">([\\s\\S]*?)</a>`, "g"), (_m, kind: InternalLinkKind, id: string, inner: string) => {
      const href = resolver.href(kind, id);
      return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    });
}

/** Internal tokens (links, images, embeds) present in stored HTML or Markdown. */
export function tokensIn(text: string): { kind: TokenKind; id: string }[] {
  const out = new Map<string, { kind: TokenKind; id: string }>();
  for (const m of text.matchAll(new RegExp(`alt:(${LINK_KINDS}|asset)/(${UUID})`, "g"))) out.set(`${m[1]}/${m[2]}`, { kind: m[1] as TokenKind, id: m[2]! });
  for (const m of text.matchAll(new RegExp(`data-alt-embed="(entry|product)/(${UUID})"`, "g"))) out.set(`${m[1]}/${m[2]}`, { kind: m[1] as TokenKind, id: m[2]! });
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function inlineMarkdown(content: RichInline[] | undefined): string {
  const nodes = content ?? [];
  let md = "";
  for (let i = 0; i < nodes.length; ) {
    const n = nodes[i]!;
    const link = linkOf(n);
    const renderText = (t: RichTextNode) => {
      let s = escapeMarkdown(t.text);
      const marks = t.marks ?? [];
      if (marks.some((m) => m.type === "code")) s = t.text.includes("`") ? `\`\` ${t.text.replace(/\r?\n/g, " ")} \`\`` : `\`${t.text.replace(/\r?\n/g, " ")}\``;
      if (marks.some((m) => m.type === "strike")) s = `~~${s}~~`;
      if (marks.some((m) => m.type === "italic")) s = `*${s}*`;
      if (marks.some((m) => m.type === "bold")) s = `**${s}**`;
      const citation = marks.find((m) => m.type === "citation") as Extract<RichMark, { type: "citation" }> | undefined;
      if (citation) s += citation.attrs.url ? ` ([${escapeMarkdown(citation.attrs.title)}](${citation.attrs.url}))` : ` (${escapeMarkdown(citation.attrs.title)})`;
      return s;
    };
    if (!link) {
      md += n.type === "hardBreak" ? "  \n" : renderText(n);
      i++;
      continue;
    }
    let inner = "";
    while (i < nodes.length && sameLink(linkOf(nodes[i]!), link)) {
      inner += renderText(nodes[i] as RichTextNode);
      i++;
    }
    md += `[${inner}](${linkTargetHref(link.attrs.target)})`;
  }
  return md;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : line ? prefix + line : line))
    .join("\n");
}

function listMarkdown(items: RichListItem[], ordered: boolean, start = 1): string {
  return items
    .map((item, i) => {
      const bullet = ordered ? `${start + i}. ` : "- ";
      const body = item.content.map((b) => blockMarkdown(b)).filter(Boolean).join("\n");
      return bullet + indent(body, " ".repeat(bullet.length));
    })
    .join("\n");
}

function cellMarkdown(cell: RichTableCell): string {
  return cell.content.map((p) => inlineMarkdown(p.content)).join(" ").replace(/\|/g, "\\|");
}

function blockMarkdown(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
      return inlineMarkdown(block.content).trim();
    case "heading":
      return `${"#".repeat(block.attrs.level)} ${inlineMarkdown(block.content).trim()}`;
    case "bulletList":
      return listMarkdown(block.content, false);
    case "orderedList":
      return listMarkdown(block.content, true, block.attrs?.start ?? 1);
    case "blockquote":
      return block.content
        .map(blockMarkdown)
        .join("\n\n")
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "table": {
      const [head, ...rows] = block.content;
      if (!head) return "";
      const width = head.content.length;
      const line = (cells: string[]) => `| ${[...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, width).join(" | ")} |`;
      return [line(head.content.map(cellMarkdown)), line(Array(width).fill("---")), ...rows.map((r) => line(r.content.map(cellMarkdown)))].join("\n");
    }
    case "image": {
      const a = block.attrs;
      if (a.decorative) return "";
      const title = a.caption ? ` "${a.caption.replace(/["\\]/g, "\\$&")}"` : "";
      return `![${escapeMarkdown(a.alt ?? "")}](${internalToken("asset", a.assetId)}${title})`;
    }
    case "callout":
      return block.content
        .map(blockMarkdown)
        .join("\n\n")
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "statistic": {
      const a = block.attrs;
      const s = a.source;
      const source = s ? ` (${s.url ? `[${escapeMarkdown(s.title)}](${s.url})` : escapeMarkdown(s.title)}${[s.publisher, s.date].filter(Boolean).length ? `, ${[s.publisher, s.date].filter(Boolean).map((v) => escapeMarkdown(v!)).join(", ")}` : ""})` : "";
      return `**${escapeMarkdown(a.value)}** ${escapeMarkdown(a.label)}${source}`;
    }
    case "quote": {
      const a = block.attrs;
      const by = a.attribution ? `\n>\n> ${escapeMarkdown(a.attribution)}${a.role ? `, ${escapeMarkdown(a.role)}` : ""}` : "";
      return `> ${escapeMarkdown(a.text)}${by}`;
    }
    case "faqGroup":
      return block.content.map((item) => `**${escapeMarkdown(item.attrs.question)}**\n\n${item.content.map(blockMarkdown).join("\n\n")}`).join("\n\n");
    case "cta":
      return `[${escapeMarkdown(block.attrs.label)}](${linkTargetHref(block.attrs.target)} "cta")`;
    case "entryEmbed":
      return `[alt-embed](${internalToken("entry", block.attrs.entryId)})`;
    case "productEmbed":
      return `[alt-embed](${internalToken("product", block.attrs.productId)})`;
    case "embed": {
      const a = block.attrs;
      return `[${escapeMarkdown(a.title || PROVIDER_NAMES[a.provider])}](${embedUrl(a.provider, a.id, a.start)})`;
    }
  }
}

/** Markdown of a document (the .md alternates and AI-facing text). Tokens as in toHtml. */
export function toMarkdown(doc: RichDoc, options: { resolver?: RichResolver } = {}): string {
  const md = doc.content.map(blockMarkdown).filter((s) => s.trim().length > 0).join("\n\n");
  return options.resolver ? resolveMarkdownTokens(md, options.resolver) : md;
}

export function resolveMarkdownTokens(md: string, resolver: RichResolver): string {
  return md
    .replace(new RegExp(`^\\[alt-embed\\]\\(alt:(entry|product)/(${UUID})\\)$`, "gm"), (_m, kind: "entry" | "product", id: string) => {
      const card = resolver.embed?.(kind, id);
      return card ? `[${escapeMarkdown(card.title)}](${card.href})` : "";
    })
    .replace(new RegExp(`!\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(alt:asset/(${UUID})((?: "(?:\\\\.|[^"\\\\])*")?)\\)`, "g"), (_m, alt: string, id: string, title: string) => {
      const asset = resolver.asset?.(id);
      return asset ? `![${alt}](${asset.src}${title})` : "";
    })
    .replace(new RegExp(`\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(alt:(${LINK_KINDS})/(${UUID})( "cta")?\\)`, "g"), (_m, inner: string, kind: InternalLinkKind, id: string, cta: string | undefined) => {
      const href = resolver.href(kind, id);
      if (href) return `[${inner}](${href})`;
      return cta ? "" : inner;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Plain text, words, Q&A, references
// ---------------------------------------------------------------------------

function blockText(block: RichBlock | RichFlowBlock | RichListItem | RichTableCell | RichFaqItem): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineText(block.content);
    case "bulletList":
    case "orderedList":
      return block.content.map(blockText).join("\n");
    case "listItem":
    case "blockquote":
    case "callout":
      return block.content.map(blockText).join("\n");
    case "table":
      return block.content.map((r) => r.content.map(blockText).join(" | ")).join("\n");
    case "tableCell":
    case "tableHeader":
      return block.content.map(blockText).join(" ");
    case "image":
      return block.attrs.caption ?? "";
    case "statistic":
      return `${block.attrs.value} ${block.attrs.label}`;
    case "quote":
      return [block.attrs.text, block.attrs.attribution].filter(Boolean).join(" — ");
    case "faqGroup":
      return block.content.map(blockText).join("\n\n");
    case "faqItem":
      return `${block.attrs.question}\n${block.content.map(blockText).join("\n")}`;
    case "cta":
      return block.attrs.label;
    case "embed":
      return block.attrs.title ?? "";
    case "entryEmbed":
    case "productEmbed":
      return "";
  }
}

/** Plain text with blocks separated by blank lines (search, summaries, word counts). */
export function toPlainText(doc: RichDoc): string {
  return doc.content
    .map(blockText)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Words of a text: runs of letters or digits (Turkish and other scripts included). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function wordCount(doc: RichDoc): number {
  return countWords(toPlainText(doc));
}

export const WORDS_PER_MINUTE = 200;

/** Reading time at about 200 words per minute; at least one minute for any text. */
export function readingMinutes(docOrWords: RichDoc | number): number {
  const words = typeof docOrWords === "number" ? docOrWords : wordCount(docOrWords);
  return words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export interface QaPair {
  question: string;
  /** Plain-text answer. */
  answer: string;
  /** Answer HTML (tokens unresolved, as toHtml). */
  answerHtml: string;
  /** faq: a faqGroup item; heading: a question-shaped H2 and the paragraphs after it. */
  source: "faq" | "heading";
  /** Heading anchor of a heading-sourced pair. */
  anchor?: string;
}

const QUESTION_END = /[?？؟]\s*$/;

/**
 * Question/answer pairs of a document: every faqGroup item, and every H2 phrased as a question
 * ("…?") that is directly followed by at least one paragraph; the answer runs until the next
 * heading or non-text block.
 */
export function extractQa(doc: RichDoc): QaPair[] {
  const anchors = headingAnchors(doc);
  const out: QaPair[] = [];
  doc.content.forEach((block, i) => {
    if (block.type === "faqGroup") {
      for (const item of block.content) {
        const answer = item.content.map(blockText).join("\n").trim();
        if (!answer) continue;
        out.push({ question: item.attrs.question.trim(), answer, answerHtml: item.content.map((b) => blockHtml(b, anchors)).join(""), source: "faq" });
      }
      return;
    }
    if (block.type !== "heading" || block.attrs.level !== 2) return;
    const question = inlineText(block.content);
    if (!QUESTION_END.test(question) || doc.content[i + 1]?.type !== "paragraph") return;
    const answerBlocks: RichFlowBlock[] = [];
    for (let j = i + 1; j < doc.content.length; j++) {
      const next = doc.content[j]!;
      if (next.type !== "paragraph" && next.type !== "bulletList" && next.type !== "orderedList") break;
      answerBlocks.push(next);
    }
    const answer = answerBlocks.map(blockText).join("\n").trim();
    if (!answer) return;
    out.push({
      question,
      answer,
      answerHtml: answerBlocks.map((b) => blockHtml(b, anchors)).join(""),
      source: "heading",
      anchor: anchors.get(block)?.anchor,
    });
  });
  return out;
}

export interface RichRef {
  kind: TokenKind;
  id: string;
}

/** Records a document points at: internal links and CTAs, images, entry and product embeds. */
export function collectRefs(doc: RichDoc): RichRef[] {
  const out = new Map<string, RichRef>();
  const add = (kind: TokenKind, id: string) => out.set(`${kind}/${id}`, { kind, id });
  const addTarget = (t: LinkTarget) => {
    if (t.type === "page" || t.type === "entry" || t.type === "product" || t.type === "collection") add(t.type, t.id);
  };
  walkRichDoc(doc, (node) => {
    if (node.type === "text") for (const m of (node as unknown as RichTextNode).marks ?? []) if (m.type === "link") addTarget(m.attrs.target);
    if (node.type === "cta") addTarget((node.attrs as { target: LinkTarget }).target);
    if (node.type === "image") add("asset", (node.attrs as { assetId: string }).assetId);
    if (node.type === "entryEmbed") add("entry", (node.attrs as { entryId: string }).entryId);
    if (node.type === "productEmbed") add("product", (node.attrs as { productId: string }).productId);
  });
  return [...out.values()];
}

/** Everything derived from one document at publish time (stored per locale in record_versions.derived). */
export interface DerivedRichDoc {
  html: string;
  markdown: string;
  plain: string;
  outline: OutlineItem[];
  qa: QaPair[];
  wordCount: number;
  readingMinutes: number;
  refs: RichRef[];
}

export function deriveRichDoc(doc: RichDoc): DerivedRichDoc {
  const plain = toPlainText(doc);
  const words = countWords(plain);
  return {
    html: toHtml(doc),
    markdown: toMarkdown(doc),
    plain,
    outline: outline(doc),
    qa: extractQa(doc),
    wordCount: words,
    readingMinutes: readingMinutes(words),
    refs: collectRefs(doc),
  };
}
