import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { LanguageSwitch } from "@/components/shell/language-switch";

/** Centered card without the admin chrome (sign-in, sign-up). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <LanguageSwitch />
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pb-16 pt-[6vh] outline-none">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
