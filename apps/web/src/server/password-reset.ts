import { findPendingPasswordReset, resetPassword } from "@troba/core";
import { z } from "zod";
import { auth, passwordLength } from "./auth";
import { db } from "./db";

const Password = z
  .string()
  .min(passwordLength.min, {
    error: `The password needs at least ${passwordLength.min} characters.`,
  })
  .max(passwordLength.max, {
    error: `The password can have at most ${passwordLength.max} characters.`,
  });

export type ResetResult =
  { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "input"; message: string };

// Sets a new password through a reset link (SPEC-identity I5) and ends all the user's sessions.
// The caller sends them to sign in with it.
export async function resetPasswordWithLink(input: {
  token: string;
  password: string;
}): Promise<ResetResult> {
  // Checked before hashing, so requests with made-up tokens never cost a password hash.
  if (!(await findPendingPasswordReset(db(), input.token))) return { ok: false, reason: "invalid" };

  const password = Password.safeParse(input.password);
  if (!password.success) {
    return { ok: false, reason: "input", message: password.error.issues[0]!.message };
  }

  // Better Auth's own hasher, so sign-in verifies the password the usual way.
  const passwordHash = await (await auth().$context).password.hash(password.data);
  const result = await resetPassword(db(), { token: input.token, passwordHash });
  return result.ok ? { ok: true } : { ok: false, reason: "invalid" };
}
