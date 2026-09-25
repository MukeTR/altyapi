"use client";

import { ErrorState } from "@/components/ui/error-state";

/** Unexpected errors below the root layout. Server errors arrive without details in production; the digest is the support code. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState digest={error.digest} onRetry={retry} />
    </main>
  );
}
