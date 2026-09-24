import { z } from "zod";
import { AppError, conflict, newId, notFound, slugify } from "@altyapi/commerce-core";
import { and, asc, desc, eq, inArray, pages, sql, withTenantTx, yanitCitations, yanitGaps, yanitOpportunities, yanitVisibilitySnapshots, type SQL } from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";
import { assertCan, tenantScope, type StoreContext } from "@altyapi/tenancy";
import { LOCALES, containsCode, createPage, type PageContentInput } from "@altyapi/theme-engine";
import type { EkosistemServerDeps } from "../common";
import { linkStatusBlock, listQuerySchema, requireActiveLink } from "./common";

/**
 * Merchant views of what altyapi pulled from Yanıt (§9) and the approved content drafts made
 * from its opportunities (§7.5, §11). A draft is an ordinary draft page created through the
 * theme engine (validation and code guard included); it is never published automatically.
 * Reads need yanit:read; drafting and dismissing are content work and need content:write.
 */

type OpportunityRow = typeof yanitOpportunities.$inferSelect;
type VisibilityRow = typeof yanitVisibilitySnapshots.$inferSelect;

const IMPACT_ORDER = sql`case ${yanitOpportunities.impact} when 'high' then 0 when 'medium' then 1 else 2 end`;

function visibilityView(row: VisibilityRow) {
  const p = row.payload as { byProvider?: unknown; competitors?: unknown };
  return {
    windowDays: row.windowDays,
    validRuns: row.validRuns,
    runsWithBrand: row.runsWithBrand,
    visibilityBps: row.visibilityBps,
    shareOfVoiceBps: row.shareOfVoiceBps,
    trend: { previousBps: row.previousBps, deltaBps: row.deltaBps },
    byProvider: p.byProvider ?? [],
    competitors: p.competitors ?? [],
    lastMeasuredAt: row.lastMeasuredAt,
    asOf: row.asOf,
  };
}

function opportunityView(row: OpportunityRow) {
  return {
    ref: row.ref,
    kind: row.kind,
    sourceKind: row.sourceKind,
    title: row.title,
    body: row.body,
    query: row.query,
    targetUrl: row.targetUrl,
    impact: row.impact,
    peerStatus: row.peerStatus,
    status: row.localStatus,
    draftPageId: row.draftPageId,
    createdAt: row.peerCreatedAt,
    updatedAt: row.peerUpdatedAt,
  };
}

// ---------------------------------------------------------------------------
// Overview and lists
// ---------------------------------------------------------------------------

export async function yanitOverview(deps: EkosistemServerDeps, ctx: StoreContext) {
  assertCan(ctx, "yanit:read");
  const status = await linkStatusBlock(deps, ctx, "yanit");
  const base = { linked: status.link?.status === "active", link: status.view, configured: status.configured, circuit: status.circuit, freshness: status.freshness, nextPullAt: status.nextPullAt };
  const link = status.link;
  if (!link || link.status !== "active") return { ...base, visibility: null, gaps: null, opportunities: null, citations: null };

  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const visibility = [];
    for (const windowDays of [7, 30]) {
      const [latest, previous] = await tx
        .select()
        .from(yanitVisibilitySnapshots)
        .where(and(eq(yanitVisibilitySnapshots.linkId, link.id), eq(yanitVisibilitySnapshots.windowDays, windowDays)))
        .orderBy(desc(yanitVisibilitySnapshots.asOf))
        .limit(2);
      visibility.push({
        windowDays,
        latest: latest ? visibilityView(latest) : null,
        /** The previous stored measurement (altyapi's own history, next to Yanıt's trend). */
        previous: previous ? { visibilityBps: previous.visibilityBps, shareOfVoiceBps: previous.shareOfVoiceBps, asOf: previous.asOf } : null,
        deltaBps: latest && previous && latest.visibilityBps !== null && previous.visibilityBps !== null ? latest.visibilityBps - previous.visibilityBps : null,
      });
    }
    const [gapCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(yanitGaps).where(eq(yanitGaps.linkId, link.id));
    const topGaps = await tx.select().from(yanitGaps).where(eq(yanitGaps.linkId, link.id)).orderBy(desc(yanitGaps.priority), asc(yanitGaps.ref)).limit(5);
    const op = yanitOpportunities;
    const [opCounts] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${op.peerStatus} = 'open' and ${op.localStatus} = 'new')::int`,
        drafted: sql<number>`count(*) filter (where ${op.localStatus} = 'drafted')::int`,
        dismissed: sql<number>`count(*) filter (where ${op.localStatus} = 'dismissed')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(op)
      .where(eq(op.linkId, link.id));
    const byKind = await tx
      .select({ kind: op.kind, n: sql<number>`count(*)::int` })
      .from(op)
      .where(and(eq(op.linkId, link.id), eq(op.peerStatus, "open"), eq(op.localStatus, "new")))
      .groupBy(op.kind);
    const topOpportunities = await tx
      .select()
      .from(op)
      .where(and(eq(op.linkId, link.id), eq(op.peerStatus, "open"), eq(op.localStatus, "new")))
      .orderBy(IMPACT_ORDER, desc(op.peerUpdatedAt))
      .limit(5);
    const [citationCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(yanitCitations)
      .where(and(eq(yanitCitations.linkId, link.id), eq(yanitCitations.windowDays, 30)));
    const topCitations = await tx
      .select()
      .from(yanitCitations)
      .where(and(eq(yanitCitations.linkId, link.id), eq(yanitCitations.windowDays, 30)))
      .orderBy(desc(yanitCitations.count), asc(yanitCitations.domain))
      .limit(5);
    return {
      ...base,
      visibility,
      gaps: { total: gapCount!.total, top: topGaps.map(gapView) },
      opportunities: { ...opCounts!, openByKind: Object.fromEntries(byKind.map((k) => [k.kind, k.n])), top: topOpportunities.map(opportunityView) },
      citations: { windowDays: 30, domains: citationCount!.total, top: topCitations.map(citationView) },
    };
  });
}

