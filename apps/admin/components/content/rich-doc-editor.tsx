"use client";

import { EditorContent, Mark, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor, useEditorState, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChartColumn,
  Code,
  FileText,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Megaphone,
  MessageCircleQuestion,
  MousePointerClick,
  Package,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  Video,
  BookMarked,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { ATOM_BLOCKS, ATOM_NODE, editorToRichDoc, isRichDocEmpty, richDocCharCount, richDocToEditor, type AtomBlockType, type DocNode, type RichDoc } from "@/lib/content/rich-doc";
import type { RichBlockType, RichMarkType } from "@/lib/content/types";
import { BlockDialog, BlockIconLabel, newBlock, useBlockSummary, useEmbedLabels } from "./rich-blocks";
import { LinkTargetField, isAllowedExternalUrl, targetProblem, type LinkTarget } from "./link-target-field";
import { useRecordLabels } from "./record-pickers";

/**
 * richDoc editor (Tiptap): paragraphs, h2–h4 headings, lists and quotes are edited inline with
 * the marks bold, italic, underline, strike-through, code, citation and link (a LinkTarget:
 * address, entry, page, product, collection, anchor, phone or WhatsApp). Tables, images,
 * callouts, statistics, pull quotes, FAQ groups, calls to action and embeds are blocks edited in
 * a dialog. The output is richDoc exactly as packages/content validates it, limited to the
 * field's allowed nodes and marks; pasted content is reduced to the same set (pasted images and
 * iframes never come through).
 */

const BLOCK_ICONS: Record<AtomBlockType, LucideIcon> = {
  image: ImageIcon,
  table: TableIcon,
  callout: Megaphone,
  statistic: ChartColumn,
  quote: TextQuote,
  faqGroup: MessageCircleQuestion,
  cta: MousePointerClick,
  entryEmbed: FileText,
  productEmbed: Package,
  embed: Video,
};

const CONTENT_CLASS = [
  "min-h-48 max-h-[70vh] overflow-y-auto px-4 py-3 text-base text-fg outline-none",
  "[&_p]:my-2 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:font-semibold",
  "[&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_li>p]:my-0.5",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border-control [&_blockquote]:ps-3 [&_blockquote]:text-fg-muted",
  "[&_a]:text-link [&_a]:underline [&_cite]:bg-info-bg [&_cite]:not-italic [&_code]:rounded-sm [&_code]:bg-surface-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm",
  "[&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-focus",
].join(" ");

/** Link mark carrying a LinkTarget (never a raw href); pasted links keep only https, mailto and tel addresses. */
const LinkMark = Mark.create({
  name: "link",
  priority: 1000,
  inclusive: false,
  addAttributes() {
    return {
      target: { default: null, rendered: false },
      openInNewTab: { default: false, rendered: false },
      rel: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (el) => {
          const href = (el as HTMLElement).getAttribute("href")?.trim() ?? "";
          if (!isAllowedExternalUrl(href)) return false;
          return { target: { type: "url", url: href }, openInNewTab: (el as HTMLElement).getAttribute("target") === "_blank" };
        },
      },
    ];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const target = mark.attrs.target as LinkTarget | null;
    const href = target?.type === "url" ? target.url : target?.type === "anchor" ? `#${target.anchor}` : undefined;
    return ["a", mergeAttributes(HTMLAttributes, { ...(href ? { href } : {}), "data-target-type": target?.type ?? "url", rel: "noopener noreferrer nofollow" }), 0];
  },
});

/** Marks a claim as quoted from a source (<cite>). */
const CitationMark = Mark.create({
  name: "citation",
  inclusive: false,
  addAttributes() {
    return { title: { default: "", rendered: false }, url: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: "cite[data-citation]", getAttrs: (el) => ({ title: (el as HTMLElement).getAttribute("data-title") ?? "", url: (el as HTMLElement).getAttribute("data-url") }) }];
  },
  renderHTML({ mark }) {
    return ["cite", { "data-citation": "", "data-title": String(mark.attrs.title ?? ""), title: String(mark.attrs.title ?? "") }, 0];
  },
});

/** The document: text blocks plus top-level atom blocks (atoms never sit inside lists or quotes). */
const RichDocument = Node.create({ name: "doc", topNode: true, content: "(block | richAtom)+" });

