"use client";

import Link from "next/link";
import { useActionState } from "react";
import { passwordLength } from "@/server/password-length";
import { setNewPassword, type ResetState } from "./actions";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    setNewPassword.bind(null, token),
    {},
  );

  if (state.done) {
    return (
      <p role="status">
        Your password is set and you&apos;re signed out everywhere.{" "}
        <Link href="/sign-in">Sign in</Link> with the new password.
      </p>
    );
  }

  return (
    <form action={action}>
      {/* Lets password managers save the new password for the right account. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <p>
        <label htmlFor="password">New password</label>
        <br />
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={passwordLength.min}
          maxLength={passwordLength.max}
          aria-describedby="password-hint"
          required
        />
        <br />
        <small id="password-hint">At least {passwordLength.min} characters.</small>
      </p>
      <p>
        <label htmlFor="confirmPassword">Confirm new password</label>
        <br />
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={passwordLength.min}
          maxLength={passwordLength.max}
          required
        />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        Set password
      </button>
    </form>
  );
}
