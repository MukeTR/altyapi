import { newId } from "@altyapi/commerce-core";
import { and, eq, queueMessages, sql, type Database } from "@altyapi/database";
import type { Queue, QueueName, ReceivedMessage, SendOptions } from "./types";

/**
 * PostgreSQL-backed queue using SELECT … FOR UPDATE SKIP LOCKED. A message is leased by
 * setting locked_until; if the consumer dies the lease expires and it is redelivered.
 */
export class PostgresQueue implements Queue {
  constructor(
    private readonly db: Database,
    private readonly maxAttempts: number,
  ) {}

  async send(queue: QueueName, body: Record<string, unknown>, opts?: SendOptions): Promise<void> {
    const id = opts?.messageId ?? newId();
    await this.db
      .insert(queueMessages)
      .values({
        id,
        queue,
        body,
        maxAttempts: this.maxAttempts,
        availableAt: new Date(Date.now() + (opts?.delaySeconds ?? 0) * 1000),
      })
      .onConflictDoNothing({ target: queueMessages.id });
  }

  async receive(queue: QueueName, opts: { max: number; visibilitySeconds: number }): Promise<ReceivedMessage[]> {
    const rows = await this.db.execute<{ id: string; body: Record<string, unknown>; attempts: number }>(sql`
      update ${queueMessages} q
         set status = 'running',
             attempts = q.attempts + 1,
             locked_until = now() + make_interval(secs => ${opts.visibilitySeconds})
       where q.id in (
         select id from ${queueMessages}
          where queue = ${queue}
            and ((status = 'queued' and available_at <= now())
              or (status = 'running' and locked_until < now()))
          order by available_at
          limit ${opts.max}
          for update skip locked
       )
      returning q.id, q.body, q.attempts`);
    return rows.map((r) => ({ id: r.id, queue, body: r.body, attempt: r.attempts, receipt: r.id }));
  }

  async ack(message: ReceivedMessage): Promise<void> {
    await this.db
      .update(queueMessages)
      .set({ status: "succeeded", finishedAt: new Date(), lockedUntil: null })
      .where(eq(queueMessages.id, message.receipt));
  }

  async retry(message: ReceivedMessage, delaySeconds: number, error: string): Promise<void> {
    await this.db
      .update(queueMessages)
      .set({
        status: "queued",
        lockedUntil: null,
        lastError: error.slice(0, 2000),
        availableAt: new Date(Date.now() + delaySeconds * 1000),
      })
      .where(and(eq(queueMessages.id, message.receipt), eq(queueMessages.status, "running")));
  }

  async deadLetter(message: ReceivedMessage, error: string): Promise<void> {
    await this.db
      .update(queueMessages)
      .set({ status: "dead", lockedUntil: null, lastError: error.slice(0, 2000), finishedAt: new Date() })
      .where(eq(queueMessages.id, message.receipt));
  }
}
