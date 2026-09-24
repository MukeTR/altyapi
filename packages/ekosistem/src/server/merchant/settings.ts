import { z } from "zod";
import { notFound } from "@altyapi/commerce-core";
import { eq, sql, stores, withTenantTx, type DbExecutor } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, tenantScope, type StoreContext } from "@altyapi/tenancy";
import type { EkosistemServerDeps } from "../common";

/**
 * Store settings of the bridge, kept under stores.settings.ekosistem and validated here.
 *
 * profitGuard (§8.7 altyapi policy) decides what a profit check means for admin actions such
 * as saving a campaign or a price change: `block` refuses a below-floor save (a user with
 * campaigns:approve may pass with a justification), `warn` warns and saves, `ignore` skips
 * the check. It never applies to customer flows.
 */

export const PROFIT_GUARD_POLICIES = ["block", "warn", "ignore"] as const;
export type ProfitGuardPolicy = (typeof PROFIT_GUARD_POLICIES)[number];

export const ekosistemSettingsSchema = z.object({
  profitGuard: z.enum(PROFIT_GUARD_POLICIES).default("warn"),
});
export type EkosistemSettings = z.infer<typeof ekosistemSettingsSchema>;

export const DEFAULT_EKOSISTEM_SETTINGS: EkosistemSettings = { profitGuard: "warn" };

export const putEkosistemSettingsSchema = z.object({ profitGuard: z.enum(PROFIT_GUARD_POLICIES) });

/** Reads the validated settings; anything unreadable falls back to the defaults. */
export function readEkosistemSettings(settings: Record<string, unknown> | null | undefined): EkosistemSettings {
  const parsed = ekosistemSettingsSchema.safeParse(settings?.ekosistem ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_EKOSISTEM_SETTINGS };
}

export async function loadEkosistemSettings(tx: DbExecutor, storeId: string): Promise<EkosistemSettings> {
  const [row] = await tx.select({ settings: stores.settings }).from(stores).where(eq(stores.id, storeId));
  if (!row) throw notFound("store", storeId);
  return readEkosistemSettings(row.settings);
}

export async function getEkosistemSettings(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext): Promise<EkosistemSettings> {
  assertCan(ctx, "settings:read");
  return withTenantTx(deps.db, tenantScope(ctx), (tx) => loadEkosistemSettings(tx, ctx.storeId));
}

export async function putEkosistemSettings(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext, raw: z.input<typeof putEkosistemSettingsSchema>): Promise<EkosistemSettings> {
  assertCan(ctx, "settings:write");
  const input = putEkosistemSettingsSchema.parse(raw);
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const before = await loadEkosistemSettings(tx, ctx.storeId);
    const after: EkosistemSettings = { ...before, ...input };
    // Only the ekosistem key is replaced; other settings stay as they are.
    await tx
      .update(stores)
      .set({ settings: sql`jsonb_set(coalesce(${stores.settings}, '{}'::jsonb), '{ekosistem}', ${JSON.stringify(after)}::jsonb, true)` })
      .where(eq(stores.id, ctx.storeId));
    await recordAudit(tx, { action: "ekosistem.settings_updated", resourceType: "store", resourceId: ctx.storeId, before, after });
    return after;
  });
}
