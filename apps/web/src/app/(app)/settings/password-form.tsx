"use client";

import { useActionState } from "react";
import { updatePassword, type FormState } from "./actions";

export function PasswordForm({ minLength, maxLength }: { minLength: number; maxLength: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});

  return (
    // Keyed on the outcome so the fields clear after a successful change.
    <form action={action} key={state.message}>
      <p>
        <label htmlFor="currentPassword">Current password</label>
        <br />
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </p>
      <p>
        <label htmlFor="newPassword">New password</label>
        <br />
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby="newPasswordHint"
          required
        />
        <br />
        <small id="newPasswordHint">At least {minLength} characters.</small>
      </p>
      <p>
        <label htmlFor="confirmPassword">Confirm new password</label>
        <br />
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          maxLength={maxLength}
          required
        />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        Change password
      </button>
    </form>
  );
}
