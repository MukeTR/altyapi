"use client";

import { FocusFrame } from "@/components/storefront/editor/focus-frame";
import { ErrorState } from "@/components/ui/error-state";

/** Unexpected failures in a full-screen tool; offers a way back to the admin. */
export default function FocusError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <FocusFrame>
      <ErrorState digest={error.digest} onRetry={retry} announce />
    </FocusFrame>
  );
}
