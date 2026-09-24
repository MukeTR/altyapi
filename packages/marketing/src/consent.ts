import { z } from "zod";
import { AppError, newId } from "@altyapi/commerce-core";
import { hmacSign } from "@altyapi/auth";
import { and, consentRecords, eq, marketingContacts, sql, withTenantTx, type Database, type Transaction } from "@altyapi/database";
import { appendEvent } from "@altyapi/events";

export interface StoreRef {
  organizationId: string;
  storeId: string;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  /** Secret used to key IP hashes (never store raw IPs as consent evidence). */
  hashSecret: string;
}

export const newsletterSchema = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  consent: z.literal(true, { error: "errors.newsletter.consent_required" }),
  consentText: z.string().max(2000).optional(),
  source: z.string().max(100).regex(/^[a-z_]+:[\w-]+$/),
  locale: z.string().max(10).optional(),
  anonymousId: z.string().max(64).optional(),
});

export const EMAIL_MARKETING_POLICY_VERSION = "email-marketing-v1";

function ipHash(meta: RequestMeta): string | null {
  return meta.ip ? hmacSign(meta.hashSecret, `ip:${meta.ip}`) : null;
}

export async function recordConsent(
  tx: Transaction,
  ref: StoreRef,
  input: {
    subjectType: "anonymous" | "customer" | "contact";
    subjectId: string;
    purpose: string;
    categories: Record<string, boolean>;
    policyVersion: string;
    textSnapshot?: string | null;
    source: string;
  },
  meta: RequestMeta,
) {
  const id = newId();
  await tx.insert(consentRecords).values({
    id,
    ...ref,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    purpose: input.purpose,
    categories: input.categories,
    policyVersion: input.policyVersion,
    textSnapshot: input.textSnapshot ?? null,
    source: input.source,
    ipHash: ipHash(meta),
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
  });
  await appendEvent(tx, {
    type: "marketing.consent_changed",
    ...ref,
    aggregateType: input.subjectType,
    aggregateId: input.subjectId,
    payload: {
      customerId: input.subjectType === "customer" ? input.subjectId : null,
      anonymousId: input.subjectType === "anonymous" ? input.subjectId : null,
      categories: input.categories,
    },
  });
  return id;
}

/**
 * E-mail marketing opt-in. Explicit consent is mandatory; the shown text and policy version
 * are stored as evidence and the contact is flagged for İYS registration (Turkey).
 */
export async function subscribeNewsletter(db: Database, ref: StoreRef, raw: unknown, meta: RequestMeta & { countryCode: string }) {
  const parsed = newsletterSchema.safeParse(raw);
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === "consent");
    throw new AppError("validation_failed", consentIssue ? "errors.newsletter.consent_required" : "errors.newsletter.invalid_email");
  }
  const input = parsed.data;
  return withTenantTx(db, ref, async (tx) => {
    const existing = await tx.query.marketingContacts.findFirst({
      where: and(eq(marketingContacts.storeId, ref.storeId), sql`lower(${marketingContacts.email}) = ${input.email}`),
    });
    const now = new Date();
    let contactId = existing?.id;
    const iysStatus = meta.countryCode === "TR" ? "pending" : "not_required";
    if (existing) {
      await tx
        .update(marketingContacts)
        .set({ emailStatus: "subscribed", emailSubscribedAt: now, emailUnsubscribedAt: null, iysStatus, source: existing.source ?? input.source })
        .where(eq(marketingContacts.id, existing.id));
    } else {
      contactId = newId();
      await tx.insert(marketingContacts).values({
        id: contactId,
        ...ref,
        email: input.email,
        locale: input.locale ?? null,
        emailStatus: "subscribed",
        emailSubscribedAt: now,
        source: input.source,
        iysStatus,
      });
    }
    await recordConsent(
      tx,
      ref,
      {
        subjectType: "contact",
        subjectId: contactId!,
        purpose: "email_marketing",
        categories: { email_marketing: true },
        policyVersion: EMAIL_MARKETING_POLICY_VERSION,
        textSnapshot: input.consentText ?? null,
        source: input.source,
      },
      meta,
    );
    return { contactId: contactId!, status: "subscribed" as const };
  });
}

/** One-click unsubscribe (List-Unsubscribe) and preference center. */
export async function unsubscribeEmail(db: Database, ref: StoreRef, contactId: string, source: string, meta: RequestMeta) {
  return withTenantTx(db, ref, async (tx) => {
    const c = await tx.query.marketingContacts.findFirst({ where: and(eq(marketingContacts.id, contactId), eq(marketingContacts.storeId, ref.storeId)) });
    if (!c) throw new AppError("not_found", "errors.contact.not_found");
    await tx
      .update(marketingContacts)
      .set({ emailStatus: "unsubscribed", emailUnsubscribedAt: new Date(), iysStatus: c.iysStatus === "not_required" ? "not_required" : "pending" })
      .where(eq(marketingContacts.id, contactId));
    await recordConsent(
      tx,
      ref,
      { subjectType: "contact", subjectId: contactId, purpose: "email_marketing", categories: { email_marketing: false }, policyVersion: EMAIL_MARKETING_POLICY_VERSION, source },
      meta,
    );
  });
}
