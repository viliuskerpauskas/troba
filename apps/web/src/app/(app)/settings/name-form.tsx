"use client";

import { useActionState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateName, type FormState } from "./actions";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateName, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input
          id="name"
          name="name"
          defaultValue={name}
          autoComplete="name"
          maxLength={100}
          required
        />
      </Field>
      {state.error && <FormError>{state.error}</FormError>}
      {state.message && <FormStatus>{state.message}</FormStatus>}
      <Button type="submit" disabled={pending} className="self-start">
        Save name
      </Button>
    </form>
  );
}