function gapView(row: typeof yanitGaps.$inferSelect) {
  return {
    ref: row.ref,
    query: row.query,
    providers: row.providers,
    competitorsMentioned: row.competitorsMentioned,
    priority: row.priority,
    intent: row.intent,
    lastRunAt: row.lastRunAt,
    asOf: row.asOf,
  };
}

function citationView(row: typeof yanitCitations.$inferSelect) {
  return { domain: row.domain, count: row.count, shareBps: row.shareBps, sampleUrls: row.sampleUrls, windowDays: row.windowDays, asOf: row.asOf };
}

export const yanitGapsQuerySchema = listQuerySchema.extend({
  intent: z.enum(["discovery", "comparison", "review", "how_to"]).optional(),
});

export async function listYanitGaps(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof yanitGapsQuerySchema>) {
  assertCan(ctx, "yanit:read");
  const link = await requireActiveLink(deps, ctx, "yanit");
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const where = and(eq(yanitGaps.linkId, link.id), q.intent ? eq(yanitGaps.intent, q.intent) : undefined);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(yanitGaps).where(where)) as [{ total: number }];
    const rows = await tx.select().from(yanitGaps).where(where).orderBy(desc(yanitGaps.priority), asc(yanitGaps.ref)).limit(q.limit).offset(q.offset);
    return { items: rows.map(gapView), total, limit: q.limit, offset: q.offset };
  });
}

export const yanitOpportunitiesQuerySchema = listQuerySchema.extend({
  status: z.enum(["new", "drafted", "dismissed", "all"]).default("new"),
  kind: z.enum(["faq", "comparison_page", "structured_data", "product_content", "other"]).optional(),
  impact: z.enum(["high", "medium", "low"]).optional(),
});

export async function listYanitOpportunities(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof yanitOpportunitiesQuerySchema>) {
  assertCan(ctx, "yanit:read");
  const link = await requireActiveLink(deps, ctx, "yanit");
  const op = yanitOpportunities;
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const conditions: SQL[] = [eq(op.linkId, link.id)];
    if (q.status !== "all") conditions.push(eq(op.localStatus, q.status));
    // "new" lists what is still to do: Yanıt considers it open and nobody acted on it here.
    if (q.status === "new") conditions.push(eq(op.peerStatus, "open"));
    if (q.kind) conditions.push(eq(op.kind, q.kind));
    if (q.impact) conditions.push(eq(op.impact, q.impact));
    const where = and(...conditions);
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(op).where(where)) as [{ total: number }];
    const rows = await tx.select().from(op).where(where).orderBy(IMPACT_ORDER, desc(op.peerUpdatedAt), asc(op.ref)).limit(q.limit).offset(q.offset);
    return { items: rows.map(opportunityView), total, limit: q.limit, offset: q.offset };
  });
}

export const yanitCitationsQuerySchema = listQuerySchema.extend({
  windowDays: z.coerce.number().pipe(z.literal(30)).default(30),
});

