"use server";

import { signInLimit } from "@troba/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInWithPassword, type SignInResult } from "@/server/sign-in";

export type SignInState = { error?: string };

const errors = {
  // One message for every failure, so the form never reveals whether an account exists.
  invalid: "Email or password is incorrect.",
  limited: `Too many failed sign-ins. Wait ${signInLimit.windowMinutes} minutes and try again.`,
} satisfies Record<Extract<SignInResult, { ok: false }>["reason"], string>;

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export async function signIn(_state: SignInState, formData: FormData): Promise<SignInState> {
  const result = await signInWithPassword(await headers(), {
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!result.ok) return { error: errors[result.reason] };
  redirect("/money");
}
