"use client";

import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, Unlink } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Field } from "./field";
import { Input } from "./input";
import { Popover } from "./popover";

export type RichTextContent = string | JSONContent;

export interface RichTextChange {
  html: string;
  json: JSONContent;
  isEmpty: boolean;
}

export interface RichTextEditorProps {
  /** Initial document (HTML or editor JSON). The editor is uncontrolled: change `resetKey` to load new content. */
  initialContent: RichTextContent;
  /** Changing this replaces the editor content with `initialContent` (e.g. after undo or a locale switch). */
  resetKey?: string | number;
  onChange: (change: RichTextChange) => void;
  /** id of the editable region, so a <label htmlFor> or aria-labelledby can name it. */
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Content language of the text (lang and dir of the editable region). */
  lang?: string;
  dir?: "ltr" | "rtl";
  className?: string;
}

/** Typography of the editable region (no global stylesheet needed). */
const CONTENT_CLASS = [
  "min-h-28 max-h-96 overflow-y-auto px-3 py-2 text-base text-fg outline-none",
  "[&_p]:my-1.5 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-md [&_h3]:font-semibold [&_h4]:mt-2 [&_h4]:font-semibold",
  "[&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li>p]:my-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-border-control [&_blockquote]:ps-3 [&_blockquote]:text-fg-muted",
  "[&_a]:text-link [&_a]:underline",
].join(" ");

/** Links may point to a store path or an absolute http(s), mailto: or tel: address (the API's allow-list). */
export function isAllowedHref(href: string): boolean {
  const v = href.trim();
  return (v.startsWith("/") && !v.startsWith("//")) || /^https?:\/\/[^\s]+$/i.test(v) || /^mailto:[^\s]+$/i.test(v) || /^tel:[+\d][\d\s-]*$/i.test(v);
}

/**
 * Rich text editor (Tiptap) limited to what stored rich text allows: paragraphs, h2–h4, lists,
 * quotes, bold, italic, underline, strike-through and links. Pasted content is reduced to the
 * same set; images are never accepted. The toolbar is a single tab stop with arrow-key
 * navigation (WAI-ARIA toolbar pattern).
 */
export function RichTextEditor({
  initialContent,
  resetKey,
  onChange,
  id,
  invalid,
  disabled,
  lang,
  dir,
  className,
  ...aria
}: RichTextEditorProps) {
  const { t } = useI18n();
  const autoId = useId();
  const editorId = id ?? `rte${autoId}`;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["mailto", "tel"],
          isAllowedUri: (url) => isAllowedHref(url),
          HTMLAttributes: { rel: "noopener noreferrer", target: null },
        },
      }),
    ],
    content: initialContent,
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
    onUpdate: ({ editor: e }) => onChangeRef.current({ html: e.getHTML(), json: e.getJSON(), isEmpty: e.isEmpty }),
  });

  // Load new content when the caller resets (undo, restore, locale switch) without re-creating the editor.
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (!editor || lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    editor.commands.setContent(initialContent, { emitUpdate: false });
  }, [editor, resetKey, initialContent]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-surface shadow-xs focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
        invalid ? "border-danger" : "border-border-control",
        disabled && "bg-surface-muted",
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} editorId={editorId} disabled={disabled ?? false} /> : <div className="h-9 border-b border-border" aria-hidden="true" />}
      <EditorContent editor={editor} />
      {!editor ? <div className="min-h-28 px-3 py-2 text-base text-fg-subtle">{t("common.loading")}</div> : null}
    </div>
  );
}

