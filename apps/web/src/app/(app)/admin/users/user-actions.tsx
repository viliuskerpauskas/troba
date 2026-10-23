"use client";

import { useActionState } from "react";
import { createPortal } from "react-dom";
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

// The page renders this element after the users table.
export const resetLinksId = "reset-links";

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
      {/* Below the table, not in the row: the table is wider than a phone screen, and the link
          must fit it. The link only exists after the action runs in the browser, so document
          is there. */}
      {state.link &&
        createPortal(
          <p>
            <label htmlFor={linkId}>Reset link for {email}</label>
            <br />
            <input
              id={linkId}
              readOnly
              value={state.link}
              style={{ width: "100%", boxSizing: "border-box" }}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
            />
            <br />
            <small>
              Copy it now and send it yourself. It works once, for 1 hour. Creating a new link
              replaces this one.
            </small>
          </p>,
          document.getElementById(resetLinksId)!,
        )}
    </form>
  );
}
