import { z } from "zod";
import { AppError, conflict, newId } from "@altyapi/commerce-core";
import { and, eq, gt, isNull, users, userSessions, type DbExecutor } from "@altyapi/database";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { generateToken, sha256 } from "./tokens";

export const emailSchema = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

export const passwordSchema = z.string().min(10, "errors.password.too_short").max(256);

export const registerInputSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  locale: z.enum(["tr", "en"]).default("tr"),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  emailVerifiedAt: Date | null;
}

const toPublic = (u: typeof users.$inferSelect): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  locale: u.locale,
  emailVerifiedAt: u.emailVerifiedAt,
});

export async function registerUser(db: DbExecutor, input: RegisterInput): Promise<PublicUser> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw conflict("errors.user.email_taken");
  const [row] = await db
    .insert(users)
    .values({
      id: newId(),
      email: input.email,
      name: input.name,
      locale: input.locale,
      passwordHash: await hashPassword(input.password),
    })
    .returning();
  return toPublic(row!);
}

export async function authenticateWithPassword(db: DbExecutor, email: string, password: string): Promise<PublicUser> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    throw new AppError("unauthenticated", "errors.auth.invalid_credentials");
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("unauthenticated", "errors.auth.invalid_credentials");
  }
  if (user.disabledAt) throw new AppError("forbidden", "errors.auth.account_disabled");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return toPublic(user);
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: DbExecutor,
  userId: string,
  opts: { ttlHours: number; ip?: string | undefined; userAgent?: string | undefined },
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + opts.ttlHours * 3600_000);
  const sessionId = newId();
  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent?.slice(0, 512) ?? null,
  });
  return { sessionId, token, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  user: PublicUser;
}

export async function resolveSession(db: DbExecutor, token: string): Promise<ResolvedSession | null> {
  const rows = await db
    .select({ session: userSessions, user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.tokenHash, sha256(token)),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Throttle last-seen writes to once per 5 minutes to avoid a write on every request.
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, row.session.id));
  }
  return { sessionId: row.session.id, user: toPublic(row.user) };
}

export async function revokeSession(db: DbExecutor, sessionId: string): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
}

export async function getUserById(db: DbExecutor, userId: string): Promise<PublicUser | null> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return u ? toPublic(u) : null;
}
