import { createServer } from "node:http";
import { sql } from "@altyapi/database";
import { ConsumerRuntime } from "@altyapi/events";
import { createWorkerDeps } from "./deps";
import { consumeLoop, outboxLoop, schedulerLoop, type LoopControl } from "./loops";
import { domainEventHandlers, domainJobHandlers, scheduleDomainChecks } from "./handlers/domains";
import { assetEventHandlers, runAssetCleanup } from "./handlers/assets";
import { createR2Storage } from "@altyapi/storage";

const deps = createWorkerDeps();
const control: LoopControl = { stopped: false };
const r2 = createR2Storage(deps.env);

const runtime = new ConsumerRuntime({
  db: deps.db,
  queue: deps.queue,
  logger: deps.logger,
  maxAttempts: deps.env.QUEUE_MAX_ATTEMPTS,
  eventHandlers: [...domainEventHandlers(deps), ...assetEventHandlers(deps, r2)],
  jobHandlers: [...domainJobHandlers(deps)],
});

const loops = [
  outboxLoop(deps, control),
  consumeLoop(deps, runtime, "events", control, deps.env.WORKER_CONCURRENCY),
  consumeLoop(deps, runtime, "jobs", control, deps.env.WORKER_CONCURRENCY),
  schedulerLoop(
    deps,
    [
      { name: "domains.schedule-checks", intervalMs: 30_000, run: () => scheduleDomainChecks(deps) },
      { name: "assets.cleanup", intervalMs: 3600_000, run: () => runAssetCleanup(deps, r2) },
    ],
    control,
  ),
];

const health = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    try {
      await deps.db.execute(sql`select 1`);
      res.writeHead(control.stopped ? 503 : 200).end(control.stopped ? "stopping" : "ok");
    } catch {
      res.writeHead(503).end("db unavailable");
    }
    return;
  }
  res.writeHead(404).end();
});
health.listen(deps.env.WORKER_HEALTH_PORT);
deps.logger.info({ queueDriver: deps.env.QUEUE_DRIVER }, "worker started");

const shutdown = async (signal: string) => {
  deps.logger.info({ signal }, "worker stopping");
  control.stopped = true;
  // Loops finish their current batch; SQS long polls return within 20s.
  await Promise.race([Promise.allSettled(loops), new Promise((r) => setTimeout(r, 25_000))]);
  health.close();
  await deps.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
