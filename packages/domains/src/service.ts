import { z } from "zod";
import { AppError, conflict, invalid, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
  storeDomains,
  stores,
  withPlatformTx,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import type { CloudflareClient } from "./cloudflare";
import { isPlatformHostname, normalizeHostname, planHostnames } from "./hostname";
import { buildDnsInstructions, mapCloudflareStatus, MAX_CHECK_WINDOW_MS, nextCheckDelayMs, type DomainStatus } from "./status";

export interface DomainPlatformConfig {
  rootDomain: string;
  cnameTarget: string;
  apexARecords: string[];
}

export interface DomainDeps {
  db: Database;
  cloudflare: CloudflareClient | null;
  platform: DomainPlatformConfig;
}

export const addDomainSchema = z.object({ hostname: z.string().min(3).max(253) });

export type DomainRow = typeof storeDomains.$inferSelect;

function requireCloudflare(cf: CloudflareClient | null): CloudflareClient {
  if (!cf) throw new AppError("dependency_unavailable", "errors.domain.cloudflare_not_configured");
  return cf;
}

async function bumpRouting(
  tx: Transaction,
  store: { organizationId: string; storeId: string },
  removedHostnames: string[] = [],
): Promise<void> {
  const [row] = await tx
    .update(stores)
    .set({ routingVersion: sql`${stores.routingVersion} + 1` })
    .where(eq(stores.id, store.storeId))
    .returning({ routingVersion: stores.routingVersion });
  const hostnames = await tx
    .select({ hostname: storeDomains.hostname })
    .from(storeDomains)
    .where(eq(storeDomains.storeId, store.storeId));
  await appendEvent(tx, {
    type: "domain.routing_changed",
    organizationId: store.organizationId,
    storeId: store.storeId,
    aggregateType: "store",
    aggregateId: store.storeId,
    payload: {
      storeId: store.storeId,
      routingVersion: row!.routingVersion,
      // Removed hostnames are included so the edge speed layer drops them too.
      hostnames: [...hostnames.map((h) => h.hostname), ...removedHostnames],
    },
  });
}

export async function listDomains(db: Database, ctx: StoreContext): Promise<DomainRow[]> {
  assertCan(ctx, "domains:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select()
      .from(storeDomains)
      .where(and(eq(storeDomains.storeId, ctx.storeId), ne(storeDomains.status, "moved")))
      .orderBy(asc(storeDomains.createdAt)),
  );
}

/**
 * Adds a custom domain. The www hostname is bound to the store; an apex entered by the
 * merchant (example.com) is registered as a redirect to www.example.com.
 */
export async function addCustomDomain(deps: DomainDeps, ctx: StoreContext, input: z.infer<typeof addDomainSchema>): Promise<DomainRow[]> {
  assertCan(ctx, "domains:manage");
  const norm = normalizeHostname(input.hostname);
  if (!norm.ok) throw invalid(norm.reason, { hostname: input.hostname });
  if (isPlatformHostname(norm.hostname, deps.platform.rootDomain)) {
    throw invalid("errors.domain.platform_hostname", { hostname: norm.hostname });
  }
  const plan = planHostnames(norm.hostname);
  const hostnames = [plan.routingHostname, ...(plan.apexHostname ? [plan.apexHostname] : [])];

  // Uniqueness spans all tenants, so it is checked at platform level; the unique index is the final guard.
  const taken = await withPlatformTx(deps.db, (tx) =>
    tx
      .select({ hostname: storeDomains.hostname })
      .from(storeDomains)
      .where(and(inArray(storeDomains.hostname, hostnames), ne(storeDomains.status, "moved"))),
  );
  if (taken.length) throw conflict("errors.domain.already_registered", { hostnames: taken.map((t) => t.hostname) });

  const ids = await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const routingId = newId();
    const rows: (typeof storeDomains.$inferInsert)[] = [
      {
        id: routingId,
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        hostname: plan.routingHostname,
        kind: "custom",
        status: "pending",
        apexHostname: plan.apexHostname,
        dnsInstructions: buildDnsInstructions(null, {
          hostname: plan.routingHostname,
          cnameTarget: deps.platform.cnameTarget,
          isApex: false,
          apexARecords: deps.platform.apexARecords,
        }),
      },
    ];
    if (plan.apexHostname) {
      rows.push({
        id: newId(),
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        hostname: plan.apexHostname,
        kind: "custom",
        status: "pending",
        redirectToHostname: plan.routingHostname,
        dnsInstructions: buildDnsInstructions(null, {
          hostname: plan.apexHostname,
          cnameTarget: deps.platform.cnameTarget,
          isApex: true,
          apexARecords: deps.platform.apexARecords,
        }),
      });
    }
    try {
      await tx.insert(storeDomains).values(rows);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict("errors.domain.already_registered", { hostnames });
      throw err;
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "domain.added",
      resourceType: "store_domain",
      resourceId: routingId,
      after: { hostnames },
    });
    return rows.map((r) => r.id);
  });

  for (const id of ids) await provisionDomain(deps, id);
  return withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.select().from(storeDomains).where(inArray(storeDomains.id, ids)),
  );
}

