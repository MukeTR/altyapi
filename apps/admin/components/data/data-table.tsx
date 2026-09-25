"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SkeletonTable } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { intlLocale } from "@/lib/i18n/config";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Numbers and money are right-aligned ("end"). */
  align?: "start" | "end" | "center";
  /** CSS width, e.g. "8rem". */
  width?: string;
  /**
   * Sort key. Only honoured when the table has the complete dataset (`sortable`); sorting one
   * page of a server-paginated list would mislead.
   */
  sortValue?: (row: T) => string | number | null;
  /** Header text for screen readers only (actions column). */
  srOnlyHeader?: boolean;
}

export interface RowSelection<T> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Accessible name of a row for its checkbox ("#1042", product title). */
  rowLabel: (row: T) => string;
}

export interface DataTableProps<T> {
  /** Accessible table caption (visually hidden). */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The rows are the complete dataset (unpaginated endpoint): enables column sorting. */
  sortable?: boolean;
  defaultSort?: { id: string; direction: "asc" | "desc" };
  selection?: RowSelection<T>;
  loading?: boolean;
  /** Rendered instead of the body when there are no rows (EmptyState). */
  empty?: ReactNode;
  /** Rendered instead of the body on failure (ErrorState). */
  error?: ReactNode;
  /** Pagination footer. */
  footer?: ReactNode;
  /** Keep the first column visible while scrolling horizontally on small screens. */
  stickyFirstColumn?: boolean;
  className?: string;
}

const ALIGN = { start: "text-start", end: "text-end", center: "text-center" } as const;

/**
 * Typed table with a caption, column headers with scope, optional sorting (complete datasets
 * only), row selection with a select-all checkbox for the visible rows, and loading, empty and
 * error slots. Rows are navigated with a real link in the first cell, never onClick on <tr>.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, sortable, defaultSort, selection, loading, empty, error, footer, stickyFirstColumn = true, className }: DataTableProps<T>) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState(defaultSort ?? null);
  const collator = useMemo(() => new Intl.Collator(intlLocale(locale), { numeric: true, sensitivity: "base" }), [locale]);

  const sorted = useMemo(() => {
    if (!sortable || !sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    const get = column.sortValue;
    const out = [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sort, sortable, columns, collator]);

  const visibleKeys = sorted.map(rowKey);
  const selectedVisible = selection ? visibleKeys.filter((k) => selection.selected.has(k)).length : 0;
  const allState: boolean | "indeterminate" = selectedVisible === 0 ? false : selectedVisible === visibleKeys.length ? true : "indeterminate";

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allState === true) for (const k of visibleKeys) next.delete(k);
    else for (const k of visibleKeys) next.add(k);
    selection.onChange(next);
  };

  const toggleRow = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  const onSort = (id: string) => {
    setSort((s) => (s?.id === id ? { id, direction: s.direction === "asc" ? "desc" : "asc" } : { id, direction: "asc" }));
  };

  const showBody = !loading && !error && sorted.length > 0;
  const stickyCell = stickyFirstColumn ? "max-md:sticky max-md:start-0 max-md:z-[1] max-md:bg-inherit" : "";

  return (
    <div className={cn("min-w-0", className)}>
      {loading ? (
        <SkeletonTable columns={Math.min(columns.length, 6)} label={t("ui.table.loadingRows")} />
      ) : error ? (
        error
      ) : sorted.length === 0 ? (
        empty
      ) : null}
      {showBody ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-[2] bg-surface-muted">
              <tr className="border-b border-border">
                {selection ? (
                  <th scope="col" className={cn("w-10 px-3 py-2", stickyCell)}>
                    <Checkbox checked={allState} onCheckedChange={toggleAll} aria-label={t("ui.table.selectAll")} />
                  </th>
                ) : null}
                {columns.map((c, i) => {
                  const canSort = sortable && Boolean(c.sortValue);
                  const direction = sort?.id === c.id ? sort.direction : null;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={canSort ? (direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none") : undefined}
                      style={c.width ? { width: c.width } : undefined}
                      className={cn("h-9 whitespace-nowrap px-3 text-xs font-medium text-fg-muted", ALIGN[c.align ?? "start"], i === 0 && !selection && stickyCell)}
                    >
                      {c.srOnlyHeader ? (
                        <span className="sr-only">{c.header}</span>
                      ) : canSort ? (
                        <button
                          type="button"
                          onClick={() => onSort(c.id)}
                          className={cn("-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-fg", c.align === "end" && "flex-row-reverse")}
                        >
                          {c.header}
                          {direction === "asc" ? (
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          ) : direction === "desc" ? (
                            <ArrowDown aria-hidden="true" className="size-3.5" />
                          ) : (
                            <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-60" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const key = rowKey(row);
                const isSelected = selection?.selected.has(key) ?? false;
                return (
                  <tr key={key} className={cn("h-10 border-b border-border bg-surface last:border-b-0 hover:bg-surface-muted", isSelected && "bg-accent-subtle hover:bg-accent-subtle")}>
                    {selection ? (
                      <td className={cn("px-3", stickyCell)}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(key)} aria-label={t("ui.table.selectRow", { name: selection.rowLabel(row) })} />
                      </td>
                    ) : null}
                    {columns.map((c, i) => (
                      <td key={c.id} className={cn("px-3 py-1.5 align-middle", ALIGN[c.align ?? "start"], c.align === "end" && "tabular", i === 0 && !selection && stickyCell)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {footer}
    </div>
  );
}

/** Sticky bar for bulk actions on selected rows; the count is announced politely. */
export function BulkActionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div aria-live="polite" className={cn("sticky bottom-0 z-[3]", count === 0 && "sr-only")}>
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2 shadow-sm">
          <span className="text-base font-medium text-fg">{t("ui.table.selected", { count })}</span>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
          <Button size="sm" variant="ghost" onClick={onClear} className="ms-auto">
            {t("ui.table.clearSelection")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
