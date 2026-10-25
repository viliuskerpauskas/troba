"use client";

import { useActionState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { OneTimeLink } from "../one-time-link";
import {
  createResetLinkAction,
  disableUserAction,
  enableUserAction,
  type ResetLinkState,
  type UserActionState,
} from "./actions";

// Each action button is described by its user's email (emailId, the element that shows it), so a
// screen reader's list of buttons can tell one user's "Disable" from another's.
export function DisableToggle({
  userId,
  emailId,
  disabled,
}: {
  userId: string;
  emailId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(
    disabled ? enableUserAction : disableUserAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} aria-describedby={emailId}>
        {disabled ? "Enable" : "Disable"}
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
    </form>
  );
}

// The page renders this element after the users list.
export const resetLinksContainerId = "reset-links";

// The container is in the document once the page has hydrated. A server render (a form sent
// before hydration) and the first client render of a fresh page have none, so the link then
// shows in its item. Nothing to subscribe to: each render looks again.
const noSubscription = () => () => {};
const findContainer = () => document.getElementById(resetLinksContainerId);
const noContainer = () => null;

export function ResetLinkForm({
  userId,
  email,
  emailId,
}: {
  userId: string;
  email: string;
  emailId: string;
}) {
  const [state, action, pending] = useActionState<ResetLinkState, FormData>(
    createResetLinkAction,
    {},
  );
  const container = useSyncExternalStore(noSubscription, findContainer, noContainer);
  // Keyed on the link, so a new link mounts afresh and takes focus again.
  const link = state.link && (
    <OneTimeLink
      key={state.link}
      id={`reset-link-${userId}`}
      label={`Reset link for ${email}`}
      link={state.link}
      hint="Copy it now and send it yourself. It works once, for 1 hour. Creating a new link replaces this one."
      autoFocus
    />
  );

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} aria-describedby={emailId}>
        Create reset link
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
      {/* Below the list, not in the user's item, where it has the page's full width. Focus moves
          to it, out of the item's sight. */}
      {container && link ? createPortal(link, container) : link}
    </form>
  );
}
