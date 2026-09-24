import { newId } from "@altyapi/commerce-core";
import { auditLog, type DbExecutor } from "@altyapi/database";
import { currentContext, newCorrelationId } from "@altyapi/observability";

const SENSITIVE_KEY = /pass(word)?|secret|token|api[_-]?key|merchant[_-]?(key|salt)|credential|card|cvv|cvc|iban|authorization|cookie/i;

/** Deep-redacts sensitive keys so audit snapshots never contain secrets or card data. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  organizationId?: string | null;
  storeId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  onBehalfOfUserId?: string | null;
}

/**
 * Records an audit entry using the active operation context for principal, agent,
 * session and correlation identifiers. Call inside the business transaction.
 */
export async function recordAudit(tx: DbExecutor, entry: AuditEntry): Promise<void> {
  const ctx = currentContext();
  const hasChanges = entry.before !== undefined || entry.after !== undefined;
  await tx.insert(auditLog).values({
    id: newId(),
    organizationId: entry.organizationId ?? ctx?.organizationId ?? null,
    storeId: entry.storeId ?? ctx?.storeId ?? null,
    principalType: ctx?.principalType ?? "system",
    principalId: ctx?.principalId && isUuid(ctx.principalId) ? ctx.principalId : null,
    onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
    agentId: ctx?.agentId ?? null,
    sessionId: ctx?.sessionId ?? null,
    correlationId: ctx?.correlationId ?? newCorrelationId(),
    requestId: ctx?.requestId ?? null,
    actionId: ctx?.actionId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    changes: hasChanges ? { before: redact(entry.before), after: redact(entry.after) } : null,
    metadata: (redact(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
    ip: entry.ip ?? null,
  });
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
