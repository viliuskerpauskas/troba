"use client";

import { useActionState } from "react";
import { updateName, type FormState } from "./actions";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateName, {});

  return (
    <form action={action}>
      <p>
        <label htmlFor="name">Name</label>
        <br />
        <input
          id="name"
          name="name"
          defaultValue={name}
          autoComplete="name"
          maxLength={100}
          required
        />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        Save name
      </button>
    </form>
  );
}
