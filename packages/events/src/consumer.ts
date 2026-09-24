import { and, eq, processedMessages, type Database } from "@altyapi/database";
import { runWithContext, type Logger } from "@altyapi/observability";
import type { DomainEventType } from "./catalog";
import type { EventEnvelope } from "./outbox";
import { backoffSeconds, type Queue, type QueueName, type ReceivedMessage } from "./queue/types";

export interface EventHandler {
  /** Stable consumer name; part of the idempotency key. */
  name: string;
  events: readonly DomainEventType[];
  handle(event: EventEnvelope): Promise<void>;
}

export interface JobEnvelope {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  organizationId?: string | null;
  storeId?: string | null;
  correlationId?: string;
}

export interface JobHandler {
  type: string;
  /** Visibility/lease for one run of this job. */
  timeoutSeconds?: number;
  handle(job: JobEnvelope): Promise<void>;
}

/** Thrown by handlers for errors that will never succeed on retry (goes straight to DLQ). */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

async function alreadyProcessed(db: Database, consumer: string, messageId: string): Promise<boolean> {
  const row = await db.query.processedMessages.findFirst({
    where: and(eq(processedMessages.consumer, consumer), eq(processedMessages.messageId, messageId)),
  });
  return Boolean(row);
}

async function markProcessed(db: Database, consumer: string, messageId: string): Promise<void> {
  await db.insert(processedMessages).values({ consumer, messageId }).onConflictDoNothing();
}

export interface ConsumerRuntimeOptions {
  db: Database;
  queue: Queue;
  logger: Logger;
  maxAttempts: number;
  eventHandlers: EventHandler[];
  jobHandlers: JobHandler[];
}

/**
 * Dispatches queue messages to handlers. Event messages fan out to every subscribed
 * handler; each handler is deduplicated independently so a redelivery only re-runs the
 * handlers that had not finished.
 */
export class ConsumerRuntime {
  private readonly jobHandlers: Map<string, JobHandler>;

  constructor(private readonly opts: ConsumerRuntimeOptions) {
    this.jobHandlers = new Map(opts.jobHandlers.map((h) => [h.type, h]));
  }

  async process(message: ReceivedMessage): Promise<void> {
    const { queue, logger } = this.opts;
    try {
      if (message.queue === "events") await this.processEvent(message);
      else await this.processJob(message);
      await queue.ack(message);
    } catch (err) {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const permanent = err instanceof PermanentJobError;
      if (permanent || message.attempt >= this.opts.maxAttempts) {
        logger.error({ err, messageId: message.id, queue: message.queue, attempt: message.attempt }, "message dead-lettered");
        await queue.deadLetter(message, error);
      } else {
        const delay = backoffSeconds(message.attempt);
        logger.warn({ err, messageId: message.id, queue: message.queue, attempt: message.attempt, delay }, "message retry scheduled");
        await queue.retry(message, delay, error);
      }
    }
  }

  private async processEvent(message: ReceivedMessage): Promise<void> {
    const event = message.body as unknown as EventEnvelope;
    const handlers = this.opts.eventHandlers.filter((h) => h.events.includes(event.type));
    for (const handler of handlers) {
      if (await alreadyProcessed(this.opts.db, handler.name, event.id)) continue;
      await runWithContext(
        {
          correlationId: event.correlationId,
          eventId: event.id,
          organizationId: event.organizationId ?? undefined,
          storeId: event.storeId ?? undefined,
          principalType: "system",
        },
        () => handler.handle(event),
      );
      await markProcessed(this.opts.db, handler.name, event.id);
    }
  }

  private async processJob(message: ReceivedMessage): Promise<void> {
    const job = message.body as unknown as JobEnvelope;
    const handler = this.jobHandlers.get(job.type);
    if (!handler) throw new PermanentJobError(`no handler for job type ${job.type}`);
    const key = `job:${job.type}`;
    if (await alreadyProcessed(this.opts.db, key, job.id)) return;
    await runWithContext(
      {
        correlationId: job.correlationId ?? job.id,
        actionId: undefined,
        organizationId: job.organizationId ?? undefined,
        storeId: job.storeId ?? undefined,
        principalType: "system",
      },
      () => handler.handle(job),
    );
    await markProcessed(this.opts.db, key, job.id);
  }

  visibilityFor(queueName: QueueName): number {
    if (queueName === "events") return 120;
    return Math.max(60, ...this.opts.jobHandlers.map((h) => h.timeoutSeconds ?? 300));
  }
}
