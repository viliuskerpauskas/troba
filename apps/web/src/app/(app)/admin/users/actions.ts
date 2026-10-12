"use server";

import { assertNever, createPasswordReset, disableUser, enableUser } from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireAdmin } from "@/server/session";

export type UserActionState = { error?: string };
export type ResetLinkState = { link?: string; error?: string };

function userId(formData: FormData): string | null {
  const id = z.uuid().safeParse(formData.get("userId"));
  return id.success ? id.data : null;
}

export async function disableUserAction(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  const id = userId(formData);
  if (!id) return { error: "That user doesn't exist." };

  const result = await disableUser(db(), { userId: id, by: admin.userId });
  revalidatePath("/admin/users");
  if (result.ok) return {};
  switch (result.reason) {
    case "self":
      return { error: "You can't disable your own account." };
    case "last-admin":
      return { error: "This is the only active admin, so it can't be disabled." };
    case "not-found":
      return { error: "That user doesn't exist." };
    default:
      return assertNever(result.reason);
  }
}

export async function enableUserAction(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireAdmin();
  const id = userId(formData);
  const enabled = id !== null && (await enableUser(db(), { userId: id }));
  revalidatePath("/admin/users");
  return enabled ? {} : { error: "That user doesn't exist." };
}

export async function createResetLinkAction(
  _state: ResetLinkState,
  formData: FormData,
): Promise<ResetLinkState> {
  await requireAdmin();
  const id = userId(formData);
  const reset = id && (await createPasswordReset(db(), { userId: id }));
  if (!reset) return { error: "That user doesn't exist." };
  // Shown once: only the token's hash is stored, so the link can't be shown again later.
  return { link: new URL(`/reset/${reset.token}`, env().BETTER_AUTH_URL).toString() };
}