/** An atom block (table, image, callout…) carried whole in its richDoc JSON. */
const RichBlockNode = Node.create({
  name: ATOM_NODE,
  group: "richAtom",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { node: { default: null, rendered: false } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-rich-block]",
        getAttrs: (el) => {
          try {
            const node = JSON.parse((el as HTMLElement).getAttribute("data-rich-block") ?? "") as DocNode;
            return node && typeof node.type === "string" && (ATOM_BLOCKS as readonly string[]).includes(node.type) ? { node } : false;
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["div", { "data-rich-block": JSON.stringify(node.attrs.node ?? null) }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockView);
  },
});

/** Card of an atom block inside the editor, with edit, move and delete buttons. */
function BlockView({ node, updateAttributes, deleteNode, selected, editor, getPos }: ReactNodeViewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const block = (node.attrs.node ?? { type: "paragraph" }) as DocNode;
  const summary = useBlockSummary();
  const labels = useEmbedLabels(block);
  const type = block.type as AtomBlockType;
  const Icon = BLOCK_ICONS[type] ?? FileText;
  const editable = editor.isEditable;

  const move = (dir: -1 | 1) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { state, view } = editor;
    const index = state.doc.resolve(pos).index(0);
    const target = index + dir;
    if (target < 0 || target >= state.doc.childCount) return;
    const sibling = state.doc.child(target);
    const tr = state.tr;
    const self = state.doc.nodeAt(pos);
    if (!self) return;
    if (dir < 0) {
      tr.delete(pos, pos + self.nodeSize);
      tr.insert(pos - sibling.nodeSize, self);
    } else {
      tr.insert(pos + self.nodeSize + sibling.nodeSize, self);
      tr.delete(pos, pos + self.nodeSize);
    }
    view.dispatch(tr);
  };

  return (
    <NodeViewWrapper as="div" className="my-3" data-drag-handle="">
      <div contentEditable={false} className={cn("flex items-center gap-2 rounded-md border bg-surface-muted/60 p-2", selected ? "border-focus" : "border-border")}>
        <button type="button" className="flex min-w-0 flex-1 text-start" disabled={!editable} onClick={() => setOpen(true)} aria-label={t("content.blocks.editTitle", { block: t(`content.blocks.types.${type}`) })}>
          <BlockIconLabel icon={<Icon aria-hidden="true" />} label={t(`content.blocks.types.${type}`)}>
            <span className="truncate text-xs text-fg-muted">{summary(block, labels) || t("content.blocks.empty")}</span>
          </BlockIconLabel>
        </button>
        {editable ? (
          <span className="flex shrink-0 gap-0.5">
            <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveUp")} onClick={() => move(-1)}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("content.common.moveDown")} onClick={() => move(1)}>
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("common.edit")} onClick={() => setOpen(true)}>
              <Pencil aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={() => deleteNode()}>
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        ) : null}
      </div>
      {open ? <BlockDialog open={open} onOpenChange={setOpen} initial={block} isNew={false} onApply={(next) => updateAttributes({ node: next })} /> : null}
    </NodeViewWrapper>
  );
}

export interface RichDocEditorProps {
  value: unknown;
  onChange: (doc: RichDoc | null) => void;
  /** Changing it reloads `value` into the editor (undo, restore, language switch). */
  resetKey: string | number;
  nodes?: readonly RichBlockType[] | undefined;
  marks?: readonly RichMarkType[] | undefined;
  maxChars?: number | undefined;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  disabled?: boolean;
  lang?: string;
  dir?: "ltr" | "rtl";
}

