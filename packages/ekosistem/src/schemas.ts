import { z } from "zod";
import { ACCOUNT_LABEL_MAX_LENGTH, EKOSISTEM_PRODUCTS, INCREMENTAL_DEFAULT_LIMIT, INCREMENTAL_MAX_LIMIT, MAX_REFS_PER_LOOKUP } from "./constants";
import { currencyCodeSchema, minorAmountSchema, wireMoneySchema } from "./money";
import { isPushEventType } from "./scopes";

/**
 * Wire schemas of the ekosistem v1 contract. Request bodies altyapi receives are validated
 * strictly; payloads consumed from peers are validated per item so one malformed record
 * does not block a whole sync page (see splitItems).
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Value unknown to the producer: accepted when missing and normalised to null (§1). */
const nul = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
/** Opaque identifier of a record in the producing system. */
export const refSchema = z.string().min(1).max(200);
/** Cursors are base64url (§5). */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/, "base64url cursor expected");
/** Opaque account id of a link resource (storeId, Tenant.id, web_stores.id). */
export const accountIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
/** Lower-case token for open vocabularies (channels, marketplaces, sources, providers). */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
export const taxRateBpsSchema = z.number().int().min(0).max(10_000);
const signedBpsSchema = z.number().int().min(-10_000_000).max(10_000_000);
const shareBpsSchema = z.number().int().min(0).max(10_000);
const countSchema = z.number().int().min(0);
const barcodeSchema = z.string().min(1).max(64);
const skuSchema = z.string().min(1).max(200);
const titleSchema = z.string().max(500);
const bodyTextSchema = z.string().max(20_000);

// C0 control characters and DEL.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Plain text: NFC, control characters removed, whitespace collapsed, trimmed. */
export function cleanPlainText(value: string): string {
  return value.normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

const plainTextSchema = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform(cleanPlainText)
    .pipe(z.string().min(1).max(max));

/** "m***@gmail.com": a masked address; a full address is rejected (§1). */
export const maskedEmailSchema = z
  .string()
  .max(254)
  .regex(/^[^\s@]*\*[^\s@]*@[^\s@]+$/, "masked e-mail expected");

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** Verified domain as a bare host name; a URL is reduced to its host. */
export const hostnameSchema = z
  .string()
  .max(2048)
  .transform((v) => {
    const t = v.trim().toLowerCase();
    if (!t.includes("://")) return t.replace(/\.$/, "");
    try {
      return new URL(t).hostname.replace(/\.$/, "");
    } catch {
      return t;
    }
  })
  .pipe(z.string().regex(HOSTNAME_RE, "host name expected"));

export const scopeNameSchema = z.string().regex(/^[a-z]+:[a-z]+$/);
export const grantsSchema = z.array(scopeNameSchema).max(20);

export const productSchema = z.enum(EKOSISTEM_PRODUCTS);

// ---------------------------------------------------------------------------
// Link lifecycle (§4)
// ---------------------------------------------------------------------------

export const linkAccountSchema = z.object({
  id: accountIdSchema,
  label: plainTextSchema(ACCOUNT_LABEL_MAX_LENGTH),
  verifiedDomain: nul(hostnameSchema),
  ownerEmailMasked: nul(maskedEmailSchema),
});
export type LinkAccount = z.infer<typeof linkAccountSchema>;

/** POST {I}/ekosistem/v1/links/claim (unsigned). */
export const claimRequestSchema = z.object({
  code: z.string().min(1).max(100),
  product: productSchema,
  /** 32 random bytes, base64url. */
  claimNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "claimNonce must be 32 bytes of base64url"),
  account: linkAccountSchema,
  grants: grantsSchema,
});
export type ClaimRequest = z.infer<typeof claimRequestSchema>;

/** 201 answer to a claim. */
export const claimResponseSchema = z.object({
  linkId: z.guid(),
  product: productSchema,
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  account: linkAccountSchema,
  grants: grantsSchema,
});
export type ClaimResponse = z.infer<typeof claimResponseSchema>;

/** POST {I}/ekosistem/v1/links/{linkId}/confirm (signed). */
export const confirmRequestSchema = z.object({
  account: linkAccountSchema,
  grants: grantsSchema,
});
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;

export const linkStatusSchema = z.enum(["pending", "awaiting_approval", "active"]);

