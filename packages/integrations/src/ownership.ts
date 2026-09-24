import { z } from "zod";
import { AppError, invalid, notFound } from "@altyapi/commerce-core";
import { and, dataOwnership, eq, integrationConnections, withTenantTx, type Database } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, type StoreContext } from "@altyapi/tenancy";
import { PROVIDERS } from "./registry";

export const OWNERSHIP_DOMAINS = ["stock", "price", "content", "order_fulfillment"] as const;
export type OwnershipDomain = (typeof OWNERSHIP_DOMAINS)[number];

export interface OwnerInfo {
  domain: OwnershipDomain;
  /** null = altyapi owns the data. */
  connectionId: string | null;
  connectionName: string | null;
  provider: string | null;
  externalOwnerLabel: string | null;
}

/** The ownership map; domains without a row are owned by altyapi. */
export async function getOwnership(db: Database, ctx: StoreContext): Promise<OwnerInfo[]> {
  assertCan(ctx, "integrations:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const rows = await tx.select().from(dataOwnership).where(eq(dataOwnership.storeId, ctx.storeId));
    const conns = await tx.select().from(integrationConnections).where(eq(integrationConnections.storeId, ctx.storeId));
    return OWNERSHIP_DOMAINS.map((domain) => {
      const row = rows.find((r) => r.domain === domain);
      const conn = row?.ownerConnectionId ? conns.find((c) => c.id === row.ownerConnectionId) : undefined;
      return {
        domain,
        connectionId: conn?.id ?? null,
        connectionName: conn?.name ?? null,
        provider: conn?.provider ?? null,
        externalOwnerLabel: row?.externalOwnerLabel ?? null,
      };
    });
  });
}

export const setOwnershipSchema = z.object({
  domain: z.enum(OWNERSHIP_DOMAINS),
  ownerConnectionId: z.uuid().nullable(),
  /** Owner outside altyapi's connections (e.g. "Logo Tiger ERP"); writes are then advised, never done. */
  externalOwnerLabel: z.string().trim().max(80).nullable().optional(),
});

/**
 * Sets which system owns a kind of data. Stock or price can only be owned by a connection
 * that reports them; a marketplace's price includes its commission and cannot be the owner.
 */
export async function setOwnership(db: Database, ctx: StoreContext, input: z.infer<typeof setOwnershipSchema>) {
  assertCan(ctx, "integrations:manage");
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(db, scope, async (tx) => {
    if (input.ownerConnectionId) {
      const conn = await tx.query.integrationConnections.findFirst({
        where: and(eq(integrationConnections.id, input.ownerConnectionId), eq(integrationConnections.storeId, ctx.storeId)),
      });
      if (!conn) throw notFound("integration_connection", input.ownerConnectionId);
      const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      if ((input.domain === "stock" || input.domain === "price") && !provider.capabilities.readListings) {
        throw invalid("errors.integrations.owner_cannot_report", { domain: input.domain });
      }
      if (input.domain === "price" && conn.kind === "marketplace") throw invalid("errors.integrations.marketplace_price_owner");
      if (input.domain === "order_fulfillment" && !provider.capabilities.readOrders) throw invalid("errors.integrations.owner_cannot_report", { domain: input.domain });
    }
    if (input.ownerConnectionId && input.externalOwnerLabel) throw new AppError("validation_failed", "errors.integrations.owner_ambiguous");
    const before = await tx.query.dataOwnership.findFirst({ where: and(eq(dataOwnership.storeId, ctx.storeId), eq(dataOwnership.domain, input.domain)) });
    const values = { ownerConnectionId: input.ownerConnectionId, externalOwnerLabel: input.externalOwnerLabel ?? null, updatedByPrincipalId: ctx.principal.userId };
    if (before) await tx.update(dataOwnership).set(values).where(and(eq(dataOwnership.storeId, ctx.storeId), eq(dataOwnership.domain, input.domain)));
    else await tx.insert(dataOwnership).values({ ...scope, domain: input.domain, ...values });
    await recordAudit(tx, {
      action: "integration.ownership_changed",
      resourceType: "data_ownership",
      resourceId: input.domain,
      before: before ? { ownerConnectionId: before.ownerConnectionId, externalOwnerLabel: before.externalOwnerLabel } : { ownerConnectionId: null },
      after: { ownerConnectionId: input.ownerConnectionId, externalOwnerLabel: input.externalOwnerLabel ?? null },
    });
  });
}
