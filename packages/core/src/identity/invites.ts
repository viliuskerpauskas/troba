import { createHash, randomBytes } from "node:crypto";
import { schema, type Db } from "@troba/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

// Invites (SPEC-identity I2): single-use links an admin sends to a friend. The token only exists
// in the link; the database keeps its SHA-256 hash, so a database leak can't be used to sign up.

const { accounts, invites, users } = schema;

export const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export type InviteSummary = {
  id: string;
  email: string | null;
  status: InviteStatus;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export type RedeemResult =
  { ok: true; userId: string; email: string } | { ok: false; reason: "invalid" | "email-taken" };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPending(now: Date) {
  return and(isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now));
}

export async function createInvite(
  db: Db,
  input: { createdBy: string; email?: string | null; now?: Date },
): Promise<{ id: string; token: string }> {
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const [invite] = await db
    .insert(invites)
    .values({
      tokenHash: hashToken(token),
      email: input.email ? normalizeEmail(input.email) : null,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + inviteLifetimeMs),
    })
    .returning({ id: invites.id });
  return { id: invite!.id, token };
}

// Unknown, expired, used and revoked tokens all return null, so callers can't tell them apart.
export async function findPendingInvite(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ email: string | null } | null> {
  const [invite] = await db
    .select({ email: invites.email })
    .from(invites)
    .where(and(eq(invites.tokenHash, hashToken(token)), isPending(now)));
  return invite ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver's error; the Postgres code is on it or on its cause.
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
}

// Creates the user and their password account and uses up the invite in one transaction. The
// invite row is locked first, so concurrent redemptions of one token create exactly one user.
// Hash the password before calling: hashing is slow and shouldn't hold the lock.
export async function redeemInvite(
  db: Db,
  input: { token: string; name: string; email: string; passwordHash: string; now?: Date },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const [invite] = await tx
        .select({ id: invites.id, email: invites.email })
        .from(invites)
        .where(and(eq(invites.tokenHash, hashToken(input.token)), isPending(now)))
        .for("update");
      if (!invite) return { ok: false, reason: "invalid" } as const;

      // A bound invite always signs up its own email; the form only displays it.
      const email = invite.email ?? normalizeEmail(input.email);
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (taken) return { ok: false, reason: "email-taken" } as const;

      const [user] = await tx
        .insert(users)
        .values({ name: input.name.trim(), email, role: "user" })
        .returning({ id: users.id });
      const userId = user!.id;
      // The same shape Better Auth's own email sign-up creates.
      await tx.insert(accounts).values({
        userId,
        providerId: "credential",
        accountId: userId,
        password: input.passwordHash,
      });
      await tx
        .update(invites)
        .set({ usedAt: now, usedBy: userId })
        .where(eq(invites.id, invite.id));
      return { ok: true, userId, email } as const;
    });
  } catch (error) {
    // Two different invites raced to the same email; the loser's transaction rolled back.
    if (isUniqueViolation(error)) return { ok: false, reason: "email-taken" };
    throw error;
  }
}

function statusOf(
  invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InviteStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  return "pending";
}

// All invites, newest first. Invites are shared admin data: every admin sees all of them.
export async function listInvites(db: Db, now = new Date()): Promise<InviteSummary[]> {
  const rows = await db
    .select({
      id: invites.id,
      email: invites.email,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      revokedAt: invites.revokedAt,
    })
    .from(invites)
    .orderBy(desc(invites.createdAt));
  return rows.map((invite) => ({ ...invite, status: statusOf(invite, now) }));
}

// Only pending invites can be revoked. Returns whether one was.
export async function revokeInvite(db: Db, input: { id: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const revoked = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.id, input.id), isPending(now)))
    .returning({ id: invites.id });
  return revoked.length > 0;
}
