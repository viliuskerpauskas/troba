"use client";

import { useActionState } from "react";
import { createInviteAction, type CreateInviteState } from "./actions";

export function CreateInviteForm() {
  const [state, action, pending] = useActionState<CreateInviteState, FormData>(
    createInviteAction,
    {},
  );

  return (
    <>
      <form action={action}>
        <p>
          <label htmlFor="invite-email">Email (optional)</label>
          <br />
          <input id="invite-email" name="email" type="email" aria-describedby="invite-email-hint" />
          <br />
          <small id="invite-email-hint">
            If set, only this email can sign up with the link. Invites expire after 7 days.
          </small>
        </p>
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={pending}>
          Create invite
        </button>
      </form>
      {state.link && (
        <p>
          <label htmlFor="invite-link">Invite link</label>
          <br />
          <input
            id="invite-link"
            readOnly
            value={state.link}
            style={{ width: "100%", boxSizing: "border-box" }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <br />
          <small>Copy it now and send it yourself. It won&apos;t be shown again.</small>
        </p>
      )}
    </>
  );
}