export async function listYanitCitations(deps: EkosistemServerDeps, ctx: StoreContext, q: z.infer<typeof yanitCitationsQuerySchema>) {
  assertCan(ctx, "yanit:read");
  const link = await requireActiveLink(deps, ctx, "yanit");
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const where = and(eq(yanitCitations.linkId, link.id), eq(yanitCitations.windowDays, q.windowDays));
    const [{ total }] = (await tx.select({ total: sql<number>`count(*)::int` }).from(yanitCitations).where(where)) as [{ total: number }];
    const rows = await tx.select().from(yanitCitations).where(where).orderBy(desc(yanitCitations.count), asc(yanitCitations.domain)).limit(q.limit).offset(q.offset);
    return { items: rows.map(citationView), total, limit: q.limit, offset: q.offset };
  });
}

// ---------------------------------------------------------------------------
// Opportunity → draft page
// ---------------------------------------------------------------------------

const MAX_PARAGRAPHS = 30;
const FAQ_HEADING: Record<(typeof LOCALES)[number], string> = { tr: "Sıkça sorulan sorular", en: "Frequently asked questions" };

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain text that the design code guard would accept; anything code-like is left out. */
function safeText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const clean = text.normalize("NFC").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
  if (!clean || containsCode(clean)) return null;
  return clean.slice(0, max);
}

/** Paragraphs of a peer text as sanitised rich text, within `maxChars` of HTML. */
function paragraphsHtml(text: string, maxChars: number): string {
  const out: string[] = [];
  let size = 0;
  for (const raw of text.split(/\r?\n\s*\r?\n|\r?\n/).slice(0, MAX_PARAGRAPHS * 2)) {
    const p = safeText(raw, 2000);
    if (!p) continue;
    const html = `<p>${escapeHtml(p)}</p>`;
    if (size + html.length > maxChars || out.length >= MAX_PARAGRAPHS) break;
    out.push(html);
    size += html.length;
  }
  return out.join("");
}

