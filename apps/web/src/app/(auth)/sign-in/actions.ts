"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth";

export type SignInState = { error?: string };

// One message for every failure, so the form never reveals whether an account exists.
const genericError = "Email or password is incorrect.";

const SignInForm = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(_state: SignInState, formData: FormData): Promise<SignInState> {
  const input = SignInForm.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.success) return { error: genericError };

  try {
    // nextCookies() sets the session cookie on the response.
    await auth().api.signInEmail({ body: input.data, headers: await headers() });
  } catch (error) {
    // Wrong password, unknown email, banned user: all look the same from outside.
    if (error instanceof APIError) return { error: genericError };
    throw error;
  }
  redirect("/money");
}
