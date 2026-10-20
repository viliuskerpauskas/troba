"use server";

import { archiveAccount, createAccount, renameAccount, restoreAccount } from "@troba/core";
import { schema } from "@troba/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

export type AccountFormState = { error?: string; message?: string };

// React resets a form after its action, so a refused form gets back what was typed.
export type NewAccountValues = { name: string; type: string; currency: string; iban: string };
export type CreateAccountState = AccountFormState & { values?: NewAccountValues };

const currencies = new Set(Intl.supportedValuesOf("currency"));

const Name = z.string().trim().min(1).max(100);

const NewAccount = z.object({
  name: Name,
  type: z.enum(schema.accountTypes),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((code) => currencies.has(code)),
  // May contain spaces; parseIban removes them.
  iban: z.string().trim().max(64),
});

const AccountId = z.uuid();

const createErrors = {
  "invalid-iban": "That IBAN isn't valid. Check it for typos.",
  "iban-not-bank": "Only bank accounts have an IBAN.",
  "iban-taken": "You already have an account with that IBAN.",
} as const;

export async function createAccountAction(
  _state: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const { userId } = await requireUser();
  const values = {
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    currency: String(formData.get("currency") ?? ""),
    iban: String(formData.get("iban") ?? ""),
  };
  const input = NewAccount.safeParse(values);
  if (!input.success) {
    return { error: "Enter a name, an account type and a currency code such as EUR.", values };
  }

  const result = await createAccount(db(), userId, {
    ...input.data,
    iban: input.data.iban || null,
  });
  if (!result.ok) return { error: createErrors[result.reason], values };
  revalidatePath("/money/accounts");
  return { message: `Created ${result.account.name}.` };
}

export async function renameAccountAction(
  _state: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { userId } = await requireUser();
  const accountId = AccountId.safeParse(formData.get("accountId"));
  const name = Name.safeParse(formData.get("name"));
  if (!accountId.success) return { error: "That account doesn't exist." };
  if (!name.success) return { error: "Enter a name of up to 100 characters." };

  if (!(await renameAccount(db(), userId, { accountId: accountId.data, name: name.data }))) {
    return { error: "That account doesn't exist." };
  }
  revalidatePath("/money/accounts");
  return { message: "Saved." };
}

export async function archiveAccountAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const accountId = AccountId.safeParse(formData.get("accountId"));
  if (!accountId.success) return;

  await archiveAccount(db(), userId, { accountId: accountId.data });
  revalidatePath("/money/accounts");
}

export async function restoreAccountAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const accountId = AccountId.safeParse(formData.get("accountId"));
  if (!accountId.success) return;

  await restoreAccount(db(), userId, { accountId: accountId.data });
  revalidatePath("/money/accounts");
}
