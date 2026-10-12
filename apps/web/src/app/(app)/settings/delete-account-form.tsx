"use client";

import { useActionState } from "react";
import { deleteMyAccount, type FormState } from "./actions";

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteMyAccount, {});

  return (
    <form action={action}>
      <p id="deleteAccountWarning">
        This permanently deletes your account and all your data, including uploaded files. It
        can&apos;t be undone.
      </p>
      <p>
        <label htmlFor="confirmEmail">
          Type <strong>{email}</strong> to confirm
        </label>
        <br />
        <input
          id="confirmEmail"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          aria-describedby="deleteAccountWarning"
          required
        />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        Delete account
      </button>
    </form>
  );
}
