"use client";

import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useFieldControl } from "@/components/ui/field";
import { controlClasses } from "@/components/ui/input-styles";
import { cn } from "@/lib/cn";

export interface TagInputProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  maxTags?: number;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

/**
 * Free-text tags: Enter or comma adds, Backspace on an empty field removes the last tag, each chip
 * has its own remove button. Duplicates are ignored (case-insensitive).
 */
export function TagInput({ value, onChange, maxTags = 100, maxLength = 64, disabled, placeholder, id }: TagInputProps) {
  const { t } = useI18n();
  const field = useFieldControl(id);
  const hintId = useId();
  const [text, setText] = useState("");

  const add = (raw: string) => {
    const parts = raw.split(",").map((p) => p.trim().slice(0, maxLength)).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= maxTags) break;
      if (!next.some((x) => x.toLocaleLowerCase("tr") === p.toLocaleLowerCase("tr"))) next.push(p);
    }
    onChange(next);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={field?.id ?? id}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? t("commerce.tags.placeholder")}
        maxLength={maxLength * 4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(text)}
        aria-describedby={[field?.["aria-describedby"], hintId].filter(Boolean).join(" ")}
        aria-invalid={field?.["aria-invalid"]}
        className={controlClasses({ invalid: field?.["aria-invalid"] === true })}
      />
      <p id={hintId} className="sr-only">
        {t("commerce.tags.hint")}
      </p>
      {value.length > 0 ? (
        <ul aria-label={t("commerce.tags.list")} className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li key={tag} className={cn("inline-flex h-6 items-center gap-1 rounded-sm bg-surface-muted ps-2 pe-0.5 text-sm text-fg")}>
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x !== tag))}
                aria-label={t("commerce.tags.remove", { tag })}
                className="inline-flex size-5 items-center justify-center rounded-sm text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-55"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