/** The first handle not used by another content page: base, base-2, … */
async function freeHandle(deps: EkosistemServerDeps, ctx: StoreContext, title: string): Promise<string> {
  const base = slugify(title, 56) || "yanit-icerik";
  const taken = new Set(
    (
      await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
        tx
          .select({ handle: pages.handle })
          .from(pages)
          .where(and(eq(pages.storeId, ctx.storeId), inArray(pages.type, ["page", "landing"]), sql`${pages.handle} like ${`${base}%`}`)),
      )
    ).map((r) => r.handle),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 50; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${newId().slice(-6)}`;
}

/** Section tree of the draft: FAQ for question opportunities, rich text for the others. */
function draftContent(o: OpportunityRow, locale: (typeof LOCALES)[number], title: string): PageContentInput {
  const question = safeText(o.query, 300) ?? title.slice(0, 300);
  const faq = (answerHtml: string) => ({
    type: "faq",
    props: { heading: { [locale]: FAQ_HEADING[locale] }, emitStructuredData: true },
    blocks: [{ type: "item", props: { question: { [locale]: question }, answer: answerHtml ? { [locale]: answerHtml } : {} } }],
  });
  if (o.kind === "faq") return { sections: [faq(paragraphsHtml(o.body, 4000))] };
  const sections: PageContentInput["sections"] = [
    { type: "rich-text", props: { heading: { [locale]: title.slice(0, 160) }, body: { [locale]: paragraphsHtml(o.body, 19_000) } } },
  ];
  // A comparison answers a concrete question; keep it as a FAQ entry for the merchant to answer.
  if (o.kind === "comparison_page" && o.query && safeText(o.query, 300)) sections.push(faq(""));
  return { sections };
}

/**
 * Creates a draft content page from a Yanıt opportunity. The page goes through the theme
 * engine (section validation, rich-text sanitising and the code guard) and its first
 * revision is recorded with source "yanit". Publishing stays a separate merchant action.
 * Drafting the same opportunity again returns the existing draft.
 */
export async function draftFromOpportunity(deps: EkosistemServerDeps, ctx: StoreContext, ref: string) {
  assertCan(ctx, "yanit:read");
  assertCan(ctx, "content:write");
  const link = await requireActiveLink(deps, ctx, "yanit");
  const load = async () => {
    const [row] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
      tx.select().from(yanitOpportunities).where(and(eq(yanitOpportunities.linkId, link.id), eq(yanitOpportunities.storeId, ctx.storeId), eq(yanitOpportunities.ref, ref))),
    );
    if (!row) throw notFound("ekosistem_opportunity", ref);
    return row;
  };
  const row = await load();
  const existingPage = async (pageId: string) => {
    const [page] = await withTenantTx(deps.db, tenantScope(ctx), (tx) => tx.select().from(pages).where(and(eq(pages.id, pageId), eq(pages.storeId, ctx.storeId))));
    return page ?? null;
  };
  if (row.localStatus === "drafted" && row.draftPageId) {
    const page = await existingPage(row.draftPageId);
    if (page) return { created: false, page: pageView(page), opportunity: opportunityView(row) };
  }
  if (row.localStatus === "dismissed") throw new AppError("precondition_failed", "errors.ekosistem.opportunity_dismissed", { ref });

  const locale = ((LOCALES as readonly string[]).includes(ctx.store.defaultLocale) ? ctx.store.defaultLocale : "tr") as (typeof LOCALES)[number];
  const title = safeText(row.title, 200) ?? safeText(row.query, 200);
  if (!title) throw new AppError("unprocessable", "errors.ekosistem.opportunity_not_draftable", { ref, reason: "title" });
  const content = draftContent(row, locale, title);
  const firstParagraph = safeText(row.body.split(/\r?\n/).find((l) => safeText(l, 320)) ?? null, 320);

  // Claim first so two concurrent requests cannot create two pages.
  const [claimed] = await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
    tx
      .update(yanitOpportunities)
      .set({ localStatus: "drafted", draftPageId: null })
      .where(and(eq(yanitOpportunities.id, row.id), eq(yanitOpportunities.localStatus, row.localStatus), sql`${yanitOpportunities.draftPageId} is not distinct from ${row.draftPageId}`))
      .returning({ id: yanitOpportunities.id }),
  );
  if (!claimed) throw conflict("errors.ekosistem.opportunity_changed", { ref });

  let page;
  try {
    page = await createPage(
      deps.db,
      ctx,
      {
        type: "page",
        title: { [locale]: title },
        handle: await freeHandle(deps, ctx, title),
        content,
        seo: { title: { [locale]: title.slice(0, 70) }, ...(firstParagraph ? { description: { [locale]: firstParagraph } } : {}) },
      },
      { revision: { source: "yanit", label: `yanit:${row.ref}`.slice(0, 200) } },
    );
  } catch (err) {
    await withTenantTx(deps.db, tenantScope(ctx), (tx) =>
      tx.update(yanitOpportunities).set({ localStatus: "new" }).where(and(eq(yanitOpportunities.id, row.id), sql`${yanitOpportunities.draftPageId} is null`)),
    );
    throw err;
  }
  await withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    await tx.update(yanitOpportunities).set({ draftPageId: page.id }).where(eq(yanitOpportunities.id, row.id));
    await recordAudit(tx, {
      action: "ekosistem.opportunity_drafted",
      resourceType: "yanit_opportunity",
      resourceId: row.id,
      after: { ref: row.ref, kind: row.kind, pageId: page.id, handle: page.handle },
    });
  });
  return { created: true, page: pageView(page), opportunity: opportunityView(await load()) };
}

function pageView(page: typeof pages.$inferSelect) {
  return { id: page.id, type: page.type, handle: page.handle, title: page.title, status: page.status, draftRevision: page.draftRevision, createdAt: page.createdAt };
}

/** Marks an opportunity as not wanted here (Yanıt has no decision endpoint; this is local triage). */
export async function dismissOpportunity(deps: EkosistemServerDeps, ctx: StoreContext, ref: string) {
  assertCan(ctx, "yanit:read");
  assertCan(ctx, "content:write");
  const link = await requireActiveLink(deps, ctx, "yanit");
  return withTenantTx(deps.db, tenantScope(ctx), async (tx) => {
    const [row] = await tx
      .select()
      .from(yanitOpportunities)
      .where(and(eq(yanitOpportunities.linkId, link.id), eq(yanitOpportunities.storeId, ctx.storeId), eq(yanitOpportunities.ref, ref)));
    if (!row) throw notFound("ekosistem_opportunity", ref);
    if (row.localStatus === "dismissed") return { opportunity: opportunityView(row) };
    const [updated] = await tx.update(yanitOpportunities).set({ localStatus: "dismissed" }).where(eq(yanitOpportunities.id, row.id)).returning();
    await recordAudit(tx, { action: "ekosistem.opportunity_dismissed", resourceType: "yanit_opportunity", resourceId: row.id, before: { status: row.localStatus }, after: { ref, status: "dismissed" } });
    return { opportunity: opportunityView(updated!) };
  });
}
