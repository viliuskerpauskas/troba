"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { passwordLength } from "@/server/password-length";
import { signUp, type SignUpState } from "./actions";

export function SignUpForm({ token, email }: { token: string; email: string | null }) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(
    signUp.bind(null, token),
    {},
  );

  return (
    <form action={action}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" name="name" autoComplete="name" maxLength={100} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          {/* A bound invite's email is fixed; the server ignores whatever is submitted. */}
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={email ?? undefined}
            readOnly={email !== null}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
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
        {state.error && <FormError>{state.error}</FormError>}
        <Button type="submit" disabled={pending}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
