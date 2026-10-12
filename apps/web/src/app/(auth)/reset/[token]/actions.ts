"use server";

import { redirect } from "next/navigation";
import { resetPasswordWithLink } from "@/server/password-reset";

export type ResetState = { error?: string; done?: boolean };

export async function setNewPassword(
  token: string,
  _state: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const password = formData.get("password");
  const confirm = formData.get("confirmPassword");
  if (password !== confirm) return { error: "The passwords don't match." };

  const result = await resetPasswordWithLink({
    token,
    password: typeof password === "string" ? password : "",
  });
  if (result.ok) return { done: true };
  switch (result.reason) {
    case "input":
      return { error: result.message };
    case "invalid":
      // Used or expired since the page loaded: show the invalid-link page.
      redirect(`/reset/${encodeURIComponent(token)}`);
  }
}
