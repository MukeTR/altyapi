"use client";

import { useState } from "react";
import type { ResolvedLink } from "@altyapi/theme-engine";

export function MobileMenu({ links, label, closeLabel }: { links: ResolvedLink[]; label: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button type="button" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(true)} className="p-2" aria-label={label}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <nav id="mobile-menu" data-scheme="default" className="h-full w-80 max-w-[85vw] overflow-y-auto p-6" aria-label={label}>
            <button type="button" onClick={() => setOpen(false)} className="mb-6 text-2xl" aria-label={closeLabel}>
              ×
            </button>
            <ul className="flex flex-col gap-4 text-lg">
              {links.map((l) => (
                <li key={l.href + l.label}>
                  <a href={l.href}>{l.label}</a>
                  {l.children && (
                    <ul className="ms-4 mt-2 flex flex-col gap-2 text-base text-muted-fg">
                      {l.children.map((c) => (
                        <li key={c.href + c.label}>
                          <a href={c.href}>{c.label}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
