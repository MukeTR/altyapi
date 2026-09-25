import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle ? <p className="text-base text-fg-muted">{subtitle}</p> : null}
        </div>
        {children}
      </div>
      {footer ? <p className="text-center text-base text-fg-muted">{footer}</p> : null}
    </div>
  );
}
