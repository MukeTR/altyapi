import { and, eq, organizationMembers, roleAssignments, type DbExecutor } from "@altyapi/database";
import type { RoleGrant } from "./permissions";

export interface Membership {
  memberId: string;
  organizationId: string;
  grants: RoleGrant[];
}

/** Loads the active membership and role grants of a user in an organization. */
export async function loadMembership(db: DbExecutor, userId: string, organizationId: string): Promise<Membership | null> {
  const member = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, "active"),
    ),
  });
  if (!member) return null;
  const rows = await db
    .select({ role: roleAssignments.role, storeId: roleAssignments.storeId })
    .from(roleAssignments)
    .where(eq(roleAssignments.memberId, member.id));
  return { memberId: member.id, organizationId, grants: rows };
}
