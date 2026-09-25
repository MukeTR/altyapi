"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { InlineAlert, type AlertTone } from "@/components/ui/inline-alert";

/** Form-level message that takes focus when it appears, so the result of a submit is announced. */
export function FormAlert({ tone, title, children, focusKey }: { tone: AlertTone; title?: ReactNode; children?: ReactNode; focusKey: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none focus-visible:outline-2 focus-visible:outline-focus">
      <InlineAlert tone={tone} live={tone === "danger" ? "alert" : "status"} title={title}>
        {children}
      </InlineAlert>
    </div>
  );
}
