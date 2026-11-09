"use server";

import { setAiCategorization } from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

// The user's own switch for AI-suggested transaction categories (ADR-0016). It always acts on the
// signed-in user; nothing in the form says whose setting it is.

export type AiCategorizationState = { message?: string };

// A checked box posts "on"; an unchecked one posts nothing.
const Enabled = z.literal("on");

export async function updateAiCategorization(
  _state: AiCategorizationState,
  formData: FormData,
): Promise<AiCategorizationState> {
  const { userId } = await requireUser();
  const enabled = Enabled.safeParse(formData.get("enabled")).success;
  await setAiCategorization(db(), userId, enabled);
  // The transactions list shows or hides the button by this setting.
  revalidatePath("/money/transactions");
  return {
    message: enabled ? "AI suggestions are on." : "AI suggestions are off. Nothing is sent.",
  };
}
