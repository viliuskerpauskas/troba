import { beginSignInAttempt, signInSucceeded } from "@troba/core";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "./auth";
import { clientIp } from "./client-ip";
import { db } from "./db";

// Email and password sign-in (SPEC-identity I3). Inside a server action, nextCookies() sets the
// session cookie on the response.

// "invalid" covers a wrong password, an unknown email and a banned user alike, so the answer never
// reveals whether an account exists. "limited" is given for unknown emails too.
export type SignInResult = { ok: true } | { ok: false; reason: "invalid" | "limited" };

const Input = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signInWithPassword(
  requestHeaders: Headers,
  input: { email: string; password: string },
): Promise<SignInResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  // Checked first, so a refused attempt never reaches the password check.
  const attempt = await beginSignInAttempt(db(), {
    email: parsed.data.email,
    ipAddress: clientIp(requestHeaders),
  });
  if (!attempt) return { ok: false, reason: "limited" };

  try {
    await auth().api.signInEmail({ body: parsed.data, headers: requestHeaders });
  } catch (error) {
    if (error instanceof APIError) return { ok: false, reason: "invalid" };
    throw error;
  }
  await signInSucceeded(db(), attempt);
  return { ok: true };
}
