"use client";

import { useActionState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  createAccountAction,
  renameAccountAction,
  type AccountFormState,
  type CreateAccountState,
} from "./actions";

export function CreateAccountForm() {
  const [state, action, pending] = useActionState<CreateAccountState, FormData>(
    createAccountAction,
    {},
  );
  const values = state.values;

  return (
    <form action={action}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-name">Name</FieldLabel>
          <Input
            id="account-name"
            name="name"
            defaultValue={values?.name}
            maxLength={100}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="account-type">Type</FieldLabel>
          <NativeSelect id="account-type" name="type" defaultValue={values?.type ?? "bank"}>
            <NativeSelectOption value="bank">Bank</NativeSelectOption>
            <NativeSelectOption value="cash">Cash</NativeSelectOption>
            <NativeSelectOption value="other">Other</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="account-currency">Currency</FieldLabel>
          <Input
            id="account-currency"
            name="currency"
            defaultValue={values?.currency ?? "EUR"}
            maxLength={3}
            autoCapitalize="characters"
            required
            className="max-w-20"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="account-iban">IBAN (optional)</FieldLabel>
          <Input
            id="account-iban"
            name="iban"
            defaultValue={values?.iban}
            maxLength={64}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="account-iban-hint"
          />
          <FieldDescription id="account-iban-hint">
            Bank accounts only. Imports use it to find the account.
          </FieldDescription>
        </Field>
        {state.error && <FormError>{state.error}</FormError>}
        {state.message && <FormStatus>{state.message}</FormStatus>}
        <Button type="submit" disabled={pending} className="self-start">
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}

export function RenameAccountForm({ accountId, name }: { accountId: string; name: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    renameAccountAction,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <Input
        name="name"
        defaultValue={name}
        aria-label={`Name of ${name}`}
        maxLength={100}
        required
        className="w-auto flex-1"
      />
      <Button type="submit" variant="outline" disabled={pending} aria-label={`Rename ${name}`}>
        Rename
      </Button>
      {state.error && <FormError className="basis-full">{state.error}</FormError>}
      {state.message && <FormStatus className="basis-full">{state.message}</FormStatus>}
    </form>
  );
}
