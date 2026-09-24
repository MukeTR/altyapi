import { z } from "zod";
import { AppError, conflict } from "@altyapi/commerce-core";
import { eq, sql, stores, trackingConfigs, withTenantTx, type Database, type DbExecutor } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { appendEvent } from "@altyapi/events";
import { decryptJson, encryptJson, type KeyProvider } from "@altyapi/secrets";
import { assertCan, type StoreContext } from "@altyapi/tenancy";

/**
 * Protected tracking layer. Pixels, analytics tags, conversion APIs and the consent policy
 * live here, never in themes, pages or sections: design edits, publishes, rollbacks and AI
 * design actions cannot add, change or remove them. Only principals with `tracking:manage`
 * can write this configuration.
 */

export interface TrackingSecrets {
  metaCapiAccessToken?: string;
  metaTestEventCode?: string;
  tiktokAccessToken?: string;
  tiktokTestEventCode?: string;
  ga4ApiSecret?: string;
}

const SECRET_KEYS = ["metaCapiAccessToken", "metaTestEventCode", "tiktokAccessToken", "tiktokTestEventCode", "ga4ApiSecret"] as const;
const AUDIT_LABEL: Record<(typeof SECRET_KEYS)[number], string> = {
  metaCapiAccessToken: "meta_capi",
  metaTestEventCode: "meta_test_event_code",
  tiktokAccessToken: "tiktok_events_api",
  tiktokTestEventCode: "tiktok_test_event_code",
  ga4ApiSecret: "ga4_measurement_protocol",
};

const optionalId = (pattern: RegExp, key: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(pattern, { error: `errors.tracking.invalid_${key}` }))
    .nullable()
    .optional();

const secretValue = (min: number, max: number, pattern?: RegExp) => {
  const base = z.string().trim().min(min).max(max);
  return (pattern ? base.regex(pattern) : base).nullable().optional();
};

export const trackingConfigSchema = z.object({
  /** The version returned by GET (0 before the first save). */
  expectedVersion: z.number().int().nonnegative(),
  gtmContainerId: optionalId(/^GTM-[A-Z0-9]{4,12}$/, "gtm"),
  ga4MeasurementId: optionalId(/^G-[A-Z0-9]{4,16}$/, "ga4"),
  googleAdsConversionId: optionalId(/^AW-\d{6,14}$/, "google_ads"),
  googleAdsPurchaseLabel: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{4,64}$/, { error: "errors.tracking.invalid_google_ads_label" })
    .nullable()
    .optional(),
  metaPixelId: optionalId(/^\d{10,20}$/, "meta_pixel"),
  tiktokPixelId: optionalId(/^[A-Z0-9]{15,30}$/, "tiktok_pixel"),
  metaCapiEnabled: z.boolean().optional(),
  tiktokEventsApiEnabled: z.boolean().optional(),
  ga4MeasurementProtocolEnabled: z.boolean().optional(),
  /** undefined keeps the stored value, null removes it. Values are write-only. */
  secrets: z
    .object({
      metaCapiAccessToken: secretValue(20, 1024),
      metaTestEventCode: secretValue(4, 32, /^[A-Za-z0-9]+$/),
      tiktokAccessToken: secretValue(20, 1024),
      tiktokTestEventCode: secretValue(4, 32, /^[A-Za-z0-9]+$/),
      ga4ApiSecret: secretValue(8, 128, /^[A-Za-z0-9_-]+$/),
    })
    .optional(),
  /** Increments the consent policy version so every visitor is asked again. */
  renewConsent: z.boolean().optional(),
});

export type TrackingConfigInput = z.infer<typeof trackingConfigSchema>;
export type TrackingConfigRow = typeof trackingConfigs.$inferSelect;

export interface TrackingDeps {
  db: Database;
  keys: KeyProvider | null;
}

const secretsContext = (storeId: string) => ({ storeId, purpose: "tracking" });

const EMPTY = {
  gtmContainerId: null,
  ga4MeasurementId: null,
  googleAdsConversionId: null,
  googleAdsPurchaseLabel: null,
  metaPixelId: null,
  tiktokPixelId: null,
  metaCapiEnabled: false,
  tiktokEventsApiEnabled: false,
  ga4MeasurementProtocolEnabled: false,
  secrets: null,
  consentPolicyVersion: "1",
  version: 0,
  updatedAt: null as Date | null,
};