/**
 * Creates the Cloudflare custom hostname for a pending domain. Failures leave the domain in
 * "pending" with a failure reason so the merchant can retry; nothing is faked.
 */
export async function provisionDomain(deps: DomainDeps, domainId: string): Promise<void> {
  const domain = await withPlatformTx(deps.db, (tx) => tx.query.storeDomains.findFirst({ where: eq(storeDomains.id, domainId) }));
  if (!domain || domain.kind !== "custom" || domain.cloudflareCustomHostnameId) return;
  if (!deps.cloudflare) {
    await withPlatformTx(deps.db, (tx) =>
      tx.update(storeDomains).set({ failureReason: "cloudflare_not_configured" }).where(eq(storeDomains.id, domainId)),
    );
    return;
  }
  try {
    const cf = await deps.cloudflare.createCustomHostname(domain.hostname);
    const mapped = mapCloudflareStatus(cf);
    await withPlatformTx(deps.db, (tx) =>
      tx
        .update(storeDomains)
        .set({
          cloudflareCustomHostnameId: cf.id,
          status: mapped.status === "active" ? "certificate_pending" : mapped.status === "failed" ? "failed" : "awaiting_dns",
          sslStatus: mapped.sslStatus,
          verificationStatus: mapped.verificationStatus,
          verificationErrors: mapped.errors,
          dnsInstructions: buildDnsInstructions(cf, {
            hostname: domain.hostname,
            cnameTarget: deps.platform.cnameTarget,
            isApex: domain.redirectToHostname !== null,
            apexARecords: deps.platform.apexARecords,
          }),
          failureReason: null,
          checkAttempts: 0,
          nextCheckAt: new Date(Date.now() + nextCheckDelayMs(0)),
        })
        .where(eq(storeDomains.id, domainId)),
    );
  } catch (err) {
    const reason = err instanceof AppError ? String(err.details?.message ?? err.messageKey) : "cloudflare_request_failed";
    await withPlatformTx(deps.db, (tx) =>
      tx.update(storeDomains).set({ failureReason: reason.slice(0, 500) }).where(eq(storeDomains.id, domainId)),
    );
  }
}

/**
 * Polls Cloudflare for one domain and applies the lifecycle transition. Called by the
 * worker scheduler for due domains and by the merchant "retry" action.
 */
