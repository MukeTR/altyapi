"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useUrlFilters } from "./use-url-filters";

/** Search box bound to ?<param>= with a 300 ms debounce; Enter applies immediately. */
export function SearchField({ param = "q", label, placeholder, className }: { param?: string; label: string; placeholder?: string; className?: string }) {
  const { params, setFilters } = useUrlFilters();
  const urlValue = params.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastApplied = useRef(urlValue);

  // Follow back/forward navigation and "clear filters".
  useEffect(() => {
    if (urlValue !== lastApplied.current) {
      lastApplied.current = urlValue;
      setValue(urlValue);
    }
  }, [urlValue]);

  const apply = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = next.trim();
    if (trimmed === lastApplied.current) return;
    lastApplied.current = trimmed;
    setFilters({ [param]: trimmed || null });
  };

  return (
    <div className={className}>
      <Input
        type="search"
        size="md"
        value={value}
        aria-label={label}
        placeholder={placeholder ?? label}
        prefix={<Search aria-hidden="true" />}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(next), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(value);
          }
        }}
      />
    </div>
  );
}
