import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticateWithPassword, createSession, emailSchema, registerInputSchema, registerUser, revokeSession } from "@altyapi/auth";
import { acceptInvite, listOrganizationsForUser } from "@altyapi/tenancy";
import { recordAudit } from "@altyapi/audit";
import type { AppDeps } from "../deps";
import { clearSessionCookie, requireUser, setSessionCookie } from "../plugins/auth";

const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  locale: z.string(),
  emailVerifiedAt: z.date().nullable(),
});

const sessionResponse = z.object({ user: userSchema, expiresAt: z.date() });

export const authRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const strictLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  app.post(
    "/v1/auth/register",
    { config: strictLimit, schema: { tags: ["auth"], body: registerInputSchema, response: { 201: sessionResponse } } },
    async (req, reply) => {
      const user = await deps.db.transaction(async (tx) => {
        const u = await registerUser(tx, req.body);
        await recordAudit(tx, { action: "user.registered", resourceType: "user", resourceId: u.id, ip: req.ip });
        return u;
      });
      const session = await createSession(deps.db, user.id, {
        ttlHours: deps.env.SESSION_TTL_HOURS,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      setSessionCookie(deps, reply, session.token, session.expiresAt);
      return reply.status(201).send({ user, expiresAt: session.expiresAt });
    },
  );

  app.post(
    "/v1/auth/login",
    {
      config: strictLimit,
      schema: {
        tags: ["auth"],
        body: z.object({ email: emailSchema, password: z.string().min(1).max(256) }),
        response: { 200: sessionResponse },
      },
    },
    async (req, reply) => {
      const user = await authenticateWithPassword(deps.db, req.body.email, req.body.password);
      const session = await createSession(deps.db, user.id, {
        ttlHours: deps.env.SESSION_TTL_HOURS,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      await recordAudit(deps.db, { action: "user.logged_in", resourceType: "user", resourceId: user.id, ip: req.ip });
      setSessionCookie(deps, reply, session.token, session.expiresAt);
      return { user, expiresAt: session.expiresAt };
    },
  );

  app.post("/v1/auth/logout", { schema: { tags: ["auth"], response: { 204: z.null() } } }, async (req, reply) => {
    if (req.auth) await revokeSession(deps.db, req.auth.sessionId);
    clearSessionCookie(deps, reply);
    return reply.status(204).send(null);
  });

  app.get(
    "/v1/me",
    {
      schema: {
        tags: ["auth"],
        response: {
          200: z.object({
            user: userSchema,
            organizations: z.array(z.object({ id: z.uuid(), slug: z.string(), name: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      const { user } = requireUser(req);
      return { user, organizations: await listOrganizationsForUser(deps.db, user.id) };
    },
  );

  app.post(
    "/v1/invitations/accept",
    {
      schema: {
        tags: ["organizations"],
        body: z.object({ token: z.string().min(16).max(256) }),
        response: { 200: z.object({ organizationId: z.uuid() }) },
      },
    },
    async (req) => {
      const { user } = requireUser(req);
      return acceptInvite(deps.db, user.id, req.body.token, deps.env.APP_SIGNING_SECRET);
    },
  );
};