function Toolbar({ editor, editorId, disabled }: { editor: Editor; editorId: string; disabled: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      newTab: e.getAttributes("link").target === "_blank",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const items: { key: string; label: string; icon: ReactNode; active?: boolean; run: () => void; disabled?: boolean }[] = [
    { key: "bold", label: t("richText.bold"), icon: <Bold aria-hidden="true" />, active: state.bold, run: () => chain().toggleBold().run() },
    { key: "italic", label: t("richText.italic"), icon: <Italic aria-hidden="true" />, active: state.italic, run: () => chain().toggleItalic().run() },
    { key: "underline", label: t("richText.underline"), icon: <Underline aria-hidden="true" />, active: state.underline, run: () => chain().toggleUnderline().run() },
    { key: "strike", label: t("richText.strike"), icon: <Strikethrough aria-hidden="true" />, active: state.strike, run: () => chain().toggleStrike().run() },
    { key: "h2", label: t("richText.heading2"), icon: <Heading2 aria-hidden="true" />, active: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
    { key: "h3", label: t("richText.heading3"), icon: <Heading3 aria-hidden="true" />, active: state.h3, run: () => chain().toggleHeading({ level: 3 }).run() },
    { key: "bullet", label: t("richText.bulletList"), icon: <List aria-hidden="true" />, active: state.bullet, run: () => chain().toggleBulletList().run() },
    { key: "ordered", label: t("richText.orderedList"), icon: <ListOrdered aria-hidden="true" />, active: state.ordered, run: () => chain().toggleOrderedList().run() },
    { key: "quote", label: t("richText.quote"), icon: <Quote aria-hidden="true" />, active: state.quote, run: () => chain().toggleBlockquote().run() },
  ];

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
    "inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg aria-pressed:bg-accent-subtle aria-pressed:text-accent-subtle-fg disabled:opacity-50 [&_svg]:size-4";
  let index = 0;
  const tabIndexFor = () => (index++ === focusIndex ? 0 : -1);

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("richText.toolbar")}
      aria-controls={editorId}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          data-tb=""
          tabIndex={tabIndexFor()}
          aria-label={item.label}
          title={item.label}
          aria-pressed={item.active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={item.run}
          className={btnClass}
        >
          {item.icon}
        </button>
      ))}
      <LinkButton editor={editor} href={state.href} newTab={state.newTab} active={state.link} disabled={disabled} tabIndex={tabIndexFor()} className={btnClass} />
      <button
        type="button"
        data-tb=""
        tabIndex={tabIndexFor()}
        aria-label={t("richText.unlink")}
        title={t("richText.unlink")}
        disabled={disabled || !state.link}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().extendMarkRange("link").unsetLink().run()}
        className={btnClass}
      >
        <Unlink aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        data-tb=""
        tabIndex={tabIndexFor()}
        aria-label={t("richText.undo")}
        title={t("richText.undo")}
        disabled={disabled || !state.canUndo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().undo().run()}
        className={btnClass}
      >
        <Undo2 aria-hidden="true" />
      </button>
      <button
        type="button"
        data-tb=""
        tabIndex={tabIndexFor()}
        aria-label={t("richText.redo")}
        title={t("richText.redo")}
        disabled={disabled || !state.canRedo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().redo().run()}
        className={btnClass}
      >
        <Redo2 aria-hidden="true" />
      </button>
    </div>
  );
}

function LinkButton({
  editor,
  href,
  newTab,
  active,
  disabled,
  tabIndex,
  className,
}: {
  editor: Editor;
  href: string;
  newTab: boolean;
  active: boolean;
  disabled: boolean;
  tabIndex: number;
  className: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [blank, setBlank] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const v = value.trim();
    if (!v) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setOpen(false);
      return;
    }
    if (!isAllowedHref(v)) {
      setError(t("richText.linkInvalid"));
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !active) {
      chain.insertContent({ type: "text", text: v, marks: [{ type: "link", attrs: { href: v, target: blank ? "_blank" : null } }] }).run();
    } else {
      chain.setLink({ href: v, target: blank ? "_blank" : null }).run();
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(href);
          setBlank(newTab);
          setError(null);
        }
      }}
      aria-label={t("richText.link")}
      trigger={
        <button
          type="button"
          data-tb=""
          tabIndex={tabIndex}
          aria-label={t("richText.link")}
          title={t("richText.link")}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          className={className}
        >
          <Link2 aria-hidden="true" />
        </button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label={t("richText.linkUrl")} description={t("richText.linkHint")} error={error}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://" autoFocus inputMode="url" />
        </Field>
        <Checkbox checked={blank} onCheckedChange={setBlank} label={t("richText.linkNewTab")} />
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
