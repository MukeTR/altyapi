import { newId } from "@altyapi/commerce-core";
import { currentContext } from "@altyapi/observability";
import type { JobEnvelope } from "./consumer";
import type { Queue } from "./queue/types";

/**
 * Enqueues a background job. Pass a deterministic id to make enqueueing idempotent
 * (e.g. `domains.check:<domainId>:<slot>`), otherwise a new id is generated.
 */
export async function enqueueJob(
  queue: Queue,
  job: Omit<JobEnvelope, "id" | "correlationId"> & { id?: string },
  opts?: { delaySeconds?: number },
): Promise<string> {
  const id = job.id ?? newId();
  const envelope: JobEnvelope = {
    ...job,
    id,
    correlationId: currentContext()?.correlationId ?? id,
  };
  await queue.send("jobs", envelope as unknown as Record<string, unknown>, { messageId: id, ...opts });
  return id;
}
