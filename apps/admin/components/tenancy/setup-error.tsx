import { ErrorState } from "@/components/ui/error-state";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { SetupFrame } from "./setup-frame";

/** Full-page failure outside the shell (the error title is the page's heading). */
export function SetupError({ error }: { error: ApiErrorInfo }) {
  return (
    <SetupFrame>
      <div className="rounded-xl border border-border bg-surface">
        <ErrorState error={error} headingLevel={1} />
      </div>
    </SetupFrame>
  );
}