/** GET /ekosistem/v1/links/{linkId} (signed). */
export const linkStatusResponseSchema = z.object({
  linkId: z.guid(),
  status: linkStatusSchema,
  product: productSchema,
  account: linkAccountSchema,
  grants: grantsSchema,
});
export type LinkStatusResponse = z.infer<typeof linkStatusResponseSchema>;

/** PATCH /ekosistem/v1/links/{linkId} (signed): scope change. */
export const patchLinkRequestSchema = z.object({ grants: grantsSchema });
export type PatchLinkRequest = z.infer<typeof patchLinkRequestSchema>;

/** POST /ekosistem/v1/links/{linkId}/rotate (signed, nonce). */
export const rotateResponseSchema = z.object({ secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type RotateResponse = z.infer<typeof rotateResponseSchema>;

/** POST {peer}/ekosistem/v1/events (signed, nonce): push notification (§10). */
export const pushEventSchema = z
  .object({
    id: z.guid(),
    type: z.string().regex(/^[a-z]+(?:\.[a-z_]+)+$/).max(100),
    occurredAt: isoDateTimeSchema,
    data: z.looseObject({ ref: refSchema.optional() }),
  })
  .superRefine((v, ctx) => {
    if (isPushEventType(v.type) && !v.data.ref) ctx.addIssue({ code: "custom", path: ["data", "ref"], message: "ref is required" });
  });
export type PushEvent = z.infer<typeof pushEventSchema>;

/** §6.4 envelope as received from a peer; unknown codes are tolerated. */
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string().max(64), message: z.string().max(2000).default("") }),
  requestId: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Endpoint classes (§6.3)
// ---------------------------------------------------------------------------

