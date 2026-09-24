import { z } from "zod";
import { eq, storeBrandProfiles, withTenantTx, type BrandCompetitor } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, tenantScope, type StoreContext } from "@altyapi/tenancy";
import { cleanPlainText } from "../schemas";
import type { EkosistemServerDeps } from "./common";
import { queuePushTx } from "./push-out";

/**
 * Brand identity the merchant maintains for GET /ekosistem/v1/brand (§7.1): description,
 * target topics, competitors and social profiles. Plain text only; URLs must be https.
 */

const plain = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().min(1).max(max));

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((v) => {
    const u = new URL(v);
    return !u.username && !u.password;
  }, "URL must not contain credentials");

const competitorSchema = z.object({
  name: plain(120),
  website: httpsUrl.nullable().default(null),
  aliases: z.array(plain(120)).max(10).default([]),
});

export const brandProfileSchema = z.object({
  description: z
    .string()
    .max(4000)
    .transform((v) => cleanPlainText(v))
    .nullable()
    .default(null),
  topics: z.array(plain(100)).max(30).default([]),
  competitors: z.array(competitorSchema).max(30).default([]),
  socialProfiles: z.array(httpsUrl).max(15).default([]),
});

export type BrandProfileInput = z.input<typeof brandProfileSchema>;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function view(row: typeof storeBrandProfiles.$inferSelect | undefined, storeId: string) {
  return {
    storeId,
    description: row?.description ?? null,
    topics: row?.topics ?? [],
    competitors: row?.competitors ?? [],
    socialProfiles: row?.socialProfiles ?? [],
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function getBrandProfile(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext) {
  assertCan(ctx, "settings:read");
  const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) => tx.select().from(storeBrandProfiles).where(eq(storeBrandProfiles.storeId, ctx.storeId)));
  return view(row, ctx.storeId);
}

export async function putBrandProfile(deps: Pick<EkosistemServerDeps, "db">, ctx: StoreContext, raw: BrandProfileInput) {
  assertCan(ctx, "settings:write");
  const input = brandProfileSchema.parse(raw);
  const values = {
    description: input.description ? input.description : null,
    topics: uniqueBy(input.topics, (t) => t.toLocaleLowerCase("tr")),
    competitors: uniqueBy(
      input.competitors.map((c): BrandCompetitor => ({ name: c.name, website: c.website, aliases: uniqueBy(c.aliases, (a) => a.toLocaleLowerCase("tr")) })),
      (c) => c.name.toLocaleLowerCase("tr"),
    ),
    socialProfiles: uniqueBy(input.socialProfiles, (u) => u),
    updatedByUserId: ctx.principal.userId,
  };
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [before] = await tx.select().from(storeBrandProfiles).where(eq(storeBrandProfiles.storeId, ctx.storeId));
    const [row] = await tx
      .insert(storeBrandProfiles)
      .values({ storeId: ctx.storeId, organizationId: ctx.organizationId, ...values })
      .onConflictDoUpdate({ target: storeBrandProfiles.storeId, set: { ...values, updatedAt: new Date() } })
      .returning();
    // Linked peers holding brand:read learn about the change (§10).
    await queuePushTx(tx, tenantScope(ctx), { type: "altyapi.brand.updated", ref: ctx.storeId }, new Date());
    await recordAudit(tx, {
      action: "ekosistem.brand_profile_updated",
      resourceType: "store_brand_profile",
      resourceId: ctx.storeId,
      before: before ? view(before, ctx.storeId) : null,
      after: view(row, ctx.storeId),
    });
    return view(row, ctx.storeId);
  });
}