export async function decryptTrackingSecrets(keys: KeyProvider | null, row: Pick<TrackingConfigRow, "storeId" | "secrets">): Promise<TrackingSecrets> {
  if (!row.secrets) return {};
  if (!keys) throw new AppError("dependency_unavailable", "errors.secrets.not_configured");
  return decryptJson<TrackingSecrets>(keys, row.secrets, secretsContext(row.storeId));
}

/** Admin view: identifiers and switches; secrets are reported only as present/absent. */
export function trackingView(row: Omit<TrackingConfigRow, "storeId" | "organizationId" | "createdAt" | "updatedByPrincipalId"> | typeof EMPTY, secrets: TrackingSecrets) {
  return {
    gtmContainerId: row.gtmContainerId,
    ga4MeasurementId: row.ga4MeasurementId,
    googleAdsConversionId: row.googleAdsConversionId,
    googleAdsPurchaseLabel: row.googleAdsPurchaseLabel,
    metaPixelId: row.metaPixelId,
    tiktokPixelId: row.tiktokPixelId,
    metaCapiEnabled: row.metaCapiEnabled,
    tiktokEventsApiEnabled: row.tiktokEventsApiEnabled,
    ga4MeasurementProtocolEnabled: row.ga4MeasurementProtocolEnabled,
    secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, Boolean(secrets[k])])) as Record<(typeof SECRET_KEYS)[number], boolean>,
    consentPolicyVersion: row.consentPolicyVersion,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export async function getTrackingConfig(deps: TrackingDeps, ctx: StoreContext) {
  assertCan(ctx, "tracking:read");
  const row = await withTenantTx(deps.db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.query.trackingConfigs.findFirst({ where: eq(trackingConfigs.storeId, ctx.storeId) }),
  );
  if (!row) return trackingView(EMPTY, {});
  return trackingView(row, await decryptTrackingSecrets(deps.keys, row));
}

function nonSecretSnapshot(row: Partial<TrackingConfigRow> | typeof EMPTY) {
  return {
    gtmContainerId: row.gtmContainerId ?? null,
    ga4MeasurementId: row.ga4MeasurementId ?? null,
    googleAdsConversionId: row.googleAdsConversionId ?? null,
    googleAdsPurchaseLabel: row.googleAdsPurchaseLabel ?? null,
    metaPixelId: row.metaPixelId ?? null,
    tiktokPixelId: row.tiktokPixelId ?? null,
    metaCapiEnabled: row.metaCapiEnabled ?? false,
    tiktokEventsApiEnabled: row.tiktokEventsApiEnabled ?? false,
    ga4MeasurementProtocolEnabled: row.ga4MeasurementProtocolEnabled ?? false,
    consentPolicyVersion: row.consentPolicyVersion ?? "1",
  };
}

/**
 * Saves the tracking configuration with optimistic concurrency. The storefront picks the
 * change up through the content version, independent of any theme publication.
 */
