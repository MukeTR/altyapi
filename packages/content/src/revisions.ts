import { AppError, conflict, newId, notFound } from "@altyapi/commerce-core";
import { and, desc, draftRevisions, eq, sql, type Transaction } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import type { Permission } from "@altyapi/auth";
import { currentContext } from "@altyapi/observability";

/**
 * Draft history shared by every editable resource (themes, pages, menus, content entries):
 * each saved draft state is a draft_revisions row; revisions form a tree (parent pointer), so
 * undo moves the draft to the parent revision, redo to the newest child and restore copies any
 * revision into a new one. Only drafts move; the live site changes on publish.
 */

export type RevisionResource = "theme" | "page" | "navigation" | "entry";
/** "yanit": a draft created from a Yanıt content opportunity (ekosistem bridge), never published automatically. */
export type RevisionSource = "editor" | "ai_action" | "restore" | "bootstrap" | "import" | "navigation_change" | "yanit" | "duplicate" | "content_type_install" | "module_enable";

export type RevisionScope = { organizationId: string; storeId: string };

export interface RevisionMeta {
  source?: RevisionSource;
  label?: string | null;
}

/** Current draft of a resource: its revision number and snapshot. */
export interface DraftState {
  revision: number;
  snapshot: Record<string, unknown>;
}

/**
 * Who moves a draft (undo, redo, restore). Adapters use it for side effects that depend on
 * the actor's rights: a publisher moving the draft of a scheduled entry re-approves it.
 */
export interface DraftActor {
  principalId: string | null;
  can(permission: Permission): boolean;
}

/** How the history reaches one resource type's draft. */
export interface DraftAdapter {
  type: RevisionResource;
  readPermission: Permission;
  writePermission: Permission;
  /** Loads (and locks) the draft; null when the resource does not exist in this store. */
  load(tx: Transaction, storeId: string, id: string): Promise<DraftState | null>;
  /** Writes a snapshot back into the draft and moves the draft pointer to `revision`. */
  apply(tx: Transaction, scope: RevisionScope, id: string, snapshot: Record<string, unknown>, revision: number, actor: DraftActor): Promise<void>;
}

