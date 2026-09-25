"use client";

import { ErrorState } from "@/components/ui/error-state";

/** Unexpected failures inside a store screen; the shell stays usable around it. */
export default function ShellError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-[960px] rounded-lg border border-border bg-surface">
      <ErrorState digest={error.digest} onRetry={retry} announce />
    </div>
  );
}
