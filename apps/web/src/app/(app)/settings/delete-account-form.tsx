"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { deleteMyAccount, type FormState } from "./actions";

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteMyAccount, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <p id="deleteAccountWarning">
        This permanently deletes your account and all your data, including uploaded files. It
        can&apos;t be undone.
      </p>
      <Field>
        <FieldLabel htmlFor="confirmEmail" className="block [overflow-wrap:anywhere]">
          Type <strong>{email}</strong> to confirm
        </FieldLabel>
        <Input
          id="confirmEmail"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          aria-describedby="deleteAccountWarning"
          required
        />
      </Field>
      {state.error && <FormError>{state.error}</FormError>}
      <Button type="submit" variant="destructive" disabled={pending} className="self-start">
        Delete account
      </Button>
    </form>
  );
}
