import { schema, type Db } from "@troba/db";
import { asc, eq } from "drizzle-orm";
import { lockForAdminCheck } from "./last-admin";

// Admin user management (SPEC-identity I6). Admins see who has an account, never their data.
// Disabling uses Better Auth's admin plugin fields (banned), which its sign-in refuses and
// requireUser() treats as signed out.

const { sessions, users } = schema;

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: schema.Role;
  createdAt: Date;
  lastActiveAt: Date | null;
  disabled: boolean;
};

export type DisableUserResult =
  { ok: true } | { ok: false; reason: "self" | "last-admin" | "not-found" };

// Every user, oldest first.
export async function listUsers(db: Db): Promise<UserSummary[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastActiveAt: users.lastActiveAt,
      banned: users.banned,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id));
  return rows.map(({ banned, ...user }) => ({ ...user, disabled: banned === true }));
}

// Disables the user and ends all their sessions. An admin can't disable themselves, and the last
// active admin can't be disabled.
export async function disableUser(
  db: Db,
  input: { userId: string; by: string },
): Promise<DisableUserResult> {
  const { userId, by } = input;
  if (userId === by) return { ok: false, reason: "self" };

  return db.transaction(async (tx) => {
    const check = await lockForAdminCheck(tx, userId);
    if (!check) return { ok: false, reason: "not-found" } as const;
    if (check.lastActiveAdmin) return { ok: false, reason: "last-admin" } as const;

    await tx.update(users).set({ banned: true }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    return { ok: true } as const;
  });
}

// Returns whether the user exists.
export async function enableUser(db: Db, input: { userId: string }): Promise<boolean> {
  const enabled = await db
    .update(users)
    .set({ banned: false, banReason: null, banExpires: null })
    .where(eq(users.id, input.userId))
    .returning({ id: users.id });
  return enabled.length > 0;
}
