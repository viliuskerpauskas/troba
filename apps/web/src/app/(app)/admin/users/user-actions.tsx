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

// The page renders this element after the users list.
export const resetLinksContainerId = "reset-links";

// The container is in the document once the page has hydrated. A server render (a form sent
// before hydration) and the first client render of a fresh page have none, so the link then
// shows in its item. Nothing to subscribe to: each render looks again.
const noSubscription = () => () => {};
const findContainer = () => document.getElementById(resetLinksContainerId);
const noContainer = () => null;

export function ResetLinkForm({ userId, email }: { userId: string; email: string }) {
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
      <button type="submit" disabled={pending}>
        Create reset link
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
      {/* Below the list, not in the user's item, where it has the page's full width. Focus moves
          to it, out of the item's sight. */}
      {container && link ? createPortal(link, container) : link}
    </form>
  );
}
