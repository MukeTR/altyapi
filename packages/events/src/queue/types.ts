export type QueueName = "events" | "jobs";

export interface ReceivedMessage<T = Record<string, unknown>> {
  id: string;
  queue: QueueName;
  body: T;
  /** 1 on first delivery. */
  attempt: number;
  /** Driver-specific handle used for ack/retry. */
  receipt: string;
}

export interface SendOptions {
  delaySeconds?: number;
  /** Stable id used for deduplication by consumers (e.g. outbox event id). */
  messageId?: string;
}

/**
 * Provider-independent queue contract. Delivery is at-least-once: consumers must be
 * idempotent. Implementations: PostgreSQL (local/small installs) and AWS SQS.
 */
export interface Queue {
  send(queue: QueueName, body: Record<string, unknown>, opts?: SendOptions): Promise<void>;
  receive(queue: QueueName, opts: { max: number; visibilitySeconds: number; waitSeconds?: number }): Promise<ReceivedMessage[]>;
  ack(message: ReceivedMessage): Promise<void>;
  /** Makes the message visible again after delaySeconds (retry with backoff). */
  retry(message: ReceivedMessage, delaySeconds: number, error: string): Promise<void>;
  /** Moves the message to the dead-letter destination. */
  deadLetter(message: ReceivedMessage, error: string): Promise<void>;
}

/** Exponential backoff with full jitter, capped at 15 minutes (SQS visibility/delay limit friendly). */
export function backoffSeconds(attempt: number, baseSeconds = 5, capSeconds = 900): number {
  const exp = Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.floor(Math.random() * exp));
}