/** Next revision number: always greater than any existing one (branches never reuse numbers). */
export async function nextRevisionNumber(tx: Transaction, type: RevisionResource, id: string, current: number): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${draftRevisions.revision}), 0)` })
    .from(draftRevisions)
    .where(and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id)));
  return Math.max(Number(row?.max ?? 0), current) + 1;
}

export async function recordRevision(
  tx: Transaction,
  scope: RevisionScope,
  input: { type: RevisionResource; id: string; revision: number; parent: number | null; snapshot: Record<string, unknown>; meta?: RevisionMeta },
): Promise<void> {
  const ctx = currentContext();
  const principalId = ctx?.principalId && /^[0-9a-f-]{36}$/.test(ctx.principalId) ? ctx.principalId : null;
  await tx
    .insert(draftRevisions)
    .values({
      id: newId(),
      ...scope,
      resourceType: input.type,
      resourceId: input.id,
      revision: input.revision,
      parentRevision: input.parent,
      snapshot: input.snapshot,
      source: input.meta?.source ?? (ctx?.agentId ? "ai_action" : "editor"),
      label: input.meta?.label ?? null,
      principalType: ctx?.principalType ?? "system",
      principalId,
      agentId: ctx?.agentId ?? null,
    })
    .onConflictDoNothing();
}

/** Makes sure the state before the first tracked edit is itself a revision (so it can be restored). */
export async function ensureBaseline(tx: Transaction, scope: RevisionScope, type: RevisionResource, id: string, currentRevision: number, snapshot: Record<string, unknown>) {
  const exists = await tx.query.draftRevisions.findFirst({
    where: and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id), eq(draftRevisions.revision, currentRevision)),
  });
  if (!exists) await recordRevision(tx, scope, { type, id, revision: currentRevision, parent: null, snapshot, meta: { source: "bootstrap", label: "baseline" } });
}

/** Revision list of a resource, newest first, with undo/redo availability. */
export async function listRevisionsTx(tx: Transaction, storeId: string, adapter: DraftAdapter, id: string, limit = 100) {
  const current = await adapter.load(tx, storeId, id);
  if (!current) throw notFound(adapter.type, id);
  const rows = await tx
    .select({
      revision: draftRevisions.revision,
      parentRevision: draftRevisions.parentRevision,
      source: draftRevisions.source,
      label: draftRevisions.label,
      principalType: draftRevisions.principalType,
      principalId: draftRevisions.principalId,
      agentId: draftRevisions.agentId,
      createdAt: draftRevisions.createdAt,
    })
    .from(draftRevisions)
    .where(and(eq(draftRevisions.resourceType, adapter.type), eq(draftRevisions.resourceId, id), eq(draftRevisions.storeId, storeId)))
    .orderBy(desc(draftRevisions.revision))
    .limit(limit);
  const currentRow = rows.find((r) => r.revision === current.revision);
  const redoTarget = rows.filter((r) => r.parentRevision === current.revision).sort((a, b) => b.revision - a.revision)[0];
  return {
    currentRevision: current.revision,
    canUndo: Boolean(currentRow?.parentRevision),
    canRedo: Boolean(redoTarget),
    items: rows.map((r) => ({ ...r, isCurrent: r.revision === current.revision })),
  };
}

export async function getRevisionTx(tx: Transaction, storeId: string, type: RevisionResource, id: string, revision: number) {
  const row = await tx.query.draftRevisions.findFirst({
    where: and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id), eq(draftRevisions.revision, revision), eq(draftRevisions.storeId, storeId)),
  });
  if (!row) throw notFound("revision", String(revision));
  return row;
}

export type DraftMove = { kind: "undo" } | { kind: "redo" } | { kind: "restore"; revision: number };

/**
 * Undo / redo / restore on a draft. Undo moves to the parent revision, redo to the newest
 * child of the current revision, restore copies any revision into a new one.
 */
export async function moveDraftTx(tx: Transaction, scope: RevisionScope, adapter: DraftAdapter, id: string, op: DraftMove, expectedRevision: number, actor: DraftActor) {
  const type = adapter.type;
  const current = await adapter.load(tx, scope.storeId, id);
  if (!current) throw notFound(type, id);
  if (current.revision !== expectedRevision) throw conflict("errors.content.revision_conflict", { currentRevision: current.revision });
  await ensureBaseline(tx, scope, type, id, current.revision, current.snapshot);
  const rows = await tx.select().from(draftRevisions).where(and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id)));
  const here = rows.find((r) => r.revision === current.revision)!;
  let target: (typeof rows)[number] | undefined;
  let newRevision: number;
  if (op.kind === "undo") {
    target = rows.find((r) => r.revision === here.parentRevision);
    if (!target) throw new AppError("precondition_failed", "errors.history.nothing_to_undo");
    newRevision = target.revision;
  } else if (op.kind === "redo") {
    target = rows.filter((r) => r.parentRevision === here.revision).sort((a, b) => b.revision - a.revision)[0];
    if (!target) throw new AppError("precondition_failed", "errors.history.nothing_to_redo");
    newRevision = target.revision;
  } else {
    target = rows.find((r) => r.revision === op.revision);
    if (!target) throw notFound("revision", String(op.revision));
    newRevision = await nextRevisionNumber(tx, type, id, current.revision);
    await recordRevision(tx, scope, { type, id, revision: newRevision, parent: current.revision, snapshot: target.snapshot, meta: { source: "restore", label: `restore:${op.revision}` } });
  }
  await adapter.apply(tx, scope, id, target.snapshot, newRevision, actor);
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    action: `draft.${op.kind}`,
    resourceType: type,
    resourceId: id,
    before: { revision: current.revision },
    after: { revision: newRevision, from: target.revision },
  });
  return { revision: newRevision, snapshot: target.snapshot };
}
