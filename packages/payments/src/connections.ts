import { z } from "zod";
import { AppError, invalid, newId, notFound } from "@altyapi/commerce-core";
import { and, desc, eq, paymentProviderConnections, withTenantTx, type Database, type Transaction } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { decryptJson, encryptJson, type KeyProvider } from "@altyapi/secrets";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import type { ProviderRegistry } from "./registry";
import type { PaymentMode, PaymentProvider, ProviderName } from "./types";

export const connectProviderSchema = z.object({
  provider: z.enum(["paytr", "iyzico"]),
  mode: z.enum(["test", "live"]),
  credentials: z.record(z.string(), z.string().max(256)),
  priority: z.number().int().min(0).max(100).default(0),
});

export interface PaymentsDeps {
  db: Database;
  keys: KeyProvider | null;
  registry: ProviderRegistry;
}

export type ConnectionRow = typeof paymentProviderConnections.$inferSelect;

const context = (storeId: string, provider: string) => ({ storeId, purpose: `payment:${provider}` });

function requireKeys(keys: KeyProvider | null): KeyProvider {
  if (!keys) throw new AppError("dependency_unavailable", "errors.secrets.not_configured");
  return keys;
}

export function connectionView(c: ConnectionRow, registry: ProviderRegistry, apiUrl: string) {
  const def = registry[c.provider];
  return {
    id: c.id,
    provider: c.provider,
    mode: c.mode,
    status: c.status,
    displayHint: c.displayHint,
    priority: c.priority,
    lastVerifiedAt: c.lastVerifiedAt,
    lastError: c.lastError,
    capabilities: {
      partialRefund: def.supportsPartialRefund,
      cancel: def.supportsCancel,
      requiresPhone: def.requiresPhone,
    },
    // Shown in payment settings so the merchant can paste it into the provider panel.
    notificationUrl:
      c.provider === "paytr"
        ? `${apiUrl}/payments/v1/paytr/notify/${c.id}`
        : `${apiUrl}/payments/v1/iyzico/webhook/${c.id}`,
    notificationUrlSetting: def.notificationUrlSetting,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Stores merchant credentials (envelope-encrypted) after verifying them with the provider.
 * Money never flows through the platform: the merchant's own account is used.
 */
export async function connectProvider(deps: PaymentsDeps, ctx: StoreContext, input: z.infer<typeof connectProviderSchema>): Promise<ConnectionRow> {
  assertCan(ctx, "payments:manage");
  const keys = requireKeys(deps.keys);
  const def = deps.registry[input.provider];
  let credentials: Record<string, string>;
  try {
    credentials = def.parseCredentials(input.credentials);
  } catch {
    throw invalid("errors.payments.invalid_credentials_format");
  }
  const check = await def.create(credentials, input.mode).verifyCredentials().catch((err: Error) => ({ ok: false, message: err.message }));
  if (!check.ok) throw new AppError("validation_failed", "errors.payments.credentials_rejected", { message: check.message });

  const envelope = await encryptJson(keys, credentials, context(ctx.storeId, input.provider));
  return withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const existing = await tx.query.paymentProviderConnections.findFirst({
      where: and(eq(paymentProviderConnections.storeId, ctx.storeId), eq(paymentProviderConnections.provider, input.provider)),
    });
    const values = {
      mode: input.mode,
      status: "active" as const,
      ...envelope,
      displayHint: def.displayHint(credentials),
      priority: input.priority,
      lastVerifiedAt: new Date(),
      lastError: null,
    };
    const [row] = existing
      ? await tx.update(paymentProviderConnections).set(values).where(eq(paymentProviderConnections.id, existing.id)).returning()
      : await tx.insert(paymentProviderConnections).values({ id: newId(), organizationId: ctx.organizationId, storeId: ctx.storeId, provider: input.provider, ...values }).returning();
    await recordAudit(tx, {
      action: existing ? "payment_connection.updated" : "payment_connection.created",
      resourceType: "payment_provider_connection",
      resourceId: row!.id,
      // Credentials are never written to the audit log; only non-secret metadata.
      before: existing ? { mode: existing.mode, displayHint: existing.displayHint, status: existing.status } : undefined,
      after: { provider: input.provider, mode: input.mode, displayHint: values.displayHint },
    });
    return row!;
  });
}

export async function listConnections(db: Database, ctx: StoreContext): Promise<ConnectionRow[]> {
  assertCan(ctx, "payments:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.select().from(paymentProviderConnections).where(eq(paymentProviderConnections.storeId, ctx.storeId)).orderBy(desc(paymentProviderConnections.priority)),
  );
}

export async function setConnectionStatus(db: Database, ctx: StoreContext, connectionId: string, status: "active" | "disabled") {
  assertCan(ctx, "payments:manage");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const [row] = await tx
      .update(paymentProviderConnections)
      .set({ status })
      .where(and(eq(paymentProviderConnections.id, connectionId), eq(paymentProviderConnections.storeId, ctx.storeId)))
      .returning();
    if (!row) throw notFound("payment_provider_connection", connectionId);
    await recordAudit(tx, { action: `payment_connection.${status}`, resourceType: "payment_provider_connection", resourceId: connectionId });
    return row;
  });
}

export async function deleteConnection(db: Database, ctx: StoreContext, connectionId: string) {
  assertCan(ctx, "payments:manage");
  await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const deleted = await tx
      .delete(paymentProviderConnections)
      .where(and(eq(paymentProviderConnections.id, connectionId), eq(paymentProviderConnections.storeId, ctx.storeId)))
      .returning();
    if (!deleted.length) throw notFound("payment_provider_connection", connectionId);
    await recordAudit(tx, { action: "payment_connection.deleted", resourceType: "payment_provider_connection", resourceId: connectionId, before: { provider: deleted[0]!.provider } });
  });
}

/** Decrypts credentials and instantiates the provider adapter for a connection. */
export async function providerForConnection(deps: PaymentsDeps, connection: ConnectionRow): Promise<PaymentProvider> {
  const keys = requireKeys(deps.keys);
  const creds = await decryptJson<Record<string, string>>(keys, connection, context(connection.storeId, connection.provider));
  return deps.registry[connection.provider].create(creds, connection.mode as PaymentMode);
}

/** Active connection for checkout: the requested provider, otherwise the highest priority one. */
export async function selectConnection(tx: Transaction, storeId: string, provider?: ProviderName): Promise<ConnectionRow> {
  const rows = await tx
    .select()
    .from(paymentProviderConnections)
    .where(and(eq(paymentProviderConnections.storeId, storeId), eq(paymentProviderConnections.status, "active")))
    .orderBy(desc(paymentProviderConnections.priority));
  const row = provider ? rows.find((r) => r.provider === provider) : rows[0];
  if (!row) throw new AppError("precondition_failed", "errors.payments.no_active_provider");
  return row;
}
