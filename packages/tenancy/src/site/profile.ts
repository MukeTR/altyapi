import { isDeepStrictEqual } from "node:util";
import { conflict, notFound } from "@altyapi/commerce-core";
import { and, contentTypes, eq, inArray, pages, pageVersions, publications, siteProfiles, sql, storefrontState, withTenantTx, type Database, type Transaction } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { isReservedPathSegment, servesIndexRoute, siteProfileUpdateSchema, type SiteProfileUpdateInput } from "@altyapi/site";
import { assertCan, tenantScope, type StoreContext } from "../context";
import { bumpStoreVersions, lockSiteProfile } from "./shared";

type SiteProfileRow = typeof siteProfiles.$inferSelect;

export interface SiteProfileView {
  kind: SiteProfileRow["kind"];
  /** Pinned primary vertical pack release; null = platform baseline. */
  primaryPack: string | null;
  addonPacks: string[];
  pageUrlStyle: SiteProfileRow["pageUrlStyle"];
  untranslatedPolicy: SiteProfileRow["untranslatedPolicy"];
  aiCrawlers: SiteProfileRow["aiCrawlers"];
  verificationMeta: SiteProfileRow["verificationMeta"];
  modulesVersion: number;
  policyVersion: number;
  updatedAt: Date;
}

const EDITABLE_FIELDS = ["kind", "pageUrlStyle", "untranslatedPolicy", "aiCrawlers", "verificationMeta"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

function toView(row: SiteProfileRow, versions: { modulesVersion: number; policyVersion: number }): SiteProfileView {
  return {
    kind: row.kind,
    primaryPack: row.primaryPack,
    addonPacks: row.addonPacks,
    pageUrlStyle: row.pageUrlStyle,
    untranslatedPolicy: row.untranslatedPolicy,
    aiCrawlers: row.aiCrawlers,
    verificationMeta: row.verificationMeta,
    modulesVersion: versions.modulesVersion,
    policyVersion: versions.policyVersion,
    updatedAt: row.updatedAt,
  };
}

export async function getSiteProfile(db: Database, ctx: StoreContext): Promise<SiteProfileView> {
  assertCan(ctx, "site:read");
  const row = await withTenantTx(db, tenantScope(ctx), (tx) => tx.query.siteProfiles.findFirst({ where: eq(siteProfiles.storeId, ctx.storeId) }));
  if (!row) throw notFound("site_profile", ctx.storeId);
  return toView(row, ctx.store);
}

/**
 * Pages move to /{handle} with the root URL style. Refused while a page (drafted or live) has a
 * handle that is a system path or language code, or the path a content type answers itself
 * (its index or singleton): the page would be unreachable there.
 */
async function assertRootStyleClear(tx: Transaction, storeId: string): Promise<void> {
  const drafts = await tx.select({ handle: pages.handle }).from(pages).where(and(eq(pages.storeId, storeId), inArray(pages.type, ["page", "landing"])));
  const live = await tx
    .select({ handle: pageVersions.handle })
    .from(storefrontState)
    .innerJoin(publications, eq(publications.id, storefrontState.activePublicationId))
    .innerJoin(pageVersions, sql`${pageVersions.id}::text in (select e.value from jsonb_each_text(${publications.pageVersions}) as e)`)
    .where(and(eq(storefrontState.storeId, storeId), inArray(pageVersions.type, ["page", "landing"])));
  const handles = new Set([...drafts, ...live].map((p) => p.handle));
  for (const handle of handles) if (isReservedPathSegment(handle)) throw conflict("errors.site.profile.root_path_taken", { handle });
  const types = await tx
    .select({ key: contentTypes.key, kind: contentTypes.kind, routePrefix: contentTypes.routePrefix, settings: contentTypes.settings })
    .from(contentTypes)
    .where(and(eq(contentTypes.storeId, storeId), eq(contentTypes.status, "active")));
  for (const t of types) {
    if (!servesIndexRoute(t)) continue;
    const clash = Object.values(t.routePrefix).find((prefix) => handles.has(prefix));
    if (clash) throw conflict("errors.site.profile.root_path_taken", { handle: clash, typeKey: t.key });
  }
}

/**
 * Changes the site profile (site:manage): kind, page URL style, untranslated-language policy,
 * AI training crawler preference and search-console verification tokens. Every effective
 * change bumps the modules version (the route table and module-derived caches read the
 * profile) and the content version (page URLs, the untranslated-language fallback and the
 * verification <meta> tags in every page head are rendered from it). The AI crawler preference
 * is stored for the robots.txt crawler policy of the GEO phase (plan §11 Faz 2).
 * Changing the kind never touches modules: it is the onboarding preset, not a switch.
 */
export async function updateSiteProfile(db: Database, ctx: StoreContext, input: SiteProfileUpdateInput): Promise<SiteProfileView> {
  assertCan(ctx, "site:manage");
  const patch = siteProfileUpdateSchema.parse(input);
  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    const before = await lockSiteProfile(tx, ctx.storeId);
    const changed = EDITABLE_FIELDS.filter((f) => patch[f] !== undefined && !isDeepStrictEqual(patch[f], before[f]));
    if (!changed.length) return toView(before, ctx.store);

    if (changed.includes("pageUrlStyle") && patch.pageUrlStyle === "root") await assertRootStyleClear(tx, ctx.storeId);
    const set: Partial<Pick<SiteProfileRow, EditableField>> = Object.fromEntries(changed.map((f) => [f, patch[f]]));
    const [after] = await tx.update(siteProfiles).set(set).where(eq(siteProfiles.storeId, ctx.storeId)).returning();
    const versions = await bumpStoreVersions(tx, ctx.storeId, { modules: true });

    await appendEvent(tx, {
      type: "site.profile_changed",
      ...tenantScope(ctx),
      aggregateType: "site_profile",
      aggregateId: ctx.storeId,
      payload: { fields: changed, modulesVersion: versions.modulesVersion, contentVersion: versions.contentVersion },
    });
    await recordAudit(tx, {
      ...tenantScope(ctx),
      action: "site.profile_updated",
      resourceType: "site_profile",
      resourceId: ctx.storeId,
      before: Object.fromEntries(changed.map((f) => [f, before[f]])),
      after: Object.fromEntries(changed.map((f) => [f, after![f]])),
    });
    return toView(after!, { modulesVersion: versions.modulesVersion, policyVersion: ctx.store.policyVersion });
  });
}
