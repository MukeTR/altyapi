import { setTimeout as sleep } from "node:timers/promises";
import { publishOutboxBatch, type ConsumerRuntime, type QueueName } from "@altyapi/events";
import type { WorkerDeps } from "./deps";
import { withLock } from "./lock";

export interface LoopControl {
  stopped: boolean;
}

export async function outboxLoop(deps: WorkerDeps, control: LoopControl): Promise<void> {
  while (!control.stopped) {
    try {
      const n = await publishOutboxBatch(deps.db, deps.queue, 200);
      if (n === 0) await sleep(500);
    } catch (err) {
      deps.logger.error({ err }, "outbox publish failed");
      await sleep(2000);
    }
  }
}

export async function consumeLoop(
  deps: WorkerDeps,
  runtime: ConsumerRuntime,
  queue: QueueName,
  control: LoopControl,
  concurrency: number,
): Promise<void> {
  while (!control.stopped) {
    try {
      const messages = await deps.queue.receive(queue, {
        max: concurrency,
        visibilitySeconds: runtime.visibilityFor(queue),
        waitSeconds: 20,
      });
      if (messages.length === 0) {
        // The postgres driver returns immediately; SQS long-polls.
        if (deps.env.QUEUE_DRIVER === "postgres") await sleep(500);
        continue;
      }
      await Promise.all(messages.map((m) => runtime.process(m)));
    } catch (err) {
      deps.logger.error({ err, queue }, "consume loop error");
      await sleep(2000);
    }
  }
}

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

/** Runs periodic tasks; each run holds a Redis lock so only one instance executes it. */
export async function schedulerLoop(deps: WorkerDeps, tasks: ScheduledTask[], control: LoopControl): Promise<void> {
  const lastRun = new Map<string, number>();
  while (!control.stopped) {
    const now = Date.now();
    for (const task of tasks) {
      if (now - (lastRun.get(task.name) ?? 0) < task.intervalMs) continue;
      lastRun.set(task.name, now);
      try {
        await withLock(deps.redis, `scheduler:${task.name}`, Math.max(5_000, task.intervalMs - 1_000), task.run);
      } catch (err) {
        deps.logger.error({ err, task: task.name }, "scheduled task failed");
      }
    }
    await sleep(1000);
  }
}
