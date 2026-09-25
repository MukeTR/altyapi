/**
 * Response shapes of the ecosystem bridge endpoints (/v1/…/ekosistem/*): links to Kârmatik and
 * Yanıt, the brand profile, bridge settings and the read models altyapi pulled from each peer.
 * The API adds fields without a version bump, so these types are not exhaustive.
 */

export const PEERS = ["karmatik", "yanit"] as const;
export type Peer = (typeof PEERS)[number];

export function isPeer(value: string): value is Peer {
  return (PEERS as readonly string[]).includes(value);
}

export type LinkStatus = "pending" | "awaiting_approval" | "active" | "revoked" | "expired";

/** Identity of the peer account behind a link, verified by the peer during the handshake. */
export interface LinkAccount {
  id: string;
  label: string;
  verifiedDomain?: string | null;
  ownerEmailMasked?: string | null;
}

export interface AdminLink {
  id: string;
  peerProduct: Peer;
  /** issuer: this store issued the code; acceptor: this store entered the peer's code. */
  role: "issuer" | "acceptor";
  status: LinkStatus | (string & {});
  peerAccount: LinkAccount | null;
  /** What the peer may read from this store. */
  grantedScopes: string[];
  /** What this store may read from the peer. */
  peerScopes: string[];
  pendingExpiresAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  revokeDelivery: { attempts: number; deliveredAt: string | null; lastError: string | null; giveUpAt: string | null } | null;
  rotatedAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PeerConfig {
  /** The platform has the peer's address and key; accepting its codes works only then. */
  configured: boolean;
  /** Scopes pre-ticked when this store grants the peer access. */
  defaultGrants: string[];
  /** Scopes offered unticked that need an explicit tick (costs:read, orders:read). */
  explicitConsentGrants: string[];
  /** What the peer grants this store by default. */
  peerDefaultGrants: string[];
}

export interface LinksResponse {
  items: AdminLink[];
  peers: Partial<Record<Peer, PeerConfig>>;
}

export interface IssuedCode {
  code: string;
  peerProduct: Peer;
  grants: string[];
  explicitConsent: string[];
  expiresAt: string;
}

export interface AcceptedCode {
  link: AdminLink;
  peer: { product: Peer; account: LinkAccount };
  grants: { toPeer: string[]; fromPeer: string[] };
  explicitConsent: string[];
}

/** Scopes that are never granted implicitly (docs/ekosistem/v1.md §3). */
export const EXPLICIT_CONSENT_SCOPES = ["costs:read", "orders:read", "profit:read"] as const;

export function isExplicitConsentScope(scope: string): boolean {
  return (EXPLICIT_CONSENT_SCOPES as readonly string[]).includes(scope);
}

export interface Freshness {
  resource: string;
  endpoint: string;
  allowed: boolean;
  pulledAt: string | null;
  asOf: string | null;
  nextDueAt: string | null;
  error: string | null;
  errorAt: string | null;
}

/** "open" while the peer failed repeatedly and calls are paused; null without an active link. */
export type CircuitState = "open" | "closed" | null;

interface PeerStatusBlock {
  linked: boolean;
  link: AdminLink | null;
  configured: boolean;
  circuit: CircuitState;
  freshness: Freshness[];
  nextPullAt: string | null;
}

/** Money on the ecosystem wire: minor units as a string plus the currency. */
export interface WireMoney {
  amount: string;
  currency: string;
}

export interface LocalVariant {
  variantId: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  productTitle: string | null;
  archived: boolean;
  price: WireMoney | null;
}

export type ProfitGuardPolicy = "block" | "warn" | "ignore";
export const PROFIT_GUARD_POLICIES: readonly ProfitGuardPolicy[] = ["block", "warn", "ignore"];

export interface ProfitRow {
  ref: string;
  channel: string;
  storeLabel: string | null;
  sourceRef: string | null;
  barcode: string | null;
  sku: string | null;
  summaryOnly: boolean;
  price: WireMoney | null;
  netProfit: WireMoney | null;
  marginBps: number | null;
  floorPrice: WireMoney | null;
  floorBasis: string | null;
  minMarginBps: number | null;
  safeDiscountBps: number | null;
  breakEvenPrice: WireMoney | null;
  lossMaking: boolean | null;
  basis: string | null;
  missing: string[];
  updatedAt: string | null;
  variant: LocalVariant | null;
}

export interface SuggestionDecision {
  decidedAt: string | null;
  appliedPrice: WireMoney | null;
  delivery: "pending" | "delivered" | "failed" | "not_sent" | (string & {});
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
}

export interface Suggestion {
  ref: string;
  channel: string;
  sourceRef: string | null;
  barcode: string | null;
  currentPrice: WireMoney | null;
  suggestedPrice: WireMoney | null;
  reason: string | null;
  competitorMinPrice: WireMoney | null;
  confidenceBps: number | null;
  peerStatus: string;
  status: "new" | "applied" | "dismissed" | (string & {});
  actionable: boolean;
  decision: SuggestionDecision | null;
  createdAt: string | null;
  updatedAt: string | null;
  variant: LocalVariant | null;
}

export interface KarmatikAlert {
  ref: string;
  channel: string | null;
  storeLabel: string | null;
  type: string;
  severity: "info" | "warning" | "critical" | (string & {});
  barcode: string | null;
  sourceRef: string | null;
  title: string;
  body: string | null;
  impactMonthly: WireMoney | null;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  variant: LocalVariant | null;
}

export interface CompetitorOffer {
  ref: string;
  sourceRef: string | null;
  barcode: string | null;
  source: string;
  seller: string | null;
  price: WireMoney | null;
  url: string | null;
  inStock: boolean | null;
  observedAt: string | null;
  updatedAt: string | null;
  variant: LocalVariant | null;
  /** Competitor price minus our storefront price; negative means they are cheaper. */
  difference: WireMoney | null;
}

export interface KarmatikOverview extends PeerStatusBlock {
  profitGuard: ProfitGuardPolicy;
  profit: {
    total: number;
    matched: number;
    lossMaking: number;
    thinMargin: number;
    missingCost: number;
    estimated: number;
    newest: string | null;
    byChannel: { channel: string; total: number; lossMaking: number }[];
    lossMakingVariants: ProfitRow[];
    thinMarginVariants: ProfitRow[];
  } | null;
  suggestions: { open: number; actionable: number; applied: number; dismissed: number; undelivered: number } | null;
  alerts: { open: number; bySeverity: Record<string, number>; latest: KarmatikAlert[] } | null;
  competitors: { offers: number; variantsTracked: number; newest: string | null } | null;
}

export interface WriteOutcome {
  mode: "altyapi" | "owner" | "advice" | (string & {});
  owner?: { connectionId?: string; name: string; provider: string | null };
  /** Turkish advice from the API when the price owner is outside altyapi. */
  message?: string;
  results: { sku: string | null; ok: boolean; message?: string | null }[];
}

export interface ProfitCheckLine {
  variantId: string;
  sku: string | null;
  barcode: string | null;
  productTitle: string | null;
  quantity: number;
  currentPrice: WireMoney | null;
  proposedPrice: WireMoney | null;
  discountBps: number | null;
  floorPrice: WireMoney | null;
  safeDiscountBps: number | null;
  marginBps: number | null;
  netProfit: WireMoney | null;
  belowMinimum: boolean | null;
  source: "cached" | "quote" | "none";
  basis: string | null;
  missing: string[];
  status: "ok" | "below_minimum" | "unavailable" | "unknown";
}

export interface ProfitCheckResult {
  decision: "allow" | "warn" | "block";
  policy: ProfitGuardPolicy;
  linked: boolean;
  unavailable: boolean;
  requiresConfirmation: boolean;
  overridden: boolean;
  canOverride: boolean;
  lines: ProfitCheckLine[];
  quote: { total: unknown; asOf: string } | null;
  checkedAt: string;
}

export interface ApplySuggestionResult {
  applied: boolean;
  write: WriteOutcome;
  suggestion: Suggestion;
  profitGuard: ProfitCheckResult | null;
}

export interface VisibilityView {
  windowDays: number;
  validRuns: number | null;
  runsWithBrand: number | null;
  visibilityBps: number | null;
  shareOfVoiceBps: number | null;
  trend: { previousBps: number | null; deltaBps: number | null };
  byProvider: unknown[];
  competitors: unknown[];
  lastMeasuredAt: string | null;
  asOf: string | null;
}

export interface VisibilityWindow {
  windowDays: number;
  latest: VisibilityView | null;
  previous: { visibilityBps: number | null; shareOfVoiceBps: number | null; asOf: string } | null;
  deltaBps: number | null;
}

export interface YanitGap {
  ref: string;
  query: string;
  providers: string[];
  competitorsMentioned: string[];
  priority: number | null;
  intent: "discovery" | "comparison" | "review" | "how_to" | (string & {}) | null;
  lastRunAt: string | null;
  asOf: string | null;
}

export interface YanitOpportunity {
  ref: string;
  kind: "faq" | "comparison_page" | "structured_data" | "product_content" | "other" | (string & {});
  sourceKind: string | null;
  title: string;
  body: string;
  query: string | null;
  targetUrl: string | null;
  impact: "high" | "medium" | "low" | (string & {});
  peerStatus: string;
  status: "new" | "drafted" | "dismissed" | (string & {});
  draftPageId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface YanitCitation {
  domain: string;
  count: number;
  shareBps: number | null;
  sampleUrls: string[];
  windowDays: number;
  asOf: string | null;
}

export interface YanitOverview extends PeerStatusBlock {
  visibility: VisibilityWindow[] | null;
  gaps: { total: number; top: YanitGap[] } | null;
  opportunities: { open: number; drafted: number; dismissed: number; total: number; openByKind: Record<string, number>; top: YanitOpportunity[] } | null;
  citations: { windowDays: number; domains: number; top: YanitCitation[] } | null;
}

export interface DraftResult {
  created: boolean;
  page: { id: string; type: string; handle: string; title: Record<string, string>; status: string; draftRevision: number; createdAt: string };
  opportunity: YanitOpportunity;
}

export interface BrandCompetitor {
  name: string;
  website: string | null;
  aliases: string[];
}

export interface BrandProfile {
  storeId: string;
  description: string | null;
  topics: string[];
  competitors: BrandCompetitor[];
  socialProfiles: string[];
  updatedAt: string | null;
}

export interface EkosistemSettings {
  profitGuard: ProfitGuardPolicy;
}
