import { z } from "zod";
import type { Redis } from "ioredis";
import { AppError, conflict, invalid, newId, notFound } from "@altyapi/commerce-core";
import { and, desc, eq, integrationConnections, integrationSyncRuns, withTenantTx, type Database } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import type { Logger } from "@altyapi/observability";
import { decryptJson, encryptJson, type KeyProvider } from "@altyapi/secrets";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { HttpClient } from "./http";
import { PROVIDER_IDS, PROVIDERS } from "./registry";
import type { Connector, ProviderDefinition, SessionStore } from "./types";

export interface IntegrationDeps {
  db: Database;
  keys: KeyProvider | null;
  redis: Redis | null;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export type ConnectionRow = typeof integrationConnections.$inferSelect;

export const credentialsContext = (storeId: string, provider: string) => ({ storeId, purpose: `integration:${provider}` });
export const sessionContext = (storeId: string, provider: string) => ({ storeId, purpose: `integration-session:${provider}` });

export function requireKeys(keys: KeyProvider | null): KeyProvider {
  if (!keys) throw new AppError("dependency_unavailable", "errors.secrets.not_configured");
  return keys;
}

/** In-memory session with a dirty flag; persisted (encrypted) by the caller when changed. */
export class MemorySession implements SessionStore {
  dirty = false;
  constructor(private value: Record<string, unknown> | null) {}
  get<T extends Record<string, unknown>>(): T | null {
    return this.value as T | null;
  }
  set(value: Record<string, unknown> | null) {
    this.value = value;
    this.dirty = true;
  }
  snapshot() {
    return this.value;
  }
}

export function buildConnector(
  deps: IntegrationDeps,
  provider: ProviderDefinition<any, any>,
  input: { connectionId: string; credentials: unknown; settings: unknown; session: MemorySession; defaultCurrency: string },
): Connector {
  if (!provider.create) throw new AppError("unprocessable", "errors.integrations.provider_not_available", { provider: provider.id });
  return provider.create({
    credentials: input.credentials,
    settings: input.settings,
    session: input.session,
    http: new HttpClient({ redis: deps.redis, connectionId: input.connectionId, logger: deps.logger, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) }),
    logger: deps.logger,
    defaultCurrency: input.defaultCurrency,
  });
}

/** Decrypts a stored connection and builds its connector; `persist` saves a changed session. */
export async function openConnector(deps: IntegrationDeps, conn: ConnectionRow, defaultCurrency: string) {
  const keys = requireKeys(deps.keys);
  const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
  const credentials = await decryptJson(keys, conn.credentials, credentialsContext(conn.storeId, conn.provider));
  const settings = provider.settingsSchema.parse(conn.settings);
  const session = new MemorySession(conn.session ? await decryptJson(keys, conn.session, sessionContext(conn.storeId, conn.provider)) : null);
  const connector = buildConnector(deps, provider, { connectionId: conn.id, credentials, settings, session, defaultCurrency });
  const persist = async () => {
    if (!session.dirty) return;
    const envelope = session.snapshot() ? await encryptJson(keys, session.snapshot(), sessionContext(conn.storeId, conn.provider)) : null;
    await withTenantTx(deps.db, { organizationId: conn.organizationId, storeId: conn.storeId }, (tx) =>
      tx.update(integrationConnections).set({ session: envelope }).where(eq(integrationConnections.id, conn.id)),
    );
  };
  return { provider, connector, persist };
}

export function connectionView(c: ConnectionRow) {
  const provider = PROVIDERS[c.provider as keyof typeof PROVIDERS];
  return {
    id: c.id,
    provider: c.provider,
    providerName: provider?.name ?? c.provider,
    kind: c.kind,
    name: c.name,
    status: c.status,
    // Settings are non-secret by contract; credentials and sessions are never returned.
    settings: c.settings,
    capabilities: provider?.capabilities ?? null,
    pollIntervalMinutes: c.pollIntervalMinutes,
    nextSyncAt: c.nextSyncAt,
    lastSyncAt: c.lastSyncAt,
    lastSuccessAt: c.lastSuccessAt,
    lastError: c.lastError,
    consecutiveFailures: c.consecutiveFailures,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const connectSchema = z.object({
  provider: z.enum(PROVIDER_IDS as [string, ...string[]]),
  name: z.string().trim().min(1).max(80),
  credentials: z.record(z.string(), z.string().max(2000)),
  settings: z.record(z.string(), z.unknown()).default({}),
  pollIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

function parseWith<T>(schema: z.ZodType<T>, value: unknown, key: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw invalid(`errors.integrations.invalid_${key}`, { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

/**
 * Verifies the merchant's credentials with the provider, then stores them envelope-encrypted.
 * Nothing is written to the provider; the first sync starts right away.
 */
export async function connectIntegration(deps: IntegrationDeps, ctx: StoreContext, input: z.infer<typeof connectSchema>) {
  assertCan(ctx, "integrations:manage");
  const provider = PROVIDERS[input.provider as keyof typeof PROVIDERS];
  if (!provider.create || provider.docs.status !== "verified") {
    throw new AppError("unprocessable", "errors.integrations.provider_not_available", { provider: provider.id, notes: provider.docs.notes });
  }
  const keys = requireKeys(deps.keys);
  const credentials = parseWith(provider.credentialsSchema, input.credentials, "credentials");
  const settings = parseWith(provider.settingsSchema, input.settings, "settings");
  const id = newId();
  const session = new MemorySession(null);
  const connector = buildConnector(deps, provider, { connectionId: id, credentials, settings, session, defaultCurrency: ctx.store.defaultCurrency });
  const check = await connector.verify();
  if (!check.ok) throw new AppError("validation_failed", "errors.integrations.verification_failed", { message: check.message.slice(0, 500) });

  const credentialsEnvelope = await encryptJson(keys, credentials, credentialsContext(ctx.storeId, provider.id));
  const sessionEnvelope = session.snapshot() ? await encryptJson(keys, session.snapshot(), sessionContext(ctx.storeId, provider.id)) : null;
  return withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const dup = await tx.query.integrationConnections.findFirst({
      where: and(eq(integrationConnections.storeId, ctx.storeId), eq(integrationConnections.provider, provider.id), eq(integrationConnections.name, input.name)),
    });
    if (dup) throw conflict("errors.integrations.name_taken");
    const [row] = await tx
      .insert(integrationConnections)
      .values({
        id,
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        provider: provider.id,
        kind: provider.kind,
        name: input.name,
        credentials: credentialsEnvelope,
        settings: settings as Record<string, unknown>,
        session: sessionEnvelope,
        pollIntervalMinutes: input.pollIntervalMinutes ?? provider.defaultPollMinutes,
        nextSyncAt: new Date(),
        createdByPrincipalId: ctx.principal.userId,
      })
      .returning();
    await recordAudit(tx, {
      action: "integration.connected",
      resourceType: "integration_connection",
      resourceId: id,
      after: { provider: provider.id, name: input.name, settings, account: check.label },
    });
    return { connection: connectionView(row!), account: check.label };
  });
}

export async function listConnections(db: Database, ctx: StoreContext) {
  assertCan(ctx, "integrations:read");
  const rows = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.select().from(integrationConnections).where(eq(integrationConnections.storeId, ctx.storeId)).orderBy(integrationConnections.createdAt),
  );
  return rows.map(connectionView);
}

async function loadOwned(db: Database, ctx: StoreContext, id: string) {
  const row = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, id), eq(integrationConnections.storeId, ctx.storeId)) }),
  );
  if (!row) throw notFound("integration_connection", id);
  return row;
}