export async function saveTrackingConfig(deps: TrackingDeps, ctx: StoreContext, input: TrackingConfigInput) {
  assertCan(ctx, "tracking:manage");
  // AI agents never change tracking, whatever scopes they hold: a human saves it in settings.
  if (ctx.principal.kind === "agent") throw new AppError("forbidden", "errors.tracking.human_only");
  const ref = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(deps.db, ref, async (tx) => {
    const existing = await tx.query.trackingConfigs.findFirst({ where: eq(trackingConfigs.storeId, ctx.storeId) });
    const currentVersion = existing?.version ?? 0;
    if (input.expectedVersion !== currentVersion) {
      throw conflict("errors.tracking.version_conflict", { currentVersion });
    }

    const before = existing ? nonSecretSnapshot(existing) : nonSecretSnapshot(EMPTY);
    const pick = <K extends keyof typeof before>(key: K): (typeof before)[K] =>
      (input[key as keyof TrackingConfigInput] === undefined ? before[key] : input[key as keyof TrackingConfigInput]) as (typeof before)[K];
    const next = {
      gtmContainerId: pick("gtmContainerId"),
      ga4MeasurementId: pick("ga4MeasurementId"),
      googleAdsConversionId: pick("googleAdsConversionId"),
      googleAdsPurchaseLabel: pick("googleAdsPurchaseLabel"),
      metaPixelId: pick("metaPixelId"),
      tiktokPixelId: pick("tiktokPixelId"),
      metaCapiEnabled: pick("metaCapiEnabled"),
      tiktokEventsApiEnabled: pick("tiktokEventsApiEnabled"),
      ga4MeasurementProtocolEnabled: pick("ga4MeasurementProtocolEnabled"),
      consentPolicyVersion: input.renewConsent ? String(Number.parseInt(before.consentPolicyVersion, 10) + 1 || 2) : before.consentPolicyVersion,
    };

    let secrets = existing ? await decryptTrackingSecrets(deps.keys, existing) : {};
    const secretChanges: (typeof SECRET_KEYS)[number][] = [];
    if (input.secrets) {
      secrets = { ...secrets };
      for (const key of SECRET_KEYS) {
        const value = input.secrets[key];
        if (value === undefined) continue;
        if (value === null) delete secrets[key];
        else secrets[key] = value;
        secretChanges.push(key);
      }
    }

    const problems: string[] = [];
    if (next.metaCapiEnabled && (!next.metaPixelId || !secrets.metaCapiAccessToken)) problems.push("meta_capi_requires_pixel_and_token");
    if (next.tiktokEventsApiEnabled && (!next.tiktokPixelId || !secrets.tiktokAccessToken)) problems.push("tiktok_events_requires_pixel_and_token");
    if (next.ga4MeasurementProtocolEnabled && (!next.ga4MeasurementId || !secrets.ga4ApiSecret)) problems.push("ga4_mp_requires_measurement_id_and_secret");
    if (next.googleAdsPurchaseLabel && !next.googleAdsConversionId) problems.push("google_ads_label_requires_conversion_id");
    if (problems.length) throw new AppError("validation_failed", "errors.tracking.incomplete", { problems });

    let envelope = existing?.secrets ?? null;
    if (secretChanges.length) {
      const hasAny = SECRET_KEYS.some((k) => secrets[k]);
      if (hasAny && !deps.keys) throw new AppError("dependency_unavailable", "errors.secrets.not_configured");
      envelope = hasAny ? await encryptJson(deps.keys!, secrets, secretsContext(ctx.storeId)) : null;
    }

    const values = { ...next, secrets: envelope, version: currentVersion + 1, updatedByPrincipalId: ctx.principal.userId };
    const [row] = existing
      ? await tx.update(trackingConfigs).set(values).where(eq(trackingConfigs.storeId, ctx.storeId)).returning()
      : await tx.insert(trackingConfigs).values({ storeId: ctx.storeId, organizationId: ctx.organizationId, ...values }).returning();

    // Tags are rendered into cached HTML; bumping the content version refreshes every page.
    await tx.update(stores).set({ contentVersion: sql`${stores.contentVersion} + 1` }).where(eq(stores.id, ctx.storeId));
    await recordAudit(tx, {
      action: "tracking.updated",
      resourceType: "tracking_config",
      resourceId: ctx.storeId,
      before,
      // Secret values never reach the audit log; only which integrations had keys changed.
      after: { ...next, serverKeysUpdated: secretChanges.map((k) => AUDIT_LABEL[k]) },
    });
    await appendEvent(tx, { type: "tracking.updated", ...ref, aggregateType: "store", aggregateId: ctx.storeId, payload: { version: row!.version } });
    return trackingView(row!, secrets);
  });
}

export interface PublicTrackingConfig {
  gtmContainerId: string | null;
  ga4MeasurementId: string | null;
  googleAdsConversionId: string | null;
  googleAdsPurchaseLabel: string | null;
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  consentPolicyVersion: string;
}

/** Browser-safe identifiers for the storefront tracking layer (no secrets). */
export async function publicTrackingConfig(tx: DbExecutor, storeId: string): Promise<PublicTrackingConfig> {
  const row = await tx.query.trackingConfigs.findFirst({ where: eq(trackingConfigs.storeId, storeId) });
  return {
    gtmContainerId: row?.gtmContainerId ?? null,
    ga4MeasurementId: row?.ga4MeasurementId ?? null,
    googleAdsConversionId: row?.googleAdsConversionId ?? null,
    googleAdsPurchaseLabel: row?.googleAdsPurchaseLabel ?? null,
    metaPixelId: row?.metaPixelId ?? null,
    tiktokPixelId: row?.tiktokPixelId ?? null,
    consentPolicyVersion: row?.consentPolicyVersion ?? "1",
  };
}