export async function refreshDomainStatus(deps: DomainDeps, domainId: string): Promise<DomainStatus | null> {
  const cfClient = requireCloudflare(deps.cloudflare);
  const domain = await withPlatformTx(deps.db, (tx) => tx.query.storeDomains.findFirst({ where: eq(storeDomains.id, domainId) }));
  if (!domain || domain.kind !== "custom" || domain.status === "disabled") return null;
  if (!domain.cloudflareCustomHostnameId) {
    await provisionDomain(deps, domainId);
    return "pending";
  }

  const cf = await cfClient.getCustomHostname(domain.cloudflareCustomHostnameId);
  const mapped = mapCloudflareStatus(cf);
  const attempts = domain.checkAttempts + 1;
  const expired = mapped.status !== "active" && Date.now() - domain.validationStartedAt.getTime() > MAX_CHECK_WINDOW_MS;
  const next: DomainStatus = expired ? "failed" : mapped.status;

  await withTenantTx(deps.db, { organizationId: domain.organizationId, storeId: domain.storeId }, async (tx) => {
    await tx
      .update(storeDomains)
      .set({
        status: next,
        sslStatus: mapped.sslStatus,
        verificationStatus: mapped.verificationStatus,
        verificationErrors: mapped.errors,
        dnsInstructions: buildDnsInstructions(cf, {
          hostname: domain.hostname,
          cnameTarget: deps.platform.cnameTarget,
          isApex: domain.redirectToHostname !== null,
          apexARecords: deps.platform.apexARecords,
        }),
        failureReason: expired ? "dns_validation_timeout" : next === "failed" ? mapped.errors[0] ?? cf.status : null,
        checkAttempts: attempts,
        lastCheckedAt: new Date(),
        // Active domains are re-checked daily to detect DNS moved away; failed ones stop polling.
        nextCheckAt:
          next === "failed" ? null : new Date(Date.now() + (next === "active" ? 24 * 3600_000 : nextCheckDelayMs(attempts))),
        activatedAt: next === "active" && !domain.activatedAt ? new Date() : domain.activatedAt,
      })
      .where(eq(storeDomains.id, domainId));

    if (next !== domain.status) {
      await appendEvent(tx, {
        type: "domain.status_changed",
        organizationId: domain.organizationId,
        storeId: domain.storeId,
        aggregateType: "store_domain",
        aggregateId: domain.id,
        payload: { domainId: domain.id, hostname: domain.hostname, from: domain.status, to: next },
      });
      if (next === "active") {
        await appendEvent(tx, {
          type: "domain.activated",
          organizationId: domain.organizationId,
          storeId: domain.storeId,
          aggregateType: "store_domain",
          aggregateId: domain.id,
          payload: { domainId: domain.id, hostname: domain.hostname, storeId: domain.storeId },
        });
      }
      if (next === "active" || domain.status === "active") {
        // A custom canonical that stops being active falls back to the platform subdomain.
        if (domain.status === "active" && domain.isCanonical) await fallbackCanonical(tx, domain.storeId);
        await bumpRouting(tx, { organizationId: domain.organizationId, storeId: domain.storeId });
      }
      await recordAudit(tx, {
        organizationId: domain.organizationId,
        storeId: domain.storeId,
        action: "domain.status_changed",
        resourceType: "store_domain",
        resourceId: domain.id,
        before: { status: domain.status },
        after: { status: next, sslStatus: mapped.sslStatus },
      });
    }
  });
  return next;
}

async function fallbackCanonical(tx: Transaction, storeId: string): Promise<void> {
  await tx.update(storeDomains).set({ isCanonical: false }).where(eq(storeDomains.storeId, storeId));
  await tx
    .update(storeDomains)
    .set({ isCanonical: true })
    .where(and(eq(storeDomains.storeId, storeId), eq(storeDomains.kind, "platform_subdomain")));
}

export async function retryDomain(deps: DomainDeps, ctx: StoreContext, domainId: string): Promise<DomainRow> {
  assertCan(ctx, "domains:manage");
  const domain = await getDomain(deps.db, ctx, domainId);
  if (domain.kind !== "custom") throw invalid("errors.domain.not_custom");
  if (!domain.cloudflareCustomHostnameId) {
    await provisionDomain(deps, domainId);
  } else {
    const cf = requireCloudflare(deps.cloudflare);
    if (domain.status === "failed") await cf.refreshCustomHostname(domain.cloudflareCustomHostnameId);
    await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
      tx
        .update(storeDomains)
        .set({
          checkAttempts: 0,
          ...(domain.status === "failed" ? { validationStartedAt: new Date(), status: "validating" as const } : {}),
        })
        .where(eq(storeDomains.id, domainId)),
    );
    await refreshDomainStatus(deps, domainId);
  }
  return getDomain(deps.db, ctx, domainId);
}