export async function getConnection(db: Database, ctx: StoreContext, id: string) {
  assertCan(ctx, "integrations:read");
  const row = await loadOwned(db, ctx, id);
  const runs = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.connectionId, id)).orderBy(desc(integrationSyncRuns.startedAt)).limit(20),
  );
  return { ...connectionView(row), recentRuns: runs };
}

export const updateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "paused"]).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  credentials: z.record(z.string(), z.string().max(2000)).optional(),
  pollIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

/** Changing credentials or settings re-verifies them with the provider before saving. */
export async function updateConnection(deps: IntegrationDeps, ctx: StoreContext, id: string, input: z.infer<typeof updateConnectionSchema>) {
  assertCan(ctx, "integrations:manage");
  const row = await loadOwned(deps.db, ctx, id);
  const provider = PROVIDERS[row.provider as keyof typeof PROVIDERS];
  const keys = requireKeys(deps.keys);
  const patch: Partial<typeof integrationConnections.$inferInsert> = {};
  if (input.name) patch.name = input.name;
  if (input.pollIntervalMinutes) patch.pollIntervalMinutes = input.pollIntervalMinutes;
  if (input.status) {
    patch.status = input.status;
    if (input.status === "active") {
      patch.nextSyncAt = new Date();
      patch.consecutiveFailures = 0;
    }
  }
  if (input.settings || input.credentials) {
    const credentials = input.credentials
      ? parseWith(provider.credentialsSchema, input.credentials, "credentials")
      : await decryptJson(keys, row.credentials, credentialsContext(row.storeId, row.provider));
    const settings = parseWith(provider.settingsSchema, input.settings ?? row.settings, "settings");
    const session = new MemorySession(null);
    const check = await buildConnector(deps, provider, { connectionId: id, credentials, settings, session, defaultCurrency: ctx.store.defaultCurrency }).verify();
    if (!check.ok) throw new AppError("validation_failed", "errors.integrations.verification_failed", { message: check.message.slice(0, 500) });
    patch.settings = settings as Record<string, unknown>;
    if (input.credentials) patch.credentials = await encryptJson(keys, credentials, credentialsContext(row.storeId, row.provider));
    patch.session = session.snapshot() ? await encryptJson(keys, session.snapshot(), sessionContext(row.storeId, row.provider)) : null;
    // Settings such as store ids change what a cursor means; start the next pass fresh.
    patch.cursors = {};
    patch.status = "active";
    patch.lastError = null;
    patch.nextSyncAt = new Date();
  }
  return withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const [updated] = await tx.update(integrationConnections).set(patch).where(eq(integrationConnections.id, id)).returning();
    await recordAudit(tx, {
      action: "integration.updated",
      resourceType: "integration_connection",
      resourceId: id,
      after: { name: input.name, status: input.status, settings: input.settings, pollIntervalMinutes: input.pollIntervalMinutes, credentialsReplaced: Boolean(input.credentials) },
    });
    return connectionView(updated!);
  });
}

export async function deleteConnection(db: Database, ctx: StoreContext, id: string) {
  assertCan(ctx, "integrations:manage");
  const row = await loadOwned(db, ctx, id);
  await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    await tx.delete(integrationConnections).where(eq(integrationConnections.id, id));
    await recordAudit(tx, { action: "integration.deleted", resourceType: "integration_connection", resourceId: id, before: { provider: row.provider, name: row.name } });
  });
}

/** Asks the worker to sync now (it picks due connections every few seconds). */
export async function requestSync(db: Database, ctx: StoreContext, id: string) {
  assertCan(ctx, "integrations:manage");
  const row = await loadOwned(db, ctx, id);
  if (row.status === "paused") throw new AppError("precondition_failed", "errors.integrations.paused");
  await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.update(integrationConnections).set({ nextSyncAt: new Date() }).where(eq(integrationConnections.id, id)),
  );
  return { queued: true };
}
