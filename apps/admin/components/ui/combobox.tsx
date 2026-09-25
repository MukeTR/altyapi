"use client";

import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, RotateCw, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input-styles";
import { Spinner } from "./spinner";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text shown under or next to the label (e.g. a code). */
  description?: string;
  /** Extra search terms. */
  keywords?: readonly string[];
  disabled?: boolean;
}

interface BaseProps {
  options: readonly ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Hidden input(s) with this name carry the value in form submissions. */
  name?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  id?: string;
  "aria-label"?: string;
  className?: string;
  /** Async lists: shows a loading row instead of options. */
  loading?: boolean;
  /** Async lists: shows an error row with a retry button. */
  error?: string | null;
  onRetry?: () => void;
  /**
   * Async search: called with the typed text; the parent fetches (debounced, abortable) and
   * passes new options. Built-in filtering is turned off when set.
   */
  onSearch?: (query: string) => void;
  renderOption?: (option: ComboboxOption) => ReactNode;
}

export interface SingleComboboxProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
}

export interface MultiComboboxProps extends BaseProps {
  multiple: true;
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

/** Searchable single or multi select (Radix Popover + cmdk listbox). */
export function Combobox(props: ComboboxProps) {
  const { options, placeholder, searchPlaceholder, emptyText, name, disabled, size = "md", id, className, loading, error, onRetry, onSearch, renderOption } = props;
  const { t } = useI18n();
  const field = useFieldControl(id);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const byValue = new Map(options.map((o) => [o.value, o]));
  const selectedLabels = selected.map((v) => byValue.get(v)?.label ?? v);

  const toggle = (value: string) => {
    if (props.multiple) {
      const next = props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
      props.onChange(next);
    } else {
      props.onChange(value === props.value ? null : value);
      setOpen(false);
    }
  };

  const removeLast = () => {
    if (props.multiple && props.value.length > 0 && query === "") props.onChange(props.value.slice(0, -1));
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      {name ? selected.map((v) => <input key={v} type="hidden" name={name} value={v} />) : null}
      <div className={cn("flex flex-col gap-1.5", className)}>
        <Popover.Trigger asChild disabled={disabled ?? false}>
          <button
            type="button"
            id={field?.id ?? id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            aria-label={props["aria-label"]}
            aria-describedby={field?.["aria-describedby"]}
            aria-invalid={field?.["aria-invalid"]}
            aria-required={field?.["aria-required"]}
            className={cn(controlClasses({ size, invalid: field?.["aria-invalid"] === true }), "inline-flex items-center justify-between gap-2 text-start")}
          >
            <span className={cn("truncate", selected.length === 0 && "text-fg-subtle")}>
              {selected.length === 0
                ? (placeholder ?? t("ui.combobox.placeholder"))
                : props.multiple
                  ? selectedLabels.join(", ")
                  : selectedLabels[0]}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          </button>
        </Popover.Trigger>
        {props.multiple && props.value.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {props.value.map((v) => {
              const label = byValue.get(v)?.label ?? v;
              return (
                <li key={v} className="inline-flex h-6 items-center gap-1 rounded-sm bg-surface-muted ps-2 pe-0.5 text-sm text-fg">
                  {label}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => props.onChange(props.value.filter((x) => x !== v))}
                    aria-label={t("ui.combobox.removeItem", { name: label })}
                    className="inline-flex size-5 items-center justify-center rounded-sm text-fg-muted hover:bg-surface hover:text-fg"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-md data-[state=open]:animate-pop-in"
        >
          <Command shouldFilter={!onSearch} loop className="flex flex-col">
            <Command.Input
              value={query}
              onValueChange={(q) => {
                setQuery(q);
                onSearch?.(q);
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace") removeLast();
              }}
              placeholder={searchPlaceholder ?? t("ui.combobox.search")}
              className="h-9 border-b border-border bg-transparent px-3 text-base text-fg outline-none placeholder:text-fg-subtle"
            />
            <Command.List id={listId} aria-multiselectable={props.multiple || undefined} className="max-h-72 overflow-y-auto p-1">
              {loading ? (
                <Command.Loading>
                  <div className="flex items-center gap-2 px-2 py-2 text-sm text-fg-muted">
                    <Spinner />
                    {t("ui.combobox.loading")}
                  </div>
                </Command.Loading>
              ) : error ? (
                <div role="alert" className="flex items-center justify-between gap-2 px-2 py-2 text-sm text-danger">
                  <span>{error}</span>
                  {onRetry ? (
                    <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-fg hover:bg-surface-muted">
                      <RotateCw aria-hidden="true" className="size-3.5" />
                      {t("common.retry")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <Command.Empty className="px-2 py-2 text-sm text-fg-muted">{emptyText ?? t("common.noResults")}</Command.Empty>
                  {options.map((o) => {
                    const isSelected = selected.includes(o.value);
                    return (
                      <Command.Item
                        key={o.value}
                        value={o.value}
                        keywords={[o.label, ...(o.description ? [o.description] : []), ...(o.keywords ?? [])]}
                        disabled={o.disabled ?? false}
                        onSelect={() => toggle(o.value)}
                        className="relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md ps-7 pe-2 text-base text-fg outline-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-muted"
                      >
                        {isSelected ? <Check aria-hidden="true" className="absolute start-2 size-4 text-accent" /> : null}
                        {renderOption ? (
                          renderOption(o)
                        ) : (
                          <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                            <span className="truncate">{o.label}</span>
                            {o.description ? <span className="shrink-0 text-sm text-fg-subtle">{o.description}</span> : null}
                          </span>
                        )}
                        {isSelected ? <span className="sr-only">, {t("ui.combobox.selected")}</span> : null}
                      </Command.Item>
                    );
                  })}
                </>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