export function RichDocEditor({ value, onChange, resetKey, nodes, marks, maxChars, id, invalid, disabled, lang, dir, ...aria }: RichDocEditorProps) {
  const { t, locale } = useI18n();
  const autoId = useId();
  const editorId = id ?? `rde${autoId}`;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const rules = useMemo(() => ({ nodes, marks }), [nodes, marks]);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const allowed = useMemo(() => new Set<string>(nodes ?? ["paragraph", "heading", "bulletList", "orderedList", "blockquote", ...ATOM_BLOCKS]), [nodes]);
  const allowedMarks = useMemo(() => new Set<string>(marks ?? ["bold", "italic", "underline", "strike", "code", "citation", "link"]), [marks]);
  const [chars, setChars] = useState(() => richDocCharCount(value));

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        document: false,
        heading: { levels: [2, 3, 4] },
        codeBlock: false,
        horizontalRule: false,
        link: false,
        code: allowedMarks.has("code") ? {} : false,
      }),
      RichDocument,
      LinkMark,
      CitationMark,
      RichBlockNode,
    ],
    content: richDocToEditor(value),
    editorProps: {
      attributes: {
        id: editorId,
        role: "textbox",
        "aria-multiline": "true",
        ...(aria["aria-labelledby"] ? { "aria-labelledby": aria["aria-labelledby"] } : {}),
        ...(aria["aria-describedby"] ? { "aria-describedby": aria["aria-describedby"] } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        ...(lang ? { lang } : {}),
        ...(dir ? { dir } : {}),
        class: CONTENT_CLASS,
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = editorToRichDoc(e.getJSON() as DocNode, rulesRef.current);
      setChars(richDocCharCount(doc));
      onChangeRef.current(isRichDocEmpty(doc) && doc.content.length === 0 ? null : doc);
    },
  });

  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (!editor || lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    editor.commands.setContent(richDocToEditor(value), { emitUpdate: false });
    setChars(richDocCharCount(value));
  }, [editor, resetKey, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const limit = maxChars ?? 200_000;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-w-0 flex-col rounded-md border bg-surface shadow-xs focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
          invalid ? "border-danger" : "border-border-control",
          disabled && "bg-surface-muted",
        )}
      >
        {editor ? <Toolbar editor={editor} editorId={editorId} disabled={disabled ?? false} allowed={allowed} allowedMarks={allowedMarks} /> : <div className="h-10 border-b border-border" aria-hidden="true" />}
        <EditorContent editor={editor} />
        {!editor ? <div className="min-h-48 px-4 py-3 text-base text-fg-subtle">{t("common.loading")}</div> : null}
      </div>
      <p className={cn("self-end text-xs tabular", chars > limit ? "text-danger" : "text-fg-subtle")}>
        {t("content.rich.chars", { count: chars.toLocaleString(locale), max: limit.toLocaleString(locale) })}
      </p>
    </div>
  );
}

interface ToolItem {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  run: () => void;
  disabled?: boolean;
}

