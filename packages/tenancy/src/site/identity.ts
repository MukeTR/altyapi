import { isDeepStrictEqual } from "node:util";
import { assertStoreLocales, invalid, newId } from "@altyapi/commerce-core";
import { and, assetReferences, businessIdentities, contentAssets, eq, inArray, isNull, withTenantTx, type Database, type DbExecutor } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { businessIdentityInputSchema, identityProblems, taxNumberKind, type BusinessIdentityInput } from "@altyapi/site";
import { assertCan, can, tenantScope, type StoreContext } from "../context";
import { bumpStoreVersions, lockSiteProfile } from "./shared";

type IdentityRow = typeof businessIdentities.$inferSelect;

/** The editable identity fields, in form order. */
const IDENTITY_FIELDS = [
  "legalName",
  "tradeName",
  "legalForm",
  "mersisNo",
  "tradeRegistryNo",
  "taxOffice",
  "taxNumber",
  "taxNumberPublic",
  "kepAddress",
  "chamber",
  "chamberRulesUrl",
  "phone",
  "email",
  "address",
  "foundingDate",
  "logoAssetId",
  "description",
  "sameAs",
  "identifiers",
] as const satisfies readonly (keyof IdentityRow)[];

type IdentityField = (typeof IDENTITY_FIELDS)[number];
export type BusinessIdentityFields = Pick<IdentityRow, IdentityField>;

export interface BusinessIdentityView extends BusinessIdentityFields {
  /** Null until the identity is first saved. */
  updatedAt: Date | null;
  /**
   * True when taxNumber is a sole proprietor's citizen number (TCKN) shown masked to its last
   * two digits: only principals who may edit the identity (site:write) see it in full.
   */
  taxNumberMasked: boolean;
}

const EMPTY_IDENTITY: BusinessIdentityFields = {
  legalName: null,
  tradeName: null,
  legalForm: null,
  mersisNo: null,
  tradeRegistryNo: null,
  taxOffice: null,
  taxNumber: null,
  taxNumberPublic: false,
  kepAddress: null,
  chamber: null,
  chamberRulesUrl: null,
  phone: null,
  email: null,
  address: null,
  foundingDate: null,
  logoAssetId: null,
  description: {},
  sameAs: [],
  identifiers: {},
};

/** Asset reference owner type: keeps the logo from being cleaned up while the identity uses it. */
const LOGO_REFERENCE = "business_identity";

function fieldsOf(row: IdentityRow | undefined): BusinessIdentityFields {
  if (!row) return { ...EMPTY_IDENTITY };
  return Object.fromEntries(IDENTITY_FIELDS.map((f) => [f, row[f]])) as BusinessIdentityFields;
}

/** A sole proprietor's citizen number (TCKN, personal data) masked to its last two digits; other values unchanged. */
function maskTckn(taxNumber: string | null): string | null {
  return taxNumber && taxNumberKind(taxNumber) === "tckn" ? `*********${taxNumber.slice(-2)}` : taxNumber;
}

/**
 * Audit snapshots keep identity changes reviewable without copying a sole proprietor's
 * citizen number (TCKN, personal data) into the audit log: it is masked to its last two digits.
 */
function auditSnapshot(fields: Partial<BusinessIdentityFields>) {
  const out: Record<string, unknown> = { ...fields };
  if (typeof fields.taxNumber === "string") out.taxNumber = maskTckn(fields.taxNumber);
  return out;
}

/**
 * The identity as a principal may see it. A TCKN is personal data: readers (site:read roles
 * such as analysts, developers, catalog and marketing staff, API clients and agents) get it
 * masked; those who edit the identity (site:write) get it in full. A VKN is a company's tax
 * number and is shown as it is.
 */
function identityView(ctx: StoreContext, row: IdentityRow | undefined): BusinessIdentityView {
  const fields = fieldsOf(row);
  const masked = !can(ctx, "site:write") && maskTckn(fields.taxNumber) !== fields.taxNumber;
  return { ...fields, taxNumber: masked ? maskTckn(fields.taxNumber) : fields.taxNumber, updatedAt: row?.updatedAt ?? null, taxNumberMasked: masked };
}

export async function getBusinessIdentity(db: Database, ctx: StoreContext): Promise<BusinessIdentityView> {
  assertCan(ctx, "site:read");
  const row = await withTenantTx(db, tenantScope(ctx), (tx) =>
    tx.query.businessIdentities.findFirst({ where: eq(businessIdentities.storeId, ctx.storeId) }),
  );
  return identityView(ctx, row);
}

