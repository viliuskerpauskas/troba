"use server";

import {
  createTransaction,
  deleteTransaction,
  directions,
  parseTypedCents,
  updateTransaction,
  type TransactionDetails,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

// React resets a form after its action, so a refused form gets back what was typed.
export type TransactionValues = Partial<Record<(typeof fields)[number], string>>;
export type TransactionFormState = { error?: string; values?: TransactionValues };

const fields = [
  "accountId",
  "bookedOn",
  "amount",
  "direction",
  "counterparty",
  "description",
  "categoryId",
  "note",
] as const;

// Unsigned: the direction gives the sign.
const Amount = z
  .string()
  .max(32)
  .transform(parseTypedCents)
  .refine((cents) => cents !== null && cents > 0n)
  .transform((cents) => cents!);

const OptionalText = (max: number) => z.string().trim().max(max);

const Details = z.object({
  accountId: z.uuid(),
  bookedOn: z.iso.date(),
  amount: Amount,
  direction: z.enum(directions),
  counterparty: OptionalText(200),
  description: OptionalText(500),
});

const Classification = z.object({
  // "" is uncategorized.
  categoryId: z.union([z.uuid(), z.literal("")]).transform((id) => id || null),
  note: OptionalText(1000),
});

const TransactionId = z.uuid();

const detailsError =
  "Pick an account, enter a date and an amount above zero, such as 12.50, with at most two decimals.";
const reasonErrors = {
  "not-found": "That transaction doesn't exist.",
  imported: "An imported transaction's date, amount and counterparty can't be changed.",
  "account-not-found": "Pick one of your accounts.",
  "category-not-found": "Pick one of your categories.",
} as const;

function valuesOf(formData: FormData): TransactionValues {
  return Object.fromEntries(
    fields.filter((field) => formData.has(field)).map((f) => [f, String(formData.get(f))]),
  );
}

function toDetails(details: z.infer<typeof Details>): TransactionDetails {
  const { amount, ...rest } = details;
  return { ...rest, amountCents: amount };
}

export async function createTransactionAction(
  _state: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { userId } = await requireUser();
  const values = valuesOf(formData);
  const details = Details.safeParse(values);
  if (!details.success) return { error: detailsError, values };
  const classification = Classification.safeParse(values);
  if (!classification.success) return { error: reasonErrors["category-not-found"], values };

  const result = await createTransaction(db(), userId, {
    ...toDetails(details.data),
    ...classification.data,
  });
  if (!result.ok) return { error: reasonErrors[result.reason], values };
  revalidatePath("/money/transactions");
  redirect("/money/transactions");
}

// An imported transaction's form has no details, only the category and note.
export async function updateTransactionAction(
  _state: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { userId } = await requireUser();
  const values = valuesOf(formData);
  const transactionId = TransactionId.safeParse(formData.get("transactionId"));
  if (!transactionId.success) return { error: reasonErrors["not-found"], values };
  let details: TransactionDetails | undefined;
  if (formData.has("amount")) {
    const parsed = Details.safeParse(values);
    if (!parsed.success) return { error: detailsError, values };
    details = toDetails(parsed.data);
  }
  const classification = Classification.safeParse(values);
  if (!classification.success) return { error: reasonErrors["category-not-found"], values };

  const result = await updateTransaction(db(), userId, {
    transactionId: transactionId.data,
    details,
    ...classification.data,
  });
  if (!result.ok) return { error: reasonErrors[result.reason], values };
  revalidatePath("/money/transactions");
  redirect("/money/transactions");
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const transactionId = TransactionId.safeParse(formData.get("transactionId"));
  if (transactionId.success) {
    await deleteTransaction(db(), userId, { transactionId: transactionId.data });
  }
  revalidatePath("/money/transactions");
  redirect("/money/transactions");
}
