"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { signUpWithInvite } from "@/server/invite-sign-up";

export type SignUpState = { error?: string };

export async function signUp(
  token: string,
  _state: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const password = String(formData.get("password") ?? "");
  const result = await signUpWithInvite({
    token,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "input":
        return { error: result.message };
      case "email-taken":
        return { error: "An account with this email already exists. Sign in instead." };
      case "invalid":
        // Used, revoked or expired since the page loaded: show the invalid-invite page.
        redirect(`/invite/${encodeURIComponent(token)}`);
    }
  }

  try {
    // nextCookies() sets the session cookie on the response.
    await auth().api.signInEmail({
      body: { email: result.email, password },
      headers: await headers(),
    });
  } catch (error) {
    // The account exists and the invite is used up, so a retry here would hit the
    // invalid-invite page. Send them to sign in with the password they just chose.
    if (error instanceof APIError) redirect("/sign-in");
    throw error;
  }
  redirect("/money");
}