function Toolbar({ editor, editorId, disabled, allowed, allowedMarks }: { editor: Editor; editorId: string; disabled: boolean; allowed: ReadonlySet<string>; allowedMarks: ReadonlySet<string> }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [inserting, setInserting] = useState<AtomBlockType | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      h4: e.isActive("heading", { level: 4 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      citation: e.isActive("citation"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const items: ToolItem[] = [];
  const mark = (key: RichMarkType, label: string, icon: ReactNode, active: boolean, run: () => void) => {
    if (allowedMarks.has(key)) items.push({ key, label, icon, active, run });
  };
  mark("bold", t("richText.bold"), <Bold aria-hidden="true" />, state.bold, () => chain().toggleBold().run());
  mark("italic", t("richText.italic"), <Italic aria-hidden="true" />, state.italic, () => chain().toggleItalic().run());
  mark("underline", t("richText.underline"), <Underline aria-hidden="true" />, state.underline, () => chain().toggleUnderline().run());
  mark("strike", t("richText.strike"), <Strikethrough aria-hidden="true" />, state.strike, () => chain().toggleStrike().run());
  mark("code", t("content.rich.code"), <Code aria-hidden="true" />, state.code, () => chain().toggleCode().run());
  if (allowed.has("heading")) {
    items.push({ key: "h2", label: t("richText.heading2"), icon: <Heading2 aria-hidden="true" />, active: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() });
    items.push({ key: "h3", label: t("richText.heading3"), icon: <Heading3 aria-hidden="true" />, active: state.h3, run: () => chain().toggleHeading({ level: 3 }).run() });
    items.push({ key: "h4", label: t("content.rich.heading4"), icon: <Heading4 aria-hidden="true" />, active: state.h4, run: () => chain().toggleHeading({ level: 4 }).run() });
  }
  if (allowed.has("bulletList")) items.push({ key: "bullet", label: t("richText.bulletList"), icon: <List aria-hidden="true" />, active: state.bullet, run: () => chain().toggleBulletList().run() });
  if (allowed.has("orderedList")) items.push({ key: "ordered", label: t("richText.orderedList"), icon: <ListOrdered aria-hidden="true" />, active: state.ordered, run: () => chain().toggleOrderedList().run() });
  if (allowed.has("blockquote")) items.push({ key: "quote", label: t("richText.quote"), icon: <Quote aria-hidden="true" />, active: state.quote, run: () => chain().toggleBlockquote().run() });

  const blocks = ATOM_BLOCKS.filter((b) => allowed.has(b));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button[data-tb]") ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else return;
    e.preventDefault();
    setFocusIndex(next);
    buttons[next]?.focus();
  };

  const btnClass =
    "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1 text-fg-muted hover:bg-surface-muted hover:text-fg aria-pressed:bg-accent-subtle aria-pressed:text-accent-subtle-fg disabled:opacity-50 [&_svg]:size-4";
  let index = 0;
  const tabIndexFor = () => (index++ === focusIndex ? 0 : -1);

  /** Inserts an atom block after the top-level block that holds the cursor. */
  const insertBlock = (node: DocNode) => {
    // After a selected block ($to at the top level) or after the text block holding the cursor.
    const { $to } = editor.state.selection;
    const at = $to.depth >= 1 ? $to.after(1) : $to.pos;
    editor.chain().focus().insertContentAt(at, { type: ATOM_NODE, attrs: { node } }).setNodeSelection(at).run();
  };

  return (
    <div ref={ref} role="toolbar" aria-label={t("richText.toolbar")} aria-controls={editorId} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          data-tb=""
          tabIndex={tabIndexFor()}
          aria-label={item.label}
          title={item.label}
          aria-pressed={item.active}
          disabled={disabled || item.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={item.run}
          className={btnClass}
        >
          {item.icon}
        </button>
      ))}
      {allowedMarks.has("link") ? (
        <>
          <LinkButton editor={editor} active={state.link} disabled={disabled} tabIndex={tabIndexFor()} className={btnClass} />
          <button
            type="button"
            data-tb=""
            tabIndex={tabIndexFor()}
            aria-label={t("richText.unlink")}
            title={t("richText.unlink")}
            disabled={disabled || !state.link}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().extendMarkRange("link").unsetMark("link").run()}
            className={btnClass}
          >
            <Unlink aria-hidden="true" />
          </button>
        </>
      ) : null}
      {allowedMarks.has("citation") ? <CitationButton editor={editor} active={state.citation} disabled={disabled} tabIndex={tabIndexFor()} className={btnClass} /> : null}
      {blocks.length ? (
        <>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-tb="" tabIndex={tabIndexFor()} disabled={disabled} className={cn(btnClass, "px-2 text-sm font-medium")}>
                <Plus aria-hidden="true" />
                {t("content.rich.insertBlock")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {blocks.map((b) => {
                const Icon = BLOCK_ICONS[b];
                return (
                  <DropdownMenuItem key={b} onSelect={() => setInserting(b)}>
                    <Icon aria-hidden="true" />
                    {t(`content.blocks.types.${b}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <button type="button" data-tb="" tabIndex={tabIndexFor()} aria-label={t("richText.undo")} title={t("richText.undo")} disabled={disabled || !state.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().undo().run()} className={btnClass}>
        <Undo2 aria-hidden="true" />
      </button>
      <button type="button" data-tb="" tabIndex={tabIndexFor()} aria-label={t("richText.redo")} title={t("richText.redo")} disabled={disabled || !state.canRedo} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().redo().run()} className={btnClass}>
        <Redo2 aria-hidden="true" />
      </button>
      {inserting ? (
        <BlockDialog
          open
          onOpenChange={(o) => {
            if (!o) setInserting(null);
          }}
          initial={newBlock(inserting)}
          isNew
          onApply={insertBlock}
        />
      ) : null}
    </div>
  );
}

function LinkButton({ editor, active, disabled, tabIndex, className }: { editor: Editor; active: boolean; disabled: boolean; tabIndex: number; className: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<LinkTarget>({ type: "url", url: "" });
  const [newTab, setNewTab] = useState(false);
  const [rel, setRel] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const labels = useRecordLabels(target.type === "entry" || target.type === "product" ? target.type : "entry", "id" in target && target.id ? [target.id] : []);
  const [emptySelection, setEmptySelection] = useState(false);

  const apply = () => {
    setTried(true);
    if (targetProblem(target)) return;
    const attrs = { target: target.type === "url" ? { type: "url", url: target.url.trim() } : target, openInNewTab: newTab, rel: rel.length ? rel : null };
    const c = editor.chain().focus().extendMarkRange("link");
    if (emptySelection) {
      const label = text.trim() || (target.type === "url" ? target.url.trim() : "id" in target ? (labels(target.id)?.label ?? target.id) : target.type === "anchor" ? target.anchor : target.phone);
      c.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs }] }).run();
    } else {
      c.setMark("link", attrs).run();
    }
    setOpen(false);
    // The popover hands focus back to its button when it closes; continue typing after the link instead.
    const end = editor.state.selection.to;
    window.setTimeout(() => editor.chain().focus().setTextSelection(end).unsetMark("link").run(), 30);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const a = editor.getAttributes("link");
          setTarget((a.target as LinkTarget | null) ?? { type: "url", url: "" });
          setNewTab(a.openInNewTab === true);
          setRel(Array.isArray(a.rel) ? (a.rel as string[]) : []);
          setText("");
          setTried(false);
          setEmptySelection(editor.state.selection.empty && !editor.isActive("link"));
        }
      }}
      aria-label={t("richText.link")}
      trigger={
        <button type="button" data-tb="" tabIndex={tabIndex} aria-label={t("richText.link")} title={t("richText.link")} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} className={className}>
          <Link2 aria-hidden="true" />
        </button>
      }
    >
      <form
        className="flex w-80 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <LinkTargetField value={target} onChange={setTarget} showErrors={tried} />
        {emptySelection ? (
          <Field label={t("content.link.text")} optional>
            <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : null}
        <Checkbox checked={newTab} onCheckedChange={setNewTab} label={t("richText.linkNewTab")} />
        {target.type === "url" ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-fg">{t("content.link.rel")}</legend>
            {(["nofollow", "sponsored", "ugc"] as const).map((r) => (
              <Checkbox key={r} checked={rel.includes(r)} onCheckedChange={(v) => setRel((list) => (v ? [...list, r] : list.filter((x) => x !== r)))} label={t(`content.link.rels.${r}`)} />
            ))}
          </fieldset>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {t("richText.linkApply")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function CitationButton({ editor, active, disabled, tabIndex, className }: { editor: Editor; active: boolean; disabled: boolean; tabIndex: number; className: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (!title.trim()) {
      setError(t("content.rich.citationTitleRequired"));
      return;
    }
    if (url.trim() && !/^https:\/\/\S+$/.test(url.trim())) {
      setError(t("content.link.httpsOnly"));
      return;
    }
    editor.chain().focus().extendMarkRange("citation").setMark("citation", { title: title.trim(), url: url.trim() || null }).run();
    setOpen(false);
    const end = editor.state.selection.to;
    window.setTimeout(() => editor.chain().focus().setTextSelection(end).unsetMark("citation").run(), 30);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const a = editor.getAttributes("citation");
          setTitle(typeof a.title === "string" ? a.title : "");
          setUrl(typeof a.url === "string" ? a.url : "");
          setError(null);
        }
      }}
      aria-label={t("content.rich.citation")}
      trigger={
        <button
          type="button"
          data-tb=""
          tabIndex={tabIndex}
          aria-label={t("content.rich.citation")}
          title={t("content.rich.citation")}
          aria-pressed={active}
          disabled={disabled || (editor.state.selection.empty && !active)}
          onMouseDown={(e) => e.preventDefault()}
          className={className}
        >
          <BookMarked aria-hidden="true" />
        </button>
      }
    >
      <form
        className="flex w-80 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="text-sm text-fg-muted">{t("content.rich.citationHint")}</p>
        <Field label={t("content.sources.title")} required error={error}>
          <Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={t("content.sources.url")} optional>
          <Input value={url} inputMode="url" placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="flex justify-between gap-2">
          <Button size="sm" variant="ghost" disabled={!active} onClick={() => {
            editor.chain().focus().extendMarkRange("citation").unsetMark("citation").run();
            setOpen(false);
          }}>
            {t("common.remove")}
          </Button>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" type="submit">
              {t("richText.linkApply")}
            </Button>
          </span>
        </div>
      </form>
    </Popover>
  );
}
