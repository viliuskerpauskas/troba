"use client";

import { useActionState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updatePassword, type FormState } from "./actions";

export function PasswordForm({ minLength, maxLength }: { minLength: number; maxLength: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="newPassword">New password</FieldLabel>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby="newPasswordHint"
          required
        />
        <FieldDescription id="newPasswordHint">At least {minLength} characters.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          maxLength={maxLength}
          required
        />
      </Field>
      {state.error && <FormError>{state.error}</FormError>}
      {state.message && <FormStatus>{state.message}</FormStatus>}
      <Button type="submit" disabled={pending} className="self-start">
        Change password
      </Button>
    </form>
  );
}