/** The logo must be a live public image of this store (assets are uploaded per store). */
async function assertLogoUsable(tx: DbExecutor, storeId: string, assetId: string): Promise<void> {
  const asset = await tx.query.contentAssets.findFirst({
    where: and(
      eq(contentAssets.id, assetId),
      eq(contentAssets.storeId, storeId),
      eq(contentAssets.kind, "image"),
      eq(contentAssets.bucket, "storefront-public"),
      inArray(contentAssets.status, ["uploaded", "processing", "ready"]),
      isNull(contentAssets.deletedAt),
    ),
  });
  if (!asset) throw invalid("errors.site.identity.logo_invalid", { assetId });
}

async function setLogoReference(tx: DbExecutor, scope: { organizationId: string; storeId: string }, assetId: string | null): Promise<void> {
  await tx
    .delete(assetReferences)
    .where(
      and(
        eq(assetReferences.storeId, scope.storeId),
        eq(assetReferences.resourceType, LOGO_REFERENCE),
        eq(assetReferences.resourceId, scope.storeId),
      ),
    );
  if (assetId) {
    await tx.insert(assetReferences).values({ id: newId(), ...scope, assetId, resourceType: LOGO_REFERENCE, resourceId: scope.storeId });
  }
}

/**
 * Saves the business identity (site:write) with patch semantics: omitted fields keep their
 * value, null clears them, so onboarding can fill it in step by step. Validates registry
 * numbers (VKN/TCKN checksums, MERSİS, KEP, E.164, e-mail) and cross-field consistency on the
 * merged result. The storefront renders the identity (imprint, contact facts, JSON-LD), so a
 * change bumps the content version and emits site.identity_changed with field names only.
 */
export async function saveBusinessIdentity(db: Database, ctx: StoreContext, input: BusinessIdentityInput): Promise<BusinessIdentityView> {
  assertCan(ctx, "site:write");
  const patch = businessIdentityInputSchema.parse(input);
  if (patch.description) assertStoreLocales(patch.description, ctx.store.supportedLocales, "description");

  return withTenantTx(db, tenantScope(ctx), async (tx) => {
    await lockSiteProfile(tx, ctx.storeId);
    const existing = await tx.query.businessIdentities.findFirst({ where: eq(businessIdentities.storeId, ctx.storeId) });
    const before = fieldsOf(existing);
    const next: BusinessIdentityFields = { ...before };
    for (const f of IDENTITY_FIELDS) {
      if (patch[f] !== undefined) (next as Record<IdentityField, unknown>)[f] = patch[f];
    }

    const problems = identityProblems(next);
    if (problems.length) throw invalid(problems[0]!, { problems });
    const changed = IDENTITY_FIELDS.filter((f) => !isDeepStrictEqual(before[f], next[f]));
    if (!changed.length) return identityView(ctx, existing);
    if (changed.includes("logoAssetId") && next.logoAssetId) await assertLogoUsable(tx, ctx.storeId, next.logoAssetId);

    const [saved] = existing
      ? await tx
          .update(businessIdentities)
          .set({ ...next, updatedByPrincipalId: ctx.principal.userId })
          .where(eq(businessIdentities.storeId, ctx.storeId))
          .returning()
      : await tx
          .insert(businessIdentities)
          .values({ ...tenantScope(ctx), ...next, updatedByPrincipalId: ctx.principal.userId })
          .returning();
    if (changed.includes("logoAssetId")) await setLogoReference(tx, tenantScope(ctx), next.logoAssetId);
    const { contentVersion } = await bumpStoreVersions(tx, ctx.storeId, { modules: false });

    await appendEvent(tx, {
      type: "site.identity_changed",
      ...tenantScope(ctx),
      aggregateType: "business_identity",
      aggregateId: ctx.storeId,
      payload: { fields: changed, contentVersion },
    });
    await recordAudit(tx, {
      ...tenantScope(ctx),
      action: existing ? "site.identity_updated" : "site.identity_created",
      resourceType: "business_identity",
      resourceId: ctx.storeId,
      before: auditSnapshot(Object.fromEntries(changed.map((f) => [f, before[f]]))),
      after: auditSnapshot(Object.fromEntries(changed.map((f) => [f, next[f]]))),
    });
    return identityView(ctx, saved);
  });
}
