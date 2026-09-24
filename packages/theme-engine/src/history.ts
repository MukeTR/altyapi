import { AppError, conflict, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  desc,
  draftRevisions,
  eq,
  inArray,
  navigations,
  pages,
  sql,
  themes,
  withTenantTx,
  type Database,
  type Transaction,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { currentContext } from "@altyapi/observability";
import { assertCan, type StoreContext } from "@altyapi/tenancy";

export type RevisionResource = "theme" | "page" | "navigation";
/** "yanit": a draft created from a Yanıt content opportunity (ekosistem bridge), never published automatically. */
export type RevisionSource = "editor" | "ai_action" | "restore" | "bootstrap" | "import" | "navigation_change" | "yanit";

type Scope = { organizationId: string; storeId: string };

export interface RevisionMeta {
  source?: RevisionSource;
  label?: string | null;
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
  scope: Scope,
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
export async function ensureBaseline(tx: Transaction, scope: Scope, type: RevisionResource, id: string, currentRevision: number, snapshot: Record<string, unknown>) {
  const exists = await tx.query.draftRevisions.findFirst({
    where: and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id), eq(draftRevisions.revision, currentRevision)),
  });
  if (!exists) await recordRevision(tx, scope, { type, id, revision: currentRevision, parent: null, snapshot, meta: { source: "bootstrap", label: "baseline" } });
}

// ---------------------------------------------------------------------------
// Snapshots per resource type
// ---------------------------------------------------------------------------

export function themeSnapshot(t: typeof themes.$inferSelect): Record<string, unknown> {
  return { name: t.name, settings: t.draftSettings, globalSections: t.draftGlobalSections };
}

export function pageSnapshot(p: typeof pages.$inferSelect): Record<string, unknown> {
  return { title: p.title, handle: p.handle, content: p.draftContent, seo: p.draftSeo, campaignId: p.campaignId };
}

export function navigationSnapshot(n: typeof navigations.$inferSelect): Record<string, unknown> {
  return { name: n.name, items: n.items };
}

async function loadResource(tx: Transaction, storeId: string, type: RevisionResource, id: string) {
  if (type === "theme") {
    const [r] = await tx.select().from(themes).where(and(eq(themes.id, id), eq(themes.storeId, storeId))).for("update");
    return r ? { revision: r.draftRevision, snapshot: themeSnapshot(r) } : null;
  }
  if (type === "page") {
    const [r] = await tx.select().from(pages).where(and(eq(pages.id, id), eq(pages.storeId, storeId))).for("update");
    return r ? { revision: r.draftRevision, snapshot: pageSnapshot(r) } : null;
  }
  const [r] = await tx.select().from(navigations).where(and(eq(navigations.id, id), eq(navigations.storeId, storeId))).for("update");
  return r ? { revision: r.revision, snapshot: navigationSnapshot(r) } : null;
}

/** Writes a snapshot back into the draft and moves the draft pointer to `revision`. */
async function applySnapshot(tx: Transaction, storeId: string, type: RevisionResource, id: string, snap: Record<string, unknown>, revision: number) {
  if (type === "theme") {
    await tx
      .update(themes)
      .set({ name: snap.name as string, draftSettings: snap.settings as Record<string, unknown>, draftGlobalSections: snap.globalSections as never, draftRevision: revision })
      .where(eq(themes.id, id));
  } else if (type === "page") {
    const handle = snap.handle as string;
    const clash = await tx.query.pages.findFirst({
      where: and(eq(pages.storeId, storeId), inArray(pages.type, ["page", "landing"]), eq(pages.handle, handle)),
    });
    if (clash && clash.id !== id) throw conflict("errors.page.handle_taken", { handle });
    await tx
      .update(pages)
      .set({ title: snap.title as Record<string, string>, handle, draftContent: snap.content as never, draftSeo: snap.seo as never, campaignId: (snap.campaignId as string | null) ?? null, draftRevision: revision })
      .where(eq(pages.id, id));
  } else {
    await tx.update(navigations).set({ name: snap.name as string, items: snap.items as never, revision }).where(eq(navigations.id, id));
  }
}

function permissionFor(type: RevisionResource) {
  return type === "page" ? ("content:write" as const) : ("storefront:write" as const);
}

export async function listRevisions(db: Database, ctx: StoreContext, type: RevisionResource, id: string, limit = 100) {
  assertCan(ctx, "storefront:read");
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, async (tx) => {
    const current = await loadResource(tx, ctx.storeId, type, id);
    if (!current) throw notFound(type, id);
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
      .where(and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id), eq(draftRevisions.storeId, ctx.storeId)))
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
  });
}

export async function getRevision(db: Database, ctx: StoreContext, type: RevisionResource, id: string, revision: number) {
  assertCan(ctx, "storefront:read");
  const row = await withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) =>
    tx.query.draftRevisions.findFirst({
      where: and(eq(draftRevisions.resourceType, type), eq(draftRevisions.resourceId, id), eq(draftRevisions.revision, revision), eq(draftRevisions.storeId, ctx.storeId)),
    }),
  );
  if (!row) throw notFound("revision", String(revision));
  return row;
}

/**
 * Undo / redo / restore on the draft. Undo moves to the parent revision, redo to the newest
 * child of the current revision, restore copies any revision into a new one. The live site is
 * never touched: changes go live only through publish.
 */
export async function moveDraft(
  db: Database,
  ctx: StoreContext,
  type: RevisionResource,
  id: string,
  op: { kind: "undo" } | { kind: "redo" } | { kind: "restore"; revision: number },
  expectedRevision: number,
) {
  assertCan(ctx, permissionFor(type));
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(db, scope, async (tx) => {
    const current = await loadResource(tx, ctx.storeId, type, id);
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
    await applySnapshot(tx, ctx.storeId, type, id, target.snapshot, newRevision);
    await recordAudit(tx, {
      action: `draft.${op.kind}`,
      resourceType: type,
      resourceId: id,
      before: { revision: current.revision },
      after: { revision: newRevision, from: target.revision },
    });
    return { revision: newRevision, snapshot: target.snapshot };
  });
}
