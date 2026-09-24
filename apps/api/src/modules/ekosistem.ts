import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  acceptCodeSchema,
  acceptLinkCode,
  applyKarmatikSuggestion,
  applySuggestionSchema,
  approveLink,
  brandProfileSchema,
  confirmAcceptedLink,
  confirmLinkSchema,
  createCodeSchema,
  createLinkCode,
  dismissKarmatikSuggestion,
  dismissOpportunity,
  draftFromOpportunity,
  getBrandProfile,
  getEkosistemSettings,
  karmatikAlertsQuerySchema,
  karmatikCompetitorsQuerySchema,
  karmatikOverview,
  karmatikSuggestionsQuerySchema,
  karmatikVariantsQuerySchema,
  listKarmatikAlerts,
  listKarmatikCompetitors,
  listKarmatikSuggestions,
  listKarmatikVariants,
  listLinks,
  listYanitCitations,
  listYanitGaps,
  listYanitOpportunities,
  profitCheck,
  profitCheckSchema,
  putBrandProfile,
  putEkosistemSettings,
  putEkosistemSettingsSchema,
  rejectLink,
  revokeLink,
  yanitCitationsQuerySchema,
  yanitGapsQuerySchema,
  yanitOpportunitiesQuerySchema,
  yanitOverview,
} from "@altyapi/ekosistem";
import type { AppDeps } from "../deps";
import { storeContext } from "../plugins/auth";
import { storeParams } from "./stores";

const linkParams = storeParams.extend({ linkId: z.uuid() });
/** Refs are the peer's opaque record ids (§6.2). */
const refParams = storeParams.extend({ ref: z.string().min(1).max(200) });

/**
 * Merchant admin for the ecosystem bridge (docs/ekosistem/v1.md): issue a code for
 * Kârmatik/Yanıt, enter a code they issued, approve/reject/remove links (§4), maintain the
 * brand profile served on GET /ekosistem/v1/brand, and work with what altyapi pulled:
 * Kârmatik profitability, suggestions, alerts and competitor prices, the profit check for
 * admin actions, and Yanıt visibility, gaps, opportunities and citations (§7.5). Link
 * secrets are never returned.
 */