/** Query of incremental endpoints altyapi serves. */
export const incrementalQuerySchema = z.object({
  since: isoDateTimeSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(INCREMENTAL_MAX_LIMIT).default(INCREMENTAL_DEFAULT_LIMIT),
  refs: z
    .string()
    .max(MAX_REFS_PER_LOOKUP * 64)
    .transform((v) => [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(refSchema).max(MAX_REFS_PER_LOOKUP))
    .optional(),
});
export type IncrementalQuery = z.infer<typeof incrementalQuerySchema>;

export const tombstoneSchema = z.object({ ref: refSchema, deleted: z.literal(true), updatedAt: isoDateTimeSchema });
export type Tombstone = z.infer<typeof tombstoneSchema>;

/** Envelope of an incremental page; items are validated one by one with splitItems. */
export const incrementalPageSchema = z.object({
  items: z.array(z.unknown()).max(INCREMENTAL_MAX_LIMIT),
  nextCursor: cursorSchema.nullable(),
  asOf: isoDateTimeSchema,
});

/**
 * Envelope of a snapshot endpoint. The contract caps items at 100 (§6.3); the parser
 * tolerates more rather than dropping a whole snapshot, the 5 MB response cap bounds it.
 */
export const snapshotEnvelopeSchema = z.looseObject({
  items: z.array(z.unknown()).max(5_000),
  asOf: isoDateTimeSchema,
});

export interface SplitItems<T> {
  items: T[];
  tombstones: Tombstone[];
  /** Records that did not match the contract; logged by the caller, never stored. */
  invalid: Array<{ index: number; ref: string | null; issues: string[] }>;
}

/** Validates page items one by one, separating tombstones and malformed records. */
export function splitItems<T extends z.ZodType>(schema: T, raw: unknown[], opts: { tombstones?: boolean } = {}): SplitItems<z.output<T>> {
  const out: SplitItems<z.output<T>> = { items: [], tombstones: [], invalid: [] };
  raw.forEach((value, index) => {
    if (opts.tombstones !== false && value && typeof value === "object" && (value as { deleted?: unknown }).deleted === true) {
      const t = tombstoneSchema.safeParse(value);
      if (t.success) {
        out.tombstones.push(t.data);
        return;
      }
    }
    const r = schema.safeParse(value);
    if (r.success) out.items.push(r.data);
    else {
      const ref = value && typeof value === "object" && typeof (value as { ref?: unknown }).ref === "string" ? ((value as { ref: string }).ref.slice(0, 200)) : null;
      out.invalid.push({ index, ref, issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Money and cost (§6.1)
// ---------------------------------------------------------------------------

export const costSourceSchema = z.enum(["manual", "import", "integration", "karmatik", "store"]);

/** Cost object: `taxIncluded: null` means unknown (consumer assumes net, marks estimated). */
export const costObjectSchema = z.object({
  amount: minorAmountSchema,
  currency: currencyCodeSchema,
  taxIncluded: nul(z.boolean()),
  taxRateBps: nul(taxRateBpsSchema),
  source: costSourceSchema,
  effectiveFrom: nul(isoDateTimeSchema),
});
export type CostObject = z.infer<typeof costObjectSchema>;

// ---------------------------------------------------------------------------
// Kârmatik (§8)
// ---------------------------------------------------------------------------

/** Known channels are web, trendyol, hepsiburada and n11; new marketplaces pass as tokens. */
export const karmatikChannelSchema = tokenSchema;

/** §8.1 GET /ekosistem/v1/catalog/products — products:read (incremental). */
export const karmatikProductSchema = z.object({
  ref: refSchema,
  sourceRef: nul(refSchema),
  barcode: nul(barcodeSchema),
  sku: nul(skuSchema),
  title: nul(titleSchema),
  brand: nul(z.string().max(200)),
  category: nul(z.string().max(500)),
  listingUrls: z.array(httpUrlSchema).max(50).default([]),
  updatedAt: isoDateTimeSchema,
});
export type KarmatikProduct = z.infer<typeof karmatikProductSchema>;

/** §8.2 GET /ekosistem/v1/profit/variants — profit:read (incremental snapshot). */
export const karmatikProfitVariantSchema = z.object({
  ref: refSchema,
  sourceRef: nul(refSchema),
  channel: karmatikChannelSchema,
  storeLabel: nul(z.string().max(200)),
  barcode: nul(barcodeSchema),
  sku: nul(skuSchema),
  price: wireMoneySchema,
  unitCost: nul(costObjectSchema),
  netProfit: nul(wireMoneySchema),
  marginBps: nul(signedBpsSchema),
  floorPrice: nul(wireMoneySchema),
  floorBasis: nul(z.enum(["landed_cost_markup", "net_margin"])),
  minMarginBps: nul(signedBpsSchema),
  safeDiscountBps: nul(shareBpsSchema),
  breakEvenPrice: nul(wireMoneySchema),
  lossMaking: nul(z.boolean()),
  basis: z.enum(["estimated", "realized"]),
  missing: z.array(z.string().max(40)).max(20).default([]),
  updatedAt: isoDateTimeSchema,
});
export type KarmatikProfitVariant = z.infer<typeof karmatikProfitVariantSchema>;

/** §8.2 with profit:summary only. */
export const karmatikProfitSummarySchema = z.object({
  ref: refSchema,
  sourceRef: nul(refSchema),
  barcode: nul(barcodeSchema),
  marginBps: nul(signedBpsSchema),
  lossMaking: nul(z.boolean()),
  updatedAt: isoDateTimeSchema,
});
export type KarmatikProfitSummary = z.infer<typeof karmatikProfitSummarySchema>;

export const suggestionReasonSchema = z.enum(["competitor_undercut", "target_margin", "fx_change", "loss_fix", "other"]).catch("other");
export const suggestionStatusSchema = z.enum(["open", "applied", "dismissed"]);

/** §8.3 GET /ekosistem/v1/pricing/suggestions — pricing:read (incremental). */
export const karmatikSuggestionSchema = z.object({
  ref: refSchema,
  sourceRef: nul(refSchema),
  channel: karmatikChannelSchema,
  barcode: nul(barcodeSchema),
  currentPrice: wireMoneySchema,
  suggestedPrice: wireMoneySchema,
  reason: suggestionReasonSchema,
  competitorMinPrice: nul(wireMoneySchema),
  confidence: nul(z.number().min(0).max(1)),
  status: suggestionStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type KarmatikSuggestion = z.infer<typeof karmatikSuggestionSchema>;

/** §8.3 POST /ekosistem/v1/pricing/suggestions/{ref}/decision — pricing:decide. */
export const suggestionDecisionSchema = z
  .object({
    id: z.guid(),
    status: z.enum(["applied", "dismissed"]),
    appliedPrice: wireMoneySchema.nullable(),
  })
  .refine((v) => v.status === "applied" || v.appliedPrice === null, { path: ["appliedPrice"], message: "appliedPrice must be null when dismissed" });
export type SuggestionDecision = z.infer<typeof suggestionDecisionSchema>;

/** §8.4 GET /ekosistem/v1/competitors/prices — competitors:read (incremental, current state). */
export const karmatikCompetitorPriceSchema = z.object({
  ref: refSchema,
  sourceRef: nul(refSchema),
  barcode: nul(barcodeSchema),
  source: tokenSchema,
  seller: nul(z.string().max(200)),
  price: wireMoneySchema,
  url: nul(httpUrlSchema),
  inStock: nul(z.boolean()),
  observedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type KarmatikCompetitorPrice = z.infer<typeof karmatikCompetitorPriceSchema>;

export const alertTypeSchema = z
  .enum(["loss_making", "thin_margin", "missing_cost", "buybox_lost", "competitor_price_drop", "high_return", "other"])
  .catch("other");
export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

/** §8.5 GET /ekosistem/v1/alerts — profit:read (incremental). */
export const karmatikAlertSchema = z.object({
  ref: refSchema,
  channel: karmatikChannelSchema,
  storeLabel: nul(z.string().max(200)),
  type: alertTypeSchema,
  severity: alertSeveritySchema,
  barcode: nul(barcodeSchema),
  sourceRef: nul(refSchema),
  title: titleSchema,
  body: bodyTextSchema,
  impactMonthly: nul(wireMoneySchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  resolvedAt: nul(isoDateTimeSchema),
});
export type KarmatikAlert = z.infer<typeof karmatikAlertSchema>;

/** §8.6 GET /ekosistem/v1/market/brands — competitors:read (snapshot). */
export const karmatikMarketBrandSchema = z.object({
  ref: refSchema,
  name: z.string().min(1).max(200),
  website: nul(httpUrlSchema),
  marketplace: tokenSchema,
  aliases: z.array(z.string().max(200)).max(50).default([]),
});
export type KarmatikMarketBrand = z.infer<typeof karmatikMarketBrandSchema>;

/** §8.6 GET /ekosistem/v1/market/keywords — market:read (snapshot). */
export const karmatikMarketKeywordSchema = z.object({
  keyword: z.string().min(1).max(200),
  marketplace: tokenSchema,
  category: nul(z.string().max(500)),
  demandIndex: nul(z.number().int().min(0).max(100)),
  avgCpc: nul(wireMoneySchema),
  observedAt: isoDateTimeSchema,
});
export type KarmatikMarketKeyword = z.infer<typeof karmatikMarketKeywordSchema>;

export const paymentMethodSchema = z.enum(["card", "transfer", "cod"]);

/** §8.7 POST /ekosistem/v1/profit/quote — profit:quote. Request altyapi sends. */
export const profitQuoteRequestSchema = z.object({
  currency: currencyCodeSchema,
  channel: tokenSchema,
  lines: z
    .array(
      z.object({
        sourceRef: nul(refSchema),
        barcode: nul(barcodeSchema),
        sku: nul(skuSchema),
        quantity: z.number().int().min(1).max(1_000_000),
        unitPrice: minorAmountSchema,
        /** Line total discount (§8.7). */
        discount: minorAmountSchema,
        taxRateBps: nul(taxRateBpsSchema),
        taxIncluded: z.boolean(),
        unitCost: nul(costObjectSchema),
      }),
    )
    .min(1)
    .max(250),
  shipping: z.object({ charged: minorAmountSchema, cost: nul(minorAmountSchema) }),
  payment: z.object({ provider: tokenSchema, method: paymentMethodSchema, installments: z.number().int().min(1).max(36) }),
});
export type ProfitQuoteRequest = z.input<typeof profitQuoteRequestSchema>;

const quoteBasisSchema = z.enum(["estimated", "exact"]);

/** §8.7 answer. */
export const profitQuoteResponseSchema = z.object({
  lines: z
    .array(
      z.object({
        sourceRef: nul(refSchema),
        barcode: nul(barcodeSchema),
        netProfit: nul(minorAmountSchema),
        marginBps: nul(signedBpsSchema),
        floorPrice: nul(wireMoneySchema),
        belowMinimum: nul(z.boolean()),
        basis: quoteBasisSchema,
        missing: z.array(z.string().max(40)).max(20).default([]),
      }),
    )
    .max(250),
  total: z.object({
    netProfit: nul(minorAmountSchema),
    marginBps: nul(signedBpsSchema),
    basis: quoteBasisSchema,
    missing: z.array(z.string().max(40)).max(20).default([]),
  }),
  asOf: isoDateTimeSchema,
});
export type ProfitQuoteResponse = z.infer<typeof profitQuoteResponseSchema>;

// ---------------------------------------------------------------------------
// Yanıt (§9)
// ---------------------------------------------------------------------------

/** OPENAI, ANTHROPIC, GOOGLE, PERPLEXITY; new providers pass as tokens. */
const aiProviderSchema = z.string().regex(/^[A-Z0-9_]{1,32}$/);
export const windowDaysSchema = z.union([z.literal(7), z.literal(30)]);

/** §9.1 GET /ekosistem/v1/visibility/summary?windowDays=7|30 — visibility:read (snapshot). */
export const yanitVisibilitySummarySchema = z.object({
  windowDays: windowDaysSchema,
  validRuns: countSchema,
  runsWithBrand: countSchema,
  visibilityBps: nul(shareBpsSchema),
  shareOfVoiceBps: nul(shareBpsSchema),
  trend: z.object({ previousBps: nul(shareBpsSchema), deltaBps: nul(signedBpsSchema) }).default({ previousBps: null, deltaBps: null }),
  byProvider: z.array(z.object({ provider: aiProviderSchema, validRuns: countSchema, visibilityBps: nul(shareBpsSchema) })).max(50).default([]),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(200), runsMentioned: countSchema, visibilityBps: nul(shareBpsSchema), shareOfVoiceBps: nul(shareBpsSchema) }))
    .max(200)
    .default([]),
  lastMeasuredAt: nul(isoDateTimeSchema),
  asOf: isoDateTimeSchema,
});
export type YanitVisibilitySummary = z.infer<typeof yanitVisibilitySummarySchema>;

export const gapIntentSchema = z.enum(["discovery", "comparison", "review", "how_to"]);

/** §9.2 GET /ekosistem/v1/visibility/gaps — opportunities:read (snapshot, ≤ 100). */
export const yanitGapSchema = z.object({
  ref: refSchema,
  query: z.string().min(1).max(1000),
  providers: z.array(aiProviderSchema).max(20).default([]),
  competitorsMentioned: z.array(z.string().max(200)).max(100).default([]),
  priority: z.number().int().min(0).max(100),
  /** Categories outside the contract set are reported as null by the producer; tolerated here too. */
  intent: gapIntentSchema.nullable().catch(null),
  lastRunAt: nul(isoDateTimeSchema),
});
export type YanitGap = z.infer<typeof yanitGapSchema>;

export const opportunityKindSchema = z.enum(["faq", "comparison_page", "structured_data", "product_content", "other"]).catch("other");

/** §9.3 GET /ekosistem/v1/opportunities — opportunities:read (incremental). */
export const yanitOpportunitySchema = z.object({
  ref: refSchema,
  kind: opportunityKindSchema,
  sourceKind: nul(z.string().max(64)),
  title: titleSchema,
  body: bodyTextSchema,
  query: nul(z.string().max(1000)),
  targetUrl: nul(httpUrlSchema),
  impact: z.enum(["high", "medium", "low"]),
  status: z.enum(["open", "done", "dismissed"]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type YanitOpportunity = z.infer<typeof yanitOpportunitySchema>;

/** §9.4 GET /ekosistem/v1/citations?windowDays=30 — citations:read (snapshot, ≤ 100). */
export const yanitCitationSchema = z.object({
  domain: hostnameSchema,
  count: countSchema,
  shareBps: nul(shareBpsSchema),
  sampleUrls: z.array(httpUrlSchema).max(3).default([]),
});
export type YanitCitation = z.infer<typeof yanitCitationSchema>;

/** §9.5 GET /ekosistem/v1/discovery/products?windowDays=30 — discovery:read (snapshot). */
export const yanitDiscoveryProductSchema = z.object({
  entityType: z.literal("product"),
  entityId: refSchema,
  aiSessions: countSchema,
  productViews: countSchema,
  byProvider: z.array(z.object({ provider: aiProviderSchema, sessions: countSchema })).max(50).default([]),
});
export type YanitDiscoveryProduct = z.infer<typeof yanitDiscoveryProductSchema>;
