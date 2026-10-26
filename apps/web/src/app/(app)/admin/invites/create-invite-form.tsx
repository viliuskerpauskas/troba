"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OneTimeLink } from "../one-time-link";
import { createInviteAction, type CreateInviteState } from "./actions";

export function CreateInviteForm() {
  const [state, action, pending] = useActionState<CreateInviteState, FormData>(
    createInviteAction,
    {},
  );

  return (
    <FieldGroup>
      <form action={action} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="invite-email">Email (optional)</FieldLabel>
          <Input id="invite-email" name="email" type="email" aria-describedby="invite-email-hint" />
          <FieldDescription id="invite-email-hint">
            If set, only this email can sign up with the link. Invites expire after 7 days.
          </FieldDescription>
        </Field>
        {state.error && <FormError>{state.error}</FormError>}
        <Button type="submit" disabled={pending} className="self-start">
          Create invite
        </Button>
      </form>
      {state.link && (
        <OneTimeLink
          id="invite-link"
          label="Invite link"
          link={state.link}
          hint="Copy it now and send it yourself. It won't be shown again."
        />
      )}
    </FieldGroup>
  );
}
