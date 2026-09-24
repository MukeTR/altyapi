import type { PeerProduct } from "../../constants";
import { hasAnyScope, type EkosistemScope } from "../../scopes";
import type { LinkRow } from "../common";
import type { ReadModelName } from "./read-models";

/**
 * What altyapi pulls from its peers (§7.5): Kârmatik §8.2–§8.5 and Yanıt §9.1–§9.4. Each
 * resource is pulled only while the peer granted one of its scopes; its pull state lives in
 * link.cursors under the endpoint path.
 */

export const PULL_RESOURCES = ["profit", "suggestions", "competitors", "alerts", "visibility", "gaps", "opportunities", "citations"] as const;
export type PullResource = (typeof PULL_RESOURCES)[number];

export interface ResourceDef {
  peer: PeerProduct;
  /** Endpoint below /ekosistem/v1; also the key of the pull state in link.cursors. */
  key: string;
  /** Incremental endpoints page with since/cursor; snapshot endpoints replace the stored set. */
  kind: "incremental" | "snapshot";
  /** Any one of these scopes allows the pull. */
  scopes: readonly EkosistemScope[];
  readModel: ReadModelName;
}

export const RESOURCE_DEFS: Record<PullResource, ResourceDef> = {
  profit: { peer: "karmatik", key: "profit/variants", kind: "incremental", scopes: ["profit:read", "profit:summary"], readModel: "profit" },
  suggestions: { peer: "karmatik", key: "pricing/suggestions", kind: "incremental", scopes: ["pricing:read"], readModel: "suggestions" },
  competitors: { peer: "karmatik", key: "competitors/prices", kind: "incremental", scopes: ["competitors:read"], readModel: "competitors" },
  alerts: { peer: "karmatik", key: "alerts", kind: "incremental", scopes: ["profit:read"], readModel: "alerts" },
  visibility: { peer: "yanit", key: "visibility/summary", kind: "snapshot", scopes: ["visibility:read"], readModel: "visibility" },
  gaps: { peer: "yanit", key: "visibility/gaps", kind: "snapshot", scopes: ["opportunities:read"], readModel: "gaps" },
  opportunities: { peer: "yanit", key: "opportunities", kind: "incremental", scopes: ["opportunities:read"], readModel: "opportunities" },
  citations: { peer: "yanit", key: "citations", kind: "snapshot", scopes: ["citations:read"], readModel: "citations" },
};

export function isPullResource(value: unknown): value is PullResource {
  return typeof value === "string" && (PULL_RESOURCES as readonly string[]).includes(value);
}

export function resourcesOf(peer: PeerProduct): PullResource[] {
  return PULL_RESOURCES.filter((r) => RESOURCE_DEFS[r].peer === peer);
}

export function resourceAllowed(link: Pick<LinkRow, "peerProduct" | "peerScopes">, resource: PullResource): boolean {
  const def = RESOURCE_DEFS[resource];
  return def.peer === link.peerProduct && hasAnyScope(link.peerScopes, ...def.scopes);
}

/** Per-resource pull state kept in link.cursors[def.key]. */
export interface ResourceState {
  /** Next `since` of an incremental resource (previous asOf − 10 min); null = full set. */
  since: string | null;
  /** Set while a pass stopped at the page cap; the next run resumes here with the same since. */
  cursor: string | null;
  /** When the last complete pass finished. */
  pulledAt: string | null;
  /** asOf of the last complete pass, as the peer reported it. */
  asOf: string | null;
  /** Cache-Control max-age the peer sent (Yanıt: 3600); pulls are never more frequent. */
  maxAgeSeconds: number | null;
  /** After a failure: not before this instant. */
  retryAt: string | null;
  /** Last failure code (cleared by a successful pass). */
  error: string | null;
  errorAt: string | null;
  /** profit only: "full" (profit:read) or "summary" (profit:summary). A change restarts the resource. */
  mode: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function readResourceState(link: Pick<LinkRow, "cursors">, resource: PullResource): ResourceState {
  const raw = (link.cursors[RESOURCE_DEFS[resource].key] ?? {}) as Record<string, unknown>;
  return {
    since: str(raw.since),
    cursor: str(raw.cursor),
    pulledAt: str(raw.pulledAt),
    asOf: str(raw.asOf),
    maxAgeSeconds: typeof raw.maxAgeSeconds === "number" ? raw.maxAgeSeconds : null,
    retryAt: str(raw.retryAt),
    error: str(raw.error),
    errorAt: str(raw.errorAt),
    mode: str(raw.mode),
  };
}
