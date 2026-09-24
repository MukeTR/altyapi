import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, notFound } from "@altyapi/commerce-core";
import { loadMembership, resolveSession, type PublicUser } from "@altyapi/auth";
import { enrichContext } from "@altyapi/observability";
import { loadStoreContext, type OrganizationContext, type StoreContext } from "@altyapi/tenancy";
import type { AppDeps } from "../deps";

export interface RequestAuth {
  user: PublicUser;
  sessionId: string;
  via: "cookie" | "bearer";
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth | null;
    orgContextCache?: OrganizationContext;
    storeContextCache?: StoreContext;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const authPlugin = fp<{ deps: AppDeps }>(async (app, { deps }) => {
  const allowedOrigins = new Set([new URL(deps.env.ADMIN_URL).origin, ...deps.env.CORS_ALLOWED_ORIGINS]);

  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const cookie = req.cookies[deps.env.SESSION_COOKIE_NAME];
    const token = bearer ?? cookie;
    if (!token) return;

    // Cookie-authenticated state changes must originate from a trusted origin (CSRF defense).
    if (!bearer && UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.has(origin)) {
        throw new AppError("forbidden", "errors.csrf.origin_rejected");
      }
    }

    const session = await resolveSession(deps.db, token);
    if (!session) return;
    req.auth = { user: session.user, sessionId: session.sessionId, via: bearer ? "bearer" : "cookie" };
    enrichContext({ principalType: "user", principalId: session.user.id, sessionId: session.sessionId });
  });
});

export function requireUser(req: FastifyRequest): RequestAuth {
  if (!req.auth) throw new AppError("unauthenticated", "errors.auth.required");
  return req.auth;
}

/** Resolves the organization context from the :organizationId route param for the signed-in user. */
export async function orgContext(deps: AppDeps, req: FastifyRequest): Promise<OrganizationContext> {
  if (req.orgContextCache) return req.orgContextCache;
  const auth = requireUser(req);
  const { organizationId } = req.params as { organizationId?: string };
  if (!organizationId) throw new AppError("bad_request", "errors.organization.required");
  const membership = await loadMembership(deps.db, auth.user.id, organizationId);
  // Non-members get 404 rather than 403 so organization ids cannot be probed.
  if (!membership) throw notFound("organization", organizationId);
  const ctx: OrganizationContext = {
    organizationId,
    principal: { kind: "user", userId: auth.user.id, agentId: null, sessionId: auth.sessionId, grants: membership.grants },
  };
  enrichContext({ organizationId });
  req.orgContextCache = ctx;
  return ctx;
}

/** Resolves the store context from :organizationId and :storeId route params. */
export async function storeContext(deps: AppDeps, req: FastifyRequest): Promise<StoreContext> {
  if (req.storeContextCache) return req.storeContextCache;
  const org = await orgContext(deps, req);
  const { storeId } = req.params as { storeId?: string };
  if (!storeId) throw new AppError("bad_request", "errors.store.required");
  const ctx = await loadStoreContext(deps.db, org, storeId);
  enrichContext({ storeId });
  req.storeContextCache = ctx;
  return ctx;
}

export function setSessionCookie(deps: AppDeps, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(deps.env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: deps.env.APP_ENV !== "local",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    ...(deps.env.COOKIE_DOMAIN ? { domain: deps.env.COOKIE_DOMAIN } : {}),
  });
}

export function clearSessionCookie(deps: AppDeps, reply: FastifyReply) {
  reply.clearCookie(deps.env.SESSION_COOKIE_NAME, {
    path: "/",
    ...(deps.env.COOKIE_DOMAIN ? { domain: deps.env.COOKIE_DOMAIN } : {}),
  });
}