export const ekosistemRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const base = "/v1/organizations/:organizationId/stores/:storeId/ekosistem";
  const sdeps = deps.ekosistem;
  const tags = ["ekosistem"];

  app.get(`${base}/links`, { schema: { tags, params: storeParams } }, async (req) => listLinks(sdeps, await storeContext(deps, req)));

  // Issuer: the code is shown once to the merchant, who enters it in Kârmatik or Yanıt.
  app.post(`${base}/codes`, { schema: { tags, params: storeParams, body: createCodeSchema } }, async (req, reply) =>
    reply.status(201).send(await createLinkCode(sdeps, await storeContext(deps, req), req.body)),
  );

  // Acceptor: the merchant entered a code issued by Kârmatik or Yanıt.
  app.post(`${base}/links/accept`, { schema: { tags, params: storeParams, body: acceptCodeSchema } }, async (req, reply) =>
    reply.status(201).send(await acceptLinkCode(sdeps, await storeContext(deps, req), req.body)),
  );
  app.post(`${base}/links/:linkId/confirm`, { schema: { tags, params: linkParams, body: confirmLinkSchema } }, async (req) =>
    confirmAcceptedLink(sdeps, await storeContext(deps, req), req.params.linkId, req.body),
  );

  // Issuer: approve or reject a link the peer confirmed.
  app.post(`${base}/links/:linkId/approve`, { schema: { tags, params: linkParams } }, async (req) => approveLink(sdeps, await storeContext(deps, req), req.params.linkId));
  app.post(`${base}/links/:linkId/reject`, { schema: { tags, params: linkParams } }, async (req) => rejectLink(sdeps, await storeContext(deps, req), req.params.linkId));

  // Local revocation is immediate; the peer is told in the background (retried for 72 hours).
  app.delete(`${base}/links/:linkId`, { schema: { tags, params: linkParams } }, async (req) => revokeLink(sdeps, await storeContext(deps, req), req.params.linkId));

  app.get(`${base}/brand-profile`, { schema: { tags, params: storeParams } }, async (req) => getBrandProfile(sdeps, await storeContext(deps, req)));
  app.put(`${base}/brand-profile`, { schema: { tags, params: storeParams, body: brandProfileSchema } }, async (req) =>
    putBrandProfile(sdeps, await storeContext(deps, req), req.body),
  );

  // Bridge settings: the profit guard policy (block | warn | ignore, default warn).
  app.get(`${base}/settings`, { schema: { tags, params: storeParams } }, async (req) => getEkosistemSettings(sdeps, await storeContext(deps, req)));
  app.put(`${base}/settings`, { schema: { tags, params: storeParams, body: putEkosistemSettingsSchema } }, async (req) =>
    putEkosistemSettings(sdeps, await storeContext(deps, req), req.body),
  );

  // Kârmatik read models (§8) and suggestion decisions.
  app.get(`${base}/karmatik/overview`, { schema: { tags, params: storeParams } }, async (req) => karmatikOverview(sdeps, await storeContext(deps, req)));
  app.get(`${base}/karmatik/variants`, { schema: { tags, params: storeParams, querystring: karmatikVariantsQuerySchema } }, async (req) =>
    listKarmatikVariants(sdeps, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/karmatik/suggestions`, { schema: { tags, params: storeParams, querystring: karmatikSuggestionsQuerySchema } }, async (req) =>
    listKarmatikSuggestions(sdeps, await storeContext(deps, req), req.query),
  );
  app.post(`${base}/karmatik/suggestions/:ref/apply`, { schema: { tags, params: refParams, body: applySuggestionSchema } }, async (req) =>
    applyKarmatikSuggestion(sdeps, await storeContext(deps, req), req.params.ref, req.body),
  );
  app.post(`${base}/karmatik/suggestions/:ref/dismiss`, { schema: { tags, params: refParams } }, async (req) =>
    dismissKarmatikSuggestion(sdeps, await storeContext(deps, req), req.params.ref),
  );
  app.get(`${base}/karmatik/alerts`, { schema: { tags, params: storeParams, querystring: karmatikAlertsQuerySchema } }, async (req) =>
    listKarmatikAlerts(sdeps, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/karmatik/competitors`, { schema: { tags, params: storeParams, querystring: karmatikCompetitorsQuerySchema } }, async (req) =>
    listKarmatikCompetitors(sdeps, await storeContext(deps, req), req.query),
  );
  // Admin-action helper (campaign / discount / price change); never used by customer flows.
  app.post(`${base}/karmatik/profit-check`, { schema: { tags, params: storeParams, body: profitCheckSchema } }, async (req) =>
    profitCheck(sdeps, await storeContext(deps, req), req.body),
  );

  // Yanıt read models (§9) and opportunity drafts (never published automatically).
  app.get(`${base}/yanit/overview`, { schema: { tags, params: storeParams } }, async (req) => yanitOverview(sdeps, await storeContext(deps, req)));
  app.get(`${base}/yanit/gaps`, { schema: { tags, params: storeParams, querystring: yanitGapsQuerySchema } }, async (req) =>
    listYanitGaps(sdeps, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/yanit/opportunities`, { schema: { tags, params: storeParams, querystring: yanitOpportunitiesQuerySchema } }, async (req) =>
    listYanitOpportunities(sdeps, await storeContext(deps, req), req.query),
  );
  app.get(`${base}/yanit/citations`, { schema: { tags, params: storeParams, querystring: yanitCitationsQuerySchema } }, async (req) =>
    listYanitCitations(sdeps, await storeContext(deps, req), req.query),
  );
  app.post(`${base}/yanit/opportunities/:ref/draft`, { schema: { tags, params: refParams } }, async (req, reply) => {
    const result = await draftFromOpportunity(sdeps, await storeContext(deps, req), req.params.ref);
    return reply.status(result.created ? 201 : 200).send(result);
  });
  app.post(`${base}/yanit/opportunities/:ref/dismiss`, { schema: { tags, params: refParams } }, async (req) =>
    dismissOpportunity(sdeps, await storeContext(deps, req), req.params.ref),
  );
};
