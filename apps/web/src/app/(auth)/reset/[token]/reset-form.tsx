"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { passwordLength } from "@/server/password-length";
import { setNewPassword, type ResetState } from "./actions";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    setNewPassword.bind(null, token),
    {},
  );

  if (state.done) {
    return (
      <FormStatus>
        Your password is set and you&apos;re signed out everywhere.{" "}
        <Link href="/sign-in">Sign in</Link> with the new password.
      </FormStatus>
    );
  }

  return (
    <form action={action}>
      {/* Lets password managers save the new password for the right account. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={passwordLength.min}
            maxLength={passwordLength.max}
            aria-describedby="password-hint"
            required
          />
          <FieldDescription id="password-hint">
            At least {passwordLength.min} characters.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={passwordLength.min}
            maxLength={passwordLength.max}
            required
          />
        </Field>
        {state.error && <FormError>{state.error}</FormError>}
        <Button type="submit" disabled={pending}>
          Set password
        </Button>
      </FieldGroup>
    </form>
  );
}
