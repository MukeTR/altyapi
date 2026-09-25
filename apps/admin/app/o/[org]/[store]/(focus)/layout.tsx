import type { ReactNode } from "react";

/**
 * Full-screen tools without the admin chrome (the storefront editor). The store context comes
 * from the parent layout; each screen renders its own top bar with a way back.
 */
export default function FocusLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