export async function getDomain(db: Database, ctx: StoreContext, domainId: string): Promise<DomainRow> {
  const row = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.query.storeDomains.findFirst({ where: and(eq(storeDomains.id, domainId), eq(storeDomains.storeId, ctx.storeId)) }),
  );
  if (!row) throw notFound("domain", domainId);
  return row;
}

/** Makes an active domain canonical; every other hostname of the store then 301-redirects to it. */
export async function setCanonicalDomain(db: Database, ctx: StoreContext, domainId: string): Promise<DomainRow> {
  assertCan(ctx, "domains:manage");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const domain = await tx.query.storeDomains.findFirst({
      where: and(eq(storeDomains.id, domainId), eq(storeDomains.storeId, ctx.storeId)),
    });
    if (!domain) throw notFound("domain", domainId);
    if (domain.status !== "active") throw new AppError("precondition_failed", "errors.domain.not_active");
    if (domain.redirectToHostname) throw invalid("errors.domain.redirect_only");
    const previous = await tx.query.storeDomains.findFirst({
      where: and(eq(storeDomains.storeId, ctx.storeId), eq(storeDomains.isCanonical, true)),
    });
    if (previous?.id === domainId) return domain;
    await tx.update(storeDomains).set({ isCanonical: false }).where(eq(storeDomains.storeId, ctx.storeId));
    const [updated] = await tx.update(storeDomains).set({ isCanonical: true }).where(eq(storeDomains.id, domainId)).returning();
    await bumpRouting(tx, { organizationId: ctx.organizationId, storeId: ctx.storeId });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "domain.canonical_changed",
      resourceType: "store_domain",
      resourceId: domainId,
      before: { canonical: previous?.hostname ?? null },
      after: { canonical: domain.hostname },
    });
    return updated!;
  });
}

export async function removeDomain(deps: DomainDeps, ctx: StoreContext, domainId: string): Promise<void> {
  assertCan(ctx, "domains:manage");
  const domain = await getDomain(deps.db, ctx, domainId);
  if (domain.kind === "platform_subdomain") throw invalid("errors.domain.platform_subdomain_permanent");
  // Removing a routing hostname also removes the apex that redirects to it.
  const related = await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx
      .select()
      .from(storeDomains)
      .where(and(eq(storeDomains.storeId, ctx.storeId), eq(storeDomains.redirectToHostname, domain.hostname))),
  );
  const targets = [domain, ...related];
  for (const d of targets) {
    if (d.cloudflareCustomHostnameId) await requireCloudflare(deps.cloudflare).deleteCustomHostname(d.cloudflareCustomHostnameId);
  }
  await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    for (const d of targets) await tx.delete(storeDomains).where(eq(storeDomains.id, d.id));
    if (domain.isCanonical) await fallbackCanonical(tx, ctx.storeId);
    await bumpRouting(
      tx,
      { organizationId: ctx.organizationId, storeId: ctx.storeId },
      targets.map((t) => t.hostname),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      action: "domain.removed",
      resourceType: "store_domain",
      resourceId: domainId,
      before: { hostnames: targets.map((t) => t.hostname) },
    });
  });
}

/** Domains whose next status check is due (worker scheduler). */
export async function dueDomainChecks(db: Database, limit = 50): Promise<string[]> {
  const rows = await withPlatformTx(db, (tx) =>
    tx
      .select({ id: storeDomains.id })
      .from(storeDomains)
      .where(and(eq(storeDomains.kind, "custom"), isNotNull(storeDomains.nextCheckAt), lte(storeDomains.nextCheckAt, new Date())))
      .orderBy(asc(storeDomains.nextCheckAt))
      .limit(limit),
  );
  return rows.map((r) => r.id);
}
