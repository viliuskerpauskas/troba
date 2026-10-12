import { schema, type Db } from "@troba/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashToken, newToken } from "./tokens";

// Password reset links (SPEC-identity I5). troba sends no email: an admin creates a link and
// sends it to the user themselves. The link sets a new password and ends every session; the admin
// never sees or sets the password.

const { accounts, passwordResets, sessions, users } = schema;

export const resetLifetimeMs = 60 * 60 * 1000;

function isPending(now: Date) {
  return and(isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now));
}

// Returns null if the user doesn't exist.
export async function createPasswordReset(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<{ token: string } | null> {
  const now = input.now ?? new Date();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
  if (!user) return null;

  const token = newToken();
  await db.insert(passwordResets).values({
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + resetLifetimeMs),
  });
  return { token };
}

// Unknown, expired and used tokens all return null, so callers can't tell them apart.
export async function findPendingPasswordReset(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ email: string } | null> {
  const [reset] = await db
    .select({ email: users.email })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isPending(now)));
  return reset ?? null;
}

// Sets the password, ends all the user's sessions and uses up the link, in one transaction. The
// reset row is locked first, so concurrent uses of one link set the password exactly once. Hash
// the password before calling: hashing is slow and shouldn't hold the lock.
export async function resetPassword(
  db: Db,
  input: { token: string; passwordHash: string; now?: Date },
): Promise<{ ok: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [reset] = await tx
      .select({ id: passwordResets.id, userId: passwordResets.userId })
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hashToken(input.token)), isPending(now)))
      .for("update");
    if (!reset) return { ok: false };

    // Every troba account has a credential account: the admin CLI and invites both create one.
    await tx
      .update(accounts)
      .set({ password: input.passwordHash })
      .where(and(eq(accounts.userId, reset.userId), eq(accounts.providerId, "credential")));
    await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
    await tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id));
    return { ok: true };
  });
}
