import { rm } from "node:fs/promises";
import path from "node:path";
import { schema, type Db } from "@troba/db";
import { eq } from "drizzle-orm";
import { lockForAdminCheck } from "./last-admin";

// Deleting an account (SPEC-identity I4): the user row goes, and with it every row they own
// (every user_id references users with ON DELETE CASCADE, sessions included) and their files in
// uploads/<userId>/. Irreversible. The last active admin can't be deleted, so troba always keeps
// one (see last-admin.ts).

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
    // Two admins deleting themselves at once: the second waits, then no longer sees the first.
    const check = await lockForAdminCheck(tx, userId);
    if (!check) return { ok: false, reason: "not-found" } as const;
    if (check.lastActiveAdmin) return { ok: false, reason: "last-admin" } as const;

    await tx.delete(users).where(eq(users.id, userId));
    // Before the commit: if the files can't be removed, the rows stay and the user can retry. If
    // the commit itself fails after this, the account is left without its files; deleting it
    // again finishes the job.
    await rm(path.join(uploadsDir, userId), { recursive: true, force: true });
    return { ok: true } as const;
  });
}
