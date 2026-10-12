"use server";

import { createInvite, revokeInvite } from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireAdmin } from "@/server/session";

export type CreateInviteState = { link?: string; error?: string };

const Email = z.email().max(254);

export async function createInviteAction(
  _state: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const { userId } = await requireAdmin();
  // An empty field means an unbound invite: anyone with the link can sign up.
  const email = String(formData.get("email") ?? "").trim();
  if (email && !Email.safeParse(email).success) {
    return { error: "Enter a valid email address or leave it empty." };
  }

  const { token } = await createInvite(db(), { createdBy: userId, email: email || null });
  revalidatePath("/admin/invites");
  // Shown once: only the token's hash is stored, so the link can't be shown again later.
  return { link: new URL(`/invite/${token}`, env().BETTER_AUTH_URL).toString() };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  await revokeInvite(db(), { id: id.data });
  revalidatePath("/admin/invites");
}
