import {
  draftActorOf,
  entryDraftAdapter,
  getRevisionTx,
  listRevisionsTx,
  moveDraftTx,
  type DraftAdapter,
  type DraftMove,
  type RevisionResource,
} from "@altyapi/content";
import { and, eq, navigations, pages, themes, withTenantTx, type Database } from "@altyapi/database";
import { assertHandleFree, isRoutablePageType } from "./handles";
import { assertCan, assertModule, type StoreContext } from "@altyapi/tenancy";

// The generic draft history lives in @altyapi/content (shared with content entries); these
// re-exports keep the theme-engine services and their callers unchanged.
export {
  ensureBaseline,
  nextRevisionNumber,
  recordRevision,
  type RevisionMeta,
  type RevisionResource,
  type RevisionSource,
} from "@altyapi/content";

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

const themeAdapter: DraftAdapter = {
  type: "theme",
  readPermission: "storefront:read",
  writePermission: "storefront:write",
  async load(tx, storeId, id) {
    const [r] = await tx.select().from(themes).where(and(eq(themes.id, id), eq(themes.storeId, storeId))).for("update");
    return r ? { revision: r.draftRevision, snapshot: themeSnapshot(r) } : null;
  },
  async apply(tx, _scope, id, snap, revision) {
    await tx
      .update(themes)
      .set({ name: snap.name as string, draftSettings: snap.settings as Record<string, unknown>, draftGlobalSections: snap.globalSections as never, draftRevision: revision })
      .where(eq(themes.id, id));
  },
};

const pageAdapter: DraftAdapter = {
  type: "page",
  readPermission: "storefront:read",
  writePermission: "content:write",
  async load(tx, storeId, id) {
    const [r] = await tx.select().from(pages).where(and(eq(pages.id, id), eq(pages.storeId, storeId))).for("update");
    return r ? { revision: r.draftRevision, snapshot: pageSnapshot(r) } : null;
  },
  async apply(tx, scope, id, snap, revision) {
    const handle = snap.handle as string;
    const [page] = await tx.select({ type: pages.type, handle: pages.handle }).from(pages).where(eq(pages.id, id));
    // Restoring an earlier handle is a rename: the same one-URL-one-page rule as editing it.
    if (page && isRoutablePageType(page.type) && page.handle !== handle) await assertHandleFree(tx, scope.storeId, handle, id);
    await tx
      .update(pages)
      .set({ title: snap.title as Record<string, string>, handle, draftContent: snap.content as never, draftSeo: snap.seo as never, campaignId: (snap.campaignId as string | null) ?? null, draftRevision: revision })
      .where(eq(pages.id, id));
  },
};

const navigationAdapter: DraftAdapter = {
  type: "navigation",
  readPermission: "storefront:read",
  writePermission: "storefront:write",
  async load(tx, storeId, id) {
    const [r] = await tx.select().from(navigations).where(and(eq(navigations.id, id), eq(navigations.storeId, storeId))).for("update");
    return r ? { revision: r.revision, snapshot: navigationSnapshot(r) } : null;
  },
  async apply(tx, _scope, id, snap, revision) {
    await tx.update(navigations).set({ name: snap.name as string, items: snap.items as never, revision }).where(eq(navigations.id, id));
  },
};

const ADAPTERS: Record<RevisionResource, DraftAdapter> = {
  theme: themeAdapter,
  page: pageAdapter,
  navigation: navigationAdapter,
  entry: entryDraftAdapter,
};

/** Permission for the history operation; content entries also need the store's content module. */
function assertHistoryAccess(ctx: StoreContext, type: RevisionResource, permission: DraftAdapter["readPermission"]): void {
  assertCan(ctx, permission);
  if (type === "entry") assertModule(ctx, "content");
}

export async function listRevisions(db: Database, ctx: StoreContext, type: RevisionResource, id: string, limit = 100) {
  const adapter = ADAPTERS[type];
  assertHistoryAccess(ctx, type, adapter.readPermission);
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) => listRevisionsTx(tx, ctx.storeId, adapter, id, limit));
}

export async function getRevision(db: Database, ctx: StoreContext, type: RevisionResource, id: string, revision: number) {
  assertHistoryAccess(ctx, type, ADAPTERS[type].readPermission);
  return withTenantTx(db, { organizationId: ctx.organizationId, storeId: ctx.storeId }, (tx) => getRevisionTx(tx, ctx.storeId, type, id, revision));
}

/**
 * Undo / redo / restore on the draft of a theme, page, menu or content entry. The live site is
 * never touched: changes go live only through publish.
 */
export async function moveDraft(db: Database, ctx: StoreContext, type: RevisionResource, id: string, op: DraftMove, expectedRevision: number) {
  const adapter = ADAPTERS[type];
  assertHistoryAccess(ctx, type, adapter.writePermission);
  const scope = { organizationId: ctx.organizationId, storeId: ctx.storeId };
  return withTenantTx(db, scope, (tx) => moveDraftTx(tx, scope, adapter, id, op, expectedRevision, draftActorOf(ctx)));
}
