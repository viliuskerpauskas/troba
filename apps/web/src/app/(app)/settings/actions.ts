"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  AccountInputError,
  changeName,
  changePassword,
  revokeSession,
  signOutEverywhere,
} from "@/server/account";
import { authHeaders, requireUser } from "@/server/session";

export type FormState = { error?: string; message?: string };

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

async function asFormState(action: () => Promise<unknown>, message: string): Promise<FormState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AccountInputError) return { error: error.message };
    throw error;
  }
  refresh();
  return { message };
}

export async function updateName(_state: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const requestHeaders = await authHeaders();
  return asFormState(() => changeName(requestHeaders, text(formData, "name")), "Name saved.");
}

export async function updatePassword(_state: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const newPassword = text(formData, "newPassword");
  if (newPassword !== text(formData, "confirmPassword")) {
    return { error: "The new passwords don't match." };
  }
  const requestHeaders = await authHeaders();
  return asFormState(
    () =>
      changePassword(requestHeaders, {
        currentPassword: text(formData, "currentPassword"),
        newPassword,
      }),
    "Password changed. Your other devices are signed out.",
  );
}

export async function revoke(formData: FormData) {
  await requireUser();
  await revokeSession(await authHeaders(), text(formData, "sessionId"));
  refresh();
}

export async function signOutAll() {
  await requireUser();
  await signOutEverywhere(await authHeaders());
  redirect("/sign-in");
}
