import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { SignOutButton } from "@/components/shell/sign-out-button";

/** Chrome for signed-in pages outside a store (onboarding, organization without stores). */
export function SetupFrame({ title, subtitle, children }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <SignOutButton />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 justify-center px-4 pb-16 pt-[4vh] outline-none">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          {title ? (
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
              {subtitle ? <p className="text-base text-fg-muted">{subtitle}</p> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
