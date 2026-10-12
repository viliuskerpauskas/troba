import { schema, type Db } from "@troba/db";
import { asc, eq, or } from "drizzle-orm";

// troba always keeps at least one active admin: one who can sign in, so not disabled. Anything
// that removes a user from that set (deleting, disabling) checks it with lockForAdminCheck inside
// its transaction.

const { users } = schema;

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Locks the user and every admin, in id order so concurrent callers can't deadlock: a second
// delete or disable waits for the first, then sees its result. Returns null if the user doesn't
// exist; otherwise whether they are the only active admin left.
export async function lockForAdminCheck(
  tx: Transaction,
  userId: string,
): Promise<{ lastActiveAdmin: boolean } | null> {
  const locked = await tx
    .select({ id: users.id, role: users.role, banned: users.banned })
    .from(users)
    .where(or(eq(users.id, userId), eq(users.role, "admin")))
    .orderBy(asc(users.id))
    .for("update");
  if (!locked.some((row) => row.id === userId)) return null;
  const activeAdmins = locked.filter((row) => row.role === "admin" && !row.banned);
  return { lastActiveAdmin: activeAdmins.length === 1 && activeAdmins[0]!.id === userId };
}
