import { z } from "zod";
import { AppError, conflict, forbidden, newId, notFound } from "@altyapi/commerce-core";
import {
  and,
  eq,
  isNull,
  organizationMembers,
  roleAssignments,
  stores,
  users,
  withTenantTx,
  type Database,
} from "@altyapi/database";
import { ROLES, hmacSign, safeEqual, type Role } from "@altyapi/auth";
import { appendEvent } from "@altyapi/events";
import { recordAudit } from "@altyapi/audit";
import { assertCan, type OrganizationContext } from "./context";

const roleGrantSchema = z.object({
  role: z.enum(ROLES),
  storeId: z.uuid().nullable().default(null),
});

export const inviteMemberSchema = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  roles: z.array(roleGrantSchema).min(1),
});

export const setMemberRolesSchema = z.object({
  roles: z.array(roleGrantSchema).min(1),
});

const INVITE_TTL_MS = 7 * 24 * 3600_000;

/**
 * Invite tokens are derived (HMAC over member id and expiry) instead of stored, so the
 * notification worker can rebuild the link from the database without secrets travelling
 * through events. Re-inviting changes the expiry and invalidates earlier links.
 */
export function deriveInviteToken(signingSecret: string, memberId: string, expiresAt: Date): string {
  const sig = hmacSign(signingSecret, `invite:${memberId}:${expiresAt.getTime()}`);
  return `${Buffer.from(memberId).toString("base64url")}.${sig}`;
}

export interface MemberView {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  status: string;
  roles: { role: Role; storeId: string | null }[];
}

function assertAssignable(ctx: OrganizationContext, roles: { role: Role }[]) {
  // Only owners may create other owners; this prevents privilege escalation by store admins.
  const isOwner = ctx.principal.grants.some((g) => g.role === "organization_owner");
  if (roles.some((r) => r.role === "organization_owner") && !isOwner && ctx.principal.kind !== "system") {
    throw forbidden("organization:manage");
  }
}

async function assertStoresInOrg(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], organizationId: string, storeIds: string[]) {
  for (const storeId of new Set(storeIds)) {
    const s = await tx.query.stores.findFirst({ where: and(eq(stores.id, storeId), eq(stores.organizationId, organizationId)) });
    if (!s) throw notFound("store", storeId);
  }
}

/** Creates an invitation and returns the one-time token to be delivered by e-mail. */
export async function inviteMember(
  db: Database,
  ctx: OrganizationContext,
  input: z.infer<typeof inviteMemberSchema>,
): Promise<{ memberId: string; expiresAt: Date }> {
  assertCan(ctx, "members:manage");
  assertAssignable(ctx, input.roles);
  return withTenantTx(db, { organizationId: ctx.organizationId }, async (tx) => {
    await assertStoresInOrg(tx, ctx.organizationId, input.roles.flatMap((r) => (r.storeId ? [r.storeId] : [])));
    const existingUser = await tx.query.users.findFirst({ where: eq(users.email, input.email) });
    if (existingUser) {
      const already = await tx.query.organizationMembers.findFirst({
        where: and(eq(organizationMembers.organizationId, ctx.organizationId), eq(organizationMembers.userId, existingUser.id)),
      });
      if (already) throw conflict("errors.member.already_member");
    }
    const pending = await tx.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.organizationId, ctx.organizationId), eq(organizationMembers.invitedEmail, input.email)),
    });
    if (pending) throw conflict("errors.member.already_invited");

    const memberId = newId();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await tx.insert(organizationMembers).values({
      id: memberId,
      organizationId: ctx.organizationId,
      invitedEmail: input.email,
      status: "invited",
      invitedByUserId: ctx.principal.userId,
      inviteExpiresAt: expiresAt,
    });
    await tx.insert(roleAssignments).values(
      input.roles.map((r) => ({ id: newId(), organizationId: ctx.organizationId, memberId, storeId: r.storeId, role: r.role })),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      action: "member.invited",
      resourceType: "organization_member",
      resourceId: memberId,
      after: { email: input.email, roles: input.roles },
    });
    await appendEvent(tx, {
      type: "member.invited",
      organizationId: ctx.organizationId,
      storeId: null,
      aggregateType: "organization_member",
      aggregateId: memberId,
      payload: { memberId, email: input.email },
    });
    return { memberId, expiresAt };
  });
}

