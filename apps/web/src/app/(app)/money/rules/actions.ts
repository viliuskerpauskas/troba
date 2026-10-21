"use server";

import {
  applyRulesToUncategorized,
  createRule,
  deleteRule,
  moveRule,
  maxRules,
  ruleFields,
  ruleMoveDirections,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

// React resets a form after its action, so a refused form gets back what was typed.
export type RuleValues = { field?: string; pattern?: string; categoryId?: string };
export type RuleFormState = { error?: string; message?: string; values?: RuleValues };
export type ApplyRulesState = { message?: string };

const NewRule = z.object({
  field: z.enum(ruleFields),
  pattern: z.string().trim().min(1).max(200),
  categoryId: z.uuid(),
});

const RuleId = z.uuid();
const Direction = z.enum(ruleMoveDirections);

// Rules change categories, which the transaction list and the report show.
function revalidateRules() {
  revalidatePath("/money/rules");
  revalidatePath("/money/transactions");
  revalidatePath("/money/report");
}

export async function createRuleAction(
  _state: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  const { userId } = await requireUser();
  const values: RuleValues = {
    field: String(formData.get("field") ?? ""),
    pattern: String(formData.get("pattern") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
  };
  const input = NewRule.safeParse(values);
  if (!input.success) {
    return {
      error: "Pick a field and a category, and enter text of up to 200 characters.",
      values,
    };
  }

  const result = await createRule(db(), userId, input.data);
  if (!result.ok) {
    switch (result.reason) {
      case "empty-pattern":
        return { error: "Enter the text to look for.", values };
      case "category-not-found":
        return { error: "That category doesn't exist.", values };
      case "too-many-rules":
        return { error: `You have the most rules allowed (${maxRules}).`, values };
    }
  }
  revalidateRules();
  // Empty values, so a form pre-filled from a transaction doesn't offer the same rule again.
  return {
    message: "Rule added. Apply rules to put it to work on uncategorized transactions.",
    values: {},
  };
}

export async function moveRuleAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const ruleId = RuleId.safeParse(formData.get("ruleId"));
  const direction = Direction.safeParse(formData.get("direction"));
  if (!ruleId.success || !direction.success) return;

  await moveRule(db(), userId, { ruleId: ruleId.data, direction: direction.data });
  revalidatePath("/money/rules");
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const ruleId = RuleId.safeParse(formData.get("ruleId"));
  if (!ruleId.success) return;

  await deleteRule(db(), userId, { ruleId: ruleId.data });
  revalidatePath("/money/rules");
}

export async function applyRulesAction(): Promise<ApplyRulesState> {
  const { userId } = await requireUser();
  const categorized = await applyRulesToUncategorized(db(), userId);
  revalidateRules();
  return {
    message:
      categorized === 1 ? "Categorized 1 transaction." : `Categorized ${categorized} transactions.`,
  };
}
