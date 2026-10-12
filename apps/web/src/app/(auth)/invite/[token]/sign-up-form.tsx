"use client";

import { useActionState } from "react";
import { passwordLength } from "@/server/password-length";
import { signUp, type SignUpState } from "./actions";

export function SignUpForm({ token, email }: { token: string; email: string | null }) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(
    signUp.bind(null, token),
    {},
  );

  return (
    <form action={action}>
      <p>
        <label htmlFor="name">Name</label>
        <br />
        <input id="name" name="name" autoComplete="name" maxLength={100} required />
      </p>
      <p>
        <label htmlFor="email">Email</label>
        <br />
        {/* A bound invite's email is fixed; the server ignores whatever is submitted. */}
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email ?? undefined}
          readOnly={email !== null}
          required
        />
      </p>
      <p>
        <label htmlFor="password">Password</label>
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
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        Create account
      </button>
    </form>
  );
}
