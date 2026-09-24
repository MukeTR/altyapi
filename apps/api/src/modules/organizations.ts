import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ROLES, effectivePermissions } from "@altyapi/auth";
import {
  createOrganization,
  createOrganizationSchema,
  inviteMember,
  inviteMemberSchema,
  listMembers,
  setMemberRoles,
  setMemberRolesSchema,
} from "@altyapi/tenancy";
import type { AppDeps } from "../deps";
import { orgContext, requireUser } from "../plugins/auth";

const orgParams = z.object({ organizationId: z.uuid() });
const organizationSchema = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });

export const organizationRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.post(
    "/v1/organizations",
    { schema: { tags: ["organizations"], body: createOrganizationSchema, response: { 201: organizationSchema } } },
    async (req, reply) => {
      const { user } = requireUser(req);
      return reply.status(201).send(await createOrganization(deps.db, user.id, req.body));
    },
  );

  app.get(
    "/v1/organizations/:organizationId/permissions",
    {
      schema: {
        tags: ["organizations"],
        params: orgParams,
        querystring: z.object({ storeId: z.uuid().optional() }),
        response: {
          200: z.object({
            grants: z.array(z.object({ role: z.enum(ROLES), storeId: z.uuid().nullable() })),
            permissions: z.array(z.string()),
          }),
        },
      },
    },
    async (req) => {
      const ctx = await orgContext(deps, req);
      return {
        grants: ctx.principal.grants,
        permissions: effectivePermissions(ctx.principal.grants, req.query.storeId),
      };
    },
  );

  app.get(
    "/v1/organizations/:organizationId/members",
    {
      schema: {
        tags: ["organizations"],
        params: orgParams,
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.uuid(),
                userId: z.uuid().nullable(),
                email: z.string().nullable(),
                name: z.string().nullable(),
                status: z.string(),
                roles: z.array(z.object({ role: z.enum(ROLES), storeId: z.uuid().nullable() })),
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({ items: await listMembers(deps.db, await orgContext(deps, req)) }),
  );

  app.post(
    "/v1/organizations/:organizationId/members/invitations",
    {
      schema: {
        tags: ["organizations"],
        params: orgParams,
        body: inviteMemberSchema,
        response: { 201: z.object({ memberId: z.uuid(), expiresAt: z.date() }) },
      },
    },
    async (req, reply) => {
      const ctx = await orgContext(deps, req);
      // The invite link is e-mailed by the notifications worker (member.invited event), never returned here.
      const invite = await inviteMember(deps.db, ctx, req.body);
      return reply.status(201).send({ memberId: invite.memberId, expiresAt: invite.expiresAt });
    },
  );

  app.put(
    "/v1/organizations/:organizationId/members/:memberId/roles",
    {
      schema: {
        tags: ["organizations"],
        params: orgParams.extend({ memberId: z.uuid() }),
        body: setMemberRolesSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await setMemberRoles(deps.db, await orgContext(deps, req), req.params.memberId, req.body);
      return reply.status(204).send(null);
    },
  );
};
