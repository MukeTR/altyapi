import { enqueueJob, PermanentJobError, type EventHandler, type JobHandler } from "@altyapi/events";
import {
  EkosistemPeerError,
  PULL_JOB_TYPE,
  PULL_LINK_JOB_TYPE,
  PUSH_SOURCE_EVENTS,
  claimDueLinks,
  deliverDueDecisions,
  deliverDuePushes,
  deliverRevocations,
  isPullResource,
  pullLinkResource,
  purgeEkosistemRetention,
  purgeExpiredPendingLinks,
  purgeRevokedReadModels,
  queuePushForDomainEvent,
  runLinkPull,
  type EkosistemServerDeps,
} from "@altyapi/ekosistem";
import type { WorkerDeps } from "../deps";

/**
 * Ecosystem bridge background work (docs/ekosistem/v1.md):
 * - scheduled pulls of Kârmatik §8 and Yanıt §9 read models (each resource at most hourly),
 *   and earlier pulls triggered by Kârmatik push events;
 * - outbound pushes (§10) caused by catalog, order and content changes;
 * - delivery of suggestion decisions, of local revocations (72 h with backoff), expiry of
 *   unapproved links (10 min) and data retention / deletion after revocation (§4.4).
 */

export const ekosistemDeps = (deps: WorkerDeps): EkosistemServerDeps => ({
  db: deps.db,
  keys: deps.payments.keys,
  redis: deps.redis,
  peers: deps.peers,
  logger: deps.logger,
  queue: deps.queue,
  storeRootDomain: deps.env.STORE_ROOT_DOMAIN,
  mediaBaseUrl: deps.env.MEDIA_PUBLIC_BASE_URL ?? null,
});

const LINK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ekosistemJobHandlers = (deps: WorkerDeps): JobHandler[] => [
  {
    // Pull triggered by a peer push (coalesced 30 s by the receiver).
    type: PULL_JOB_TYPE,
    timeoutSeconds: 600,
    async handle(job) {
      const linkId = String(job.payload.linkId ?? "");
      const resource = job.payload.resource;
      if (!LINK_ID_RE.test(linkId) || !isPullResource(resource)) throw new PermanentJobError("invalid ekosistem.pull payload");
      const outcome = await pullLinkResource(ekosistemDeps(deps), linkId, resource);
      deps.logger.info({ linkId, resource, outcome }, "ekosistem pull finished");
      // Transient peer failures and a concurrent pull of the same resource are retried by the queue.
      if (outcome.status === "failed" && outcome.retryable) throw new EkosistemPeerError(outcome.code, null, `pull of ${resource} failed: ${outcome.code}`);
      if (outcome.status === "skipped" && outcome.reason === "busy") throw new Error(`pull of ${resource} is already running`);
    },
  },
  {
    // Scheduled pull of every due resource of one link (leased by ekosistem.schedule-pulls).
    type: PULL_LINK_JOB_TYPE,
    timeoutSeconds: 900,
    async handle(job) {
      const linkId = String(job.payload.linkId ?? "");
      if (!LINK_ID_RE.test(linkId)) throw new PermanentJobError("invalid ekosistem.pull-link payload");
      const summary = await runLinkPull(ekosistemDeps(deps), linkId);
      deps.logger.info({ linkId, outcomes: summary.outcomes, nextPullAt: summary.nextPullAt }, "ekosistem scheduled pull finished");
    },
  },
];

export const ekosistemEventHandlers = (deps: WorkerDeps): EventHandler[] => [
  {
    // Catalog, order and content changes → altyapi.* pushes to linked peers (§10).
    name: "ekosistem-push",
    events: PUSH_SOURCE_EVENTS,
    async handle(event) {
      const queued = await queuePushForDomainEvent(ekosistemDeps(deps), event);
      if (queued) deps.logger.debug({ type: event.type, queued }, "ekosistem push queued");
    },
  },
];

export const ekosistemScheduledTasks = (deps: WorkerDeps) => [
  {
    name: "ekosistem.schedule-pulls",
    intervalMs: 60_000,
    run: async () => {
      const due = await claimDueLinks(ekosistemDeps(deps), 20);
      for (const link of due) {
        await enqueueJob(deps.queue, { type: PULL_LINK_JOB_TYPE, payload: { linkId: link.id }, organizationId: link.organizationId, storeId: link.storeId });
      }
      return due.length;
    },
  },
  { name: "ekosistem.deliver-pushes", intervalMs: 5_000, run: () => deliverDuePushes(ekosistemDeps(deps)) },
  { name: "ekosistem.deliver-decisions", intervalMs: 30_000, run: () => deliverDueDecisions(ekosistemDeps(deps)) },
  { name: "ekosistem.expire-pending-links", intervalMs: 60_000, run: () => purgeExpiredPendingLinks(ekosistemDeps(deps)) },
  { name: "ekosistem.deliver-revocations", intervalMs: 30_000, run: () => deliverRevocations(ekosistemDeps(deps)) },
  { name: "ekosistem.retention", intervalMs: 3600_000, run: () => purgeEkosistemRetention(ekosistemDeps(deps)) },
  { name: "ekosistem.revoked-data", intervalMs: 3600_000, run: () => purgeRevokedReadModels(ekosistemDeps(deps)) },
];
