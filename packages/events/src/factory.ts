import type { Database } from "@altyapi/database";
import { PostgresQueue } from "./queue/postgres";
import { SqsQueue } from "./queue/sqs";
import type { Queue } from "./queue/types";

export interface QueueEnv {
  QUEUE_DRIVER: "sqs" | "postgres";
  QUEUE_MAX_ATTEMPTS: number;
  AWS_REGION: string;
  SQS_EVENTS_QUEUE_URL?: string | undefined;
  SQS_JOBS_QUEUE_URL?: string | undefined;
  SQS_DEAD_LETTER_QUEUE_URL?: string | undefined;
}

export function createQueue(env: QueueEnv, db: Database): Queue {
  if (env.QUEUE_DRIVER === "sqs") {
    if (!env.SQS_EVENTS_QUEUE_URL || !env.SQS_JOBS_QUEUE_URL) {
      throw new Error("QUEUE_DRIVER=sqs requires SQS_EVENTS_QUEUE_URL and SQS_JOBS_QUEUE_URL");
    }
    return new SqsQueue({
      region: env.AWS_REGION,
      queueUrls: { events: env.SQS_EVENTS_QUEUE_URL, jobs: env.SQS_JOBS_QUEUE_URL },
      deadLetterQueueUrl: env.SQS_DEAD_LETTER_QUEUE_URL,
    });
  }
  return new PostgresQueue(db, env.QUEUE_MAX_ATTEMPTS);
}
