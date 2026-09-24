import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type PrincipalType = "user" | "agent" | "customer" | "system" | "api_client";

/**
 * Correlation data carried by every request, job and event. Fields are optional because
 * a request starts anonymous and gains a principal/store once authenticated and resolved.
 */
export interface OperationContext {
  correlationId: string;
  requestId?: string;
  eventId?: string;
  actionId?: string;
  organizationId?: string;
  storeId?: string;
  principalType?: PrincipalType;
  principalId?: string;
  agentId?: string;
  sessionId?: string;
}

const storage = new AsyncLocalStorage<OperationContext>();

export function runWithContext<T>(ctx: OperationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): OperationContext | undefined {
  return storage.getStore();
}

/** Mutates the active context in place so later log lines in the same async chain carry the new fields. */
export function enrichContext(patch: Partial<OperationContext>): void {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, patch);
}

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Binds a context to the current async execution for the rest of its lifetime. Used by
 * HTTP frameworks whose hook model does not allow wrapping the handler in runWithContext.
 */
export function enterContext(ctx: OperationContext): void {
  storage.enterWith(ctx);
}
