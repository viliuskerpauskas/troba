import { rm } from "node:fs/promises";
import path from "node:path";
import { schema, type Db } from "@troba/db";
import { asc, eq, or } from "drizzle-orm";

// Deleting an account (SPEC-identity I4): the user row goes, and with it every row they own
// (every user_id references users with ON DELETE CASCADE, sessions included) and their files in
// uploads/<userId>/. Irreversible. The last admin can't be deleted, so troba always keeps one.

const { users } = schema;

export type DeleteUserResult = { ok: true } | { ok: false; reason: "last-admin" | "not-found" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteUser(
  db: Db,
  input: { userId: string; uploadsDir: string },
): Promise<DeleteUserResult> {
  const { userId, uploadsDir } = input;
  // The id becomes a path below; anything but a uuid could point outside the uploads folder.
  if (!uuid.test(userId)) throw new Error("deleteUser: userId must be a uuid.");

  return db.transaction(async (tx) => {
    // Locks the user and every admin, in id order so concurrent deletes can't deadlock. Two
    // admins deleting themselves at once: the second waits, then no longer sees the first.
    const locked = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(or(eq(users.id, userId), eq(users.role, "admin")))
      .orderBy(asc(users.id))
      .for("update");
    const user = locked.find((row) => row.id === userId);
    if (!user) return { ok: false, reason: "not-found" } as const;
    if (user.role === "admin" && locked.filter((row) => row.role === "admin").length < 2) {
      return { ok: false, reason: "last-admin" } as const;
    }

    await tx.delete(users).where(eq(users.id, userId));
    // Before the commit: if the files can't be removed, the rows stay and the user can retry. If
    // the commit itself fails after this, the account is left without its files; deleting it
    // again finishes the job.
    await rm(path.join(uploadsDir, userId), { recursive: true, force: true });
    return { ok: true } as const;
  });
}
