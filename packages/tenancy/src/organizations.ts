import { z } from "zod";
import { conflict, isValidSlug, invalid, newId, slugify } from "@altyapi/commerce-core";
import {
  eq,
  and,
  organizationMembers,
  organizations,
  roleAssignments,
  withTenantTx,
  type Database,
} from "@altyapi/database";
import { recordAudit } from "@altyapi/audit";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().optional(),
});

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

export async function createOrganization(
  db: Database,
  userId: string,
  input: z.infer<typeof createOrganizationSchema>,
): Promise<OrganizationSummary> {
  const slug = input.slug ?? slugify(input.name);
  if (!isValidSlug(slug)) throw invalid("errors.organization.invalid_slug", { slug });
  const organizationId = newId();

  return withTenantTx(db, { organizationId }, async (tx) => {
    const taken = await tx.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (taken) throw conflict("errors.organization.slug_taken", { slug });

    await tx.insert(organizations).values({ id: organizationId, slug, name: input.name, createdByUserId: userId });
    const memberId = newId();
    await tx.insert(organizationMembers).values({ id: memberId, organizationId, userId, status: "active" });
    await tx.insert(roleAssignments).values({ id: newId(), organizationId, memberId, storeId: null, role: "organization_owner" });
    await recordAudit(tx, {
      organizationId,
      action: "organization.created",
      resourceType: "organization",
      resourceId: organizationId,
      after: { slug, name: input.name },
    });
    return { id: organizationId, slug, name: input.name };
  });
}

export async function listOrganizationsForUser(db: Database, userId: string): Promise<OrganizationSummary[]> {
  return db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(organizations.name);
}