/** Binds a pending invitation to the authenticated user whose e-mail matches the invite. */
export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
  signingSecret: string,
): Promise<{ organizationId: string }> {
  const invalidInvite = () => new AppError("not_found", "errors.member.invite_invalid");
  const [encodedId] = token.split(".");
  const memberId = encodedId ? Buffer.from(encodedId, "base64url").toString("utf8") : "";
  if (!z.uuid().safeParse(memberId).success) throw invalidInvite();
  return db.transaction(async (tx) => {
    const member = await tx.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.id, memberId), eq(organizationMembers.status, "invited"), isNull(organizationMembers.userId)),
    });
    if (
      !member?.inviteExpiresAt ||
      member.inviteExpiresAt.getTime() < Date.now() ||
      !safeEqual(deriveInviteToken(signingSecret, member.id, member.inviteExpiresAt), token)
    ) {
      throw invalidInvite();
    }
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || user.email !== member.invitedEmail) throw forbidden();
    await tx
      .update(organizationMembers)
      .set({ userId, status: "active", inviteExpiresAt: null })
      .where(eq(organizationMembers.id, member.id));
    await recordAudit(tx, {
      organizationId: member.organizationId,
      action: "member.joined",
      resourceType: "organization_member",
      resourceId: member.id,
    });
    return { organizationId: member.organizationId };
  });
}

export async function listMembers(db: Database, ctx: OrganizationContext): Promise<MemberView[]> {
  assertCan(ctx, "members:read");
  return withTenantTx(db, { organizationId: ctx.organizationId }, async (tx) => {
    const rows = await tx
      .select({ member: organizationMembers, user: { email: users.email, name: users.name } })
      .from(organizationMembers)
      .leftJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, ctx.organizationId));
    const grants = await tx
      .select({ memberId: roleAssignments.memberId, role: roleAssignments.role, storeId: roleAssignments.storeId })
      .from(roleAssignments)
      .where(eq(roleAssignments.organizationId, ctx.organizationId));
    return rows.map(({ member, user }) => ({
      id: member.id,
      userId: member.userId,
      email: user?.email ?? member.invitedEmail,
      name: user?.name ?? null,
      status: member.status,
      roles: grants.filter((g) => g.memberId === member.id).map(({ role, storeId }) => ({ role, storeId })),
    }));
  });
}

export async function setMemberRoles(
  db: Database,
  ctx: OrganizationContext,
  memberId: string,
  input: z.infer<typeof setMemberRolesSchema>,
): Promise<void> {
  assertCan(ctx, "members:manage");
  assertAssignable(ctx, input.roles);
  await withTenantTx(db, { organizationId: ctx.organizationId }, async (tx) => {
    const member = await tx.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, ctx.organizationId)),
    });
    if (!member) throw notFound("member", memberId);
    await assertStoresInOrg(tx, ctx.organizationId, input.roles.flatMap((r) => (r.storeId ? [r.storeId] : [])));

    const before = await tx.select().from(roleAssignments).where(eq(roleAssignments.memberId, memberId));
    const wasOwner = before.some((r) => r.role === "organization_owner");
    const staysOwner = input.roles.some((r) => r.role === "organization_owner");
    if (wasOwner && !staysOwner) {
      const owners = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.organizationId, ctx.organizationId), eq(roleAssignments.role, "organization_owner")));
      if (owners.length <= 1) throw conflict("errors.member.last_owner");
      assertAssignable(ctx, [{ role: "organization_owner" }]);
    }
    await tx.delete(roleAssignments).where(eq(roleAssignments.memberId, memberId));
    await tx.insert(roleAssignments).values(
      input.roles.map((r) => ({ id: newId(), organizationId: ctx.organizationId, memberId, storeId: r.storeId, role: r.role })),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      action: "member.roles_changed",
      resourceType: "organization_member",
      resourceId: memberId,
      before: before.map((r) => ({ role: r.role, storeId: r.storeId })),
      after: input.roles,
    });
  });
}
