import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { Queue, QueueName, ReceivedMessage, SendOptions } from "./types";

export interface SqsQueueConfig {
  region: string;
  queueUrls: Record<QueueName, string>;
  deadLetterQueueUrl?: string | undefined;
}

/**
 * AWS SQS driver. Standard queues give at-least-once delivery; consumers dedupe on the
 * message id carried in the body. The queues should also have a redrive policy to the DLQ
 * as a safety net for poison messages that crash the consumer.
 */
export class SqsQueue implements Queue {
  private readonly client: SQSClient;

  constructor(private readonly cfg: SqsQueueConfig) {
    this.client = new SQSClient({ region: cfg.region });
  }

  async send(queue: QueueName, body: Record<string, unknown>, opts?: SendOptions): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.cfg.queueUrls[queue],
        MessageBody: JSON.stringify({ ...body, __messageId: opts?.messageId ?? body.id }),
        DelaySeconds: Math.min(900, Math.max(0, Math.floor(opts?.delaySeconds ?? 0))),
      }),
    );
  }

  async receive(queue: QueueName, opts: { max: number; visibilitySeconds: number; waitSeconds?: number }): Promise<ReceivedMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.cfg.queueUrls[queue],
        MaxNumberOfMessages: Math.min(10, opts.max),
        VisibilityTimeout: opts.visibilitySeconds,
        WaitTimeSeconds: opts.waitSeconds ?? 20,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
    );
    return (res.Messages ?? []).flatMap((m) => {
      if (!m.Body || !m.ReceiptHandle || !m.MessageId) return [];
      const body = JSON.parse(m.Body) as Record<string, unknown>;
      const id = typeof body.__messageId === "string" ? body.__messageId : m.MessageId;
      delete body.__messageId;
      return [
        {
          id,
          queue,
          body,
          attempt: Number(m.Attributes?.ApproximateReceiveCount ?? "1"),
          receipt: m.ReceiptHandle,
        },
      ];
    });
  }

  async ack(message: ReceivedMessage): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.cfg.queueUrls[message.queue], ReceiptHandle: message.receipt }));
  }

  async retry(message: ReceivedMessage, delaySeconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.cfg.queueUrls[message.queue],
        ReceiptHandle: message.receipt,
        VisibilityTimeout: Math.min(43_200, Math.max(0, Math.floor(delaySeconds))),
      }),
    );
  }

  async deadLetter(message: ReceivedMessage, error: string): Promise<void> {
    if (this.cfg.deadLetterQueueUrl) {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.cfg.deadLetterQueueUrl,
          MessageBody: JSON.stringify({ queue: message.queue, id: message.id, body: message.body, error: error.slice(0, 2000) }),
        }),
      );
    }
    await this.ack(message);
  }
}
