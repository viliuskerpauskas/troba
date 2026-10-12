"use client";

import { useActionState } from "react";
import {
  createResetLinkAction,
  disableUserAction,
  enableUserAction,
  type ResetLinkState,
  type UserActionState,
} from "./actions";

export function DisableToggle({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(
    disabled ? enableUserAction : disableUserAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending}>
        {disabled ? "Enable" : "Disable"}
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
    </form>
  );
}

export function ResetLinkForm({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState<ResetLinkState, FormData>(
    createResetLinkAction,
    {},
  );
  const linkId = `reset-link-${userId}`;

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending}>
        Create reset link
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
      {state.link && (
        <>
          <br />
          <label htmlFor={linkId}>Reset link for {email}</label>
          <br />
          <input
            id={linkId}
            readOnly
            value={state.link}
            size={state.link.length}
            onFocus={(event) => event.currentTarget.select()}
          />
          <br />
          <small>Copy it now and send it yourself. It works once, for 1 hour.</small>
        </>
      )}
    </form>
  );
}
