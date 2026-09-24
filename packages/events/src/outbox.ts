import { newId } from "@altyapi/commerce-core";
import { outboxEvents, type DbExecutor } from "@altyapi/database";
import { currentContext, newCorrelationId } from "@altyapi/observability";
import type { DomainEventMap, DomainEventType } from "./catalog";

export interface AppendEventInput<T extends DomainEventType> {
  type: T;
  organizationId: string | null;
  storeId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: DomainEventMap[T];
  /** Delay delivery (e.g. scheduled publish, reservation expiry). */
  availableAt?: Date;
  version?: number;
}

/**
 * Appends an event to the transactional outbox. Must be called with the same transaction
 * that performs the state change so the event is published if and only if it commits.
 */
export async function appendEvent<T extends DomainEventType>(tx: DbExecutor, input: AppendEventInput<T>): Promise<string> {
  const ctx = currentContext();
  const id = newId();
  await tx.insert(outboxEvents).values({
    id,
    type: input.type,
    version: input.version ?? 1,
    organizationId: input.organizationId,
    storeId: input.storeId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload as Record<string, unknown>,
    correlationId: ctx?.correlationId ?? newCorrelationId(),
    causationId: ctx?.eventId ?? ctx?.actionId ?? ctx?.requestId ?? null,
    principalType: ctx?.principalType ?? null,
    principalId: ctx?.principalId ?? null,
    availableAt: input.availableAt ?? new Date(),
  });
  return id;
}

/** Envelope placed on the queue by the outbox publisher. */
export interface EventEnvelope<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  version: number;
  organizationId: string | null;
  storeId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: DomainEventMap[T];
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
}
