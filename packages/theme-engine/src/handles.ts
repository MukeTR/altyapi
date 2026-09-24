import { conflict, invalid, isValidSlug } from "@altyapi/commerce-core";
import { and, eq, inArray, pages, pageVersions, publications, storefrontState, type Transaction } from "@altyapi/database";

/** Page types served under their own handle (/pages/<handle>). */
export const ROUTABLE_PAGE_TYPES = ["page", "landing"] as const;

export function isRoutablePageType(type: string): boolean {
  return (ROUTABLE_PAGE_TYPES as readonly string[]).includes(type);
}

/** Handles the active publication serves routable pages under, by page id. */
async function servedHandles(tx: Transaction, storeId: string): Promise<Map<string, string>> {
  const state = await tx.query.storefrontState.findFirst({ where: eq(storefrontState.storeId, storeId) });
  const live = state?.activePublicationId
    ? await tx.query.publications.findFirst({ where: eq(publications.id, state.activePublicationId) })
    : undefined;
  const versionIds = Object.values(live?.pageVersions ?? {});
  if (!versionIds.length) return new Map();
  const rows = await tx
    .select({ pageId: pageVersions.pageId, handle: pageVersions.handle })
    .from(pageVersions)
    .where(and(inArray(pageVersions.id, versionIds), inArray(pageVersions.type, [...ROUTABLE_PAGE_TYPES])));
  return new Map(rows.map((r) => [r.pageId, r.handle]));
}

/**
 * One URL, one page: a routable handle belongs to at most one page, counting every page's
 * draft handle and the handle each live page is served under (a page renamed only in its
 * draft keeps serving its published handle until the next publish). Guarding every way a
 * draft handle can change (create, edit, undo/redo/restore) keeps publishing, including the
 * unattended scheduled publish, from ever meeting two pages on one URL.
 */
export async function assertHandleFree(tx: Transaction, storeId: string, handle: string, exceptId?: string): Promise<void> {
  if (!isValidSlug(handle)) throw invalid("errors.page.invalid_handle", { handle });
  const clash = await tx.query.pages.findFirst({
    where: and(eq(pages.storeId, storeId), inArray(pages.type, [...ROUTABLE_PAGE_TYPES]), eq(pages.handle, handle)),
  });
  if (clash && clash.id !== exceptId) throw conflict("errors.page.handle_taken", { handle });
  for (const [pageId, served] of await servedHandles(tx, storeId)) {
    if (served === handle && pageId !== exceptId) throw conflict("errors.page.handle_taken", { handle });
  }
}

/**
 * The same rule seen from the live side, for switches that bring back earlier page versions
 * (rollback): a handle that goes live again must not be another page's draft handle, or that
 * page could never be published (or scheduled) under it.
 */
export async function assertLiveHandlesFree(tx: Transaction, storeId: string, live: Map<string, string>): Promise<void> {
  if (!live.size) return;
  const drafts = await tx
    .select({ id: pages.id, handle: pages.handle })
    .from(pages)
    .where(and(eq(pages.storeId, storeId), inArray(pages.type, [...ROUTABLE_PAGE_TYPES]), inArray(pages.handle, [...new Set(live.values())])));
  for (const [pageId, handle] of live) {
    if (drafts.some((d) => d.handle === handle && d.id !== pageId)) throw conflict("errors.page.handle_taken", { handle });
  }
}
