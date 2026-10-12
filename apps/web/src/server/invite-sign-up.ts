import { findPendingInvite, redeemInvite, type RedeemResult } from "@troba/core";
import { z } from "zod";
import { auth, passwordLength } from "./auth";
import { db } from "./db";

const Input = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Enter your name." })
    .max(100, { error: "The name can have at most 100 characters." }),
  password: z
    .string()
    .min(passwordLength.min, {
      error: `The password needs at least ${passwordLength.min} characters.`,
    })
    .max(passwordLength.max, {
      error: `The password can have at most ${passwordLength.max} characters.`,
    }),
});

const Email = z.email({ error: "Enter a valid email address." });

export type SignUpResult = RedeemResult | { ok: false; reason: "input"; message: string };

function inputError(error: z.ZodError): SignUpResult {
  return { ok: false, reason: "input", message: error.issues[0]!.message };
}

// Signs up a new user through an invite (SPEC-identity I2). The caller signs them in afterwards.
export async function signUpWithInvite(input: {
  token: string;
  name: string;
  email: string;
  password: string;
}): Promise<SignUpResult> {
  // Checked before hashing, so requests with made-up tokens never cost a password hash.
  const invite = await findPendingInvite(db(), input.token);
  if (!invite) return { ok: false, reason: "invalid" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return inputError(parsed.error);
  // A bound invite signs up its own email, so the submitted one only matters when unbound.
  if (!invite.email) {
    const email = Email.safeParse(input.email.trim());
    if (!email.success) return inputError(email.error);
  }

  // Better Auth's own hasher, so sign-in verifies the password the usual way.
  const passwordHash = await (await auth().$context).password.hash(parsed.data.password);
  return redeemInvite(db(), {
    token: input.token,
    name: parsed.data.name,
    email: input.email,
    passwordHash,
  });
}
