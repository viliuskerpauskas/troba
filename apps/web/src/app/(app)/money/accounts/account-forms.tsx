"use client";

import { useActionState } from "react";
import {
  createAccountAction,
  renameAccountAction,
  type AccountFormState,
  type CreateAccountState,
} from "./actions";

export function CreateAccountForm() {
  const [state, action, pending] = useActionState<CreateAccountState, FormData>(
    createAccountAction,
    {},
  );
  const values = state.values;

  return (
    <form action={action}>
      <p>
        <label htmlFor="account-name">Name</label>
        <br />
        <input id="account-name" name="name" defaultValue={values?.name} maxLength={100} required />
      </p>
      <p>
        <label htmlFor="account-type">Type</label>
        <br />
        <select id="account-type" name="type" defaultValue={values?.type ?? "bank"}>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </p>
      <p>
        <label htmlFor="account-currency">Currency</label>
        <br />
        <input
          id="account-currency"
          name="currency"
          defaultValue={values?.currency ?? "EUR"}
          maxLength={3}
          size={4}
          autoCapitalize="characters"
          required
        />
      </p>
      <p>
        <label htmlFor="account-iban">IBAN (optional)</label>
        <br />
        <input
          id="account-iban"
          name="iban"
          defaultValue={values?.iban}
          maxLength={64}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="account-iban-hint"
        />
        <br />
        <small id="account-iban-hint">
          Bank accounts only. Imports use it to find the account.
        </small>
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        Create account
      </button>
    </form>
  );
}

export function RenameAccountForm({ accountId, name }: { accountId: string; name: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    renameAccountAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="accountId" value={accountId} />
      <input
        name="name"
        defaultValue={name}
        aria-label={`Name of ${name}`}
        maxLength={100}
        required
      />{" "}
      <button type="submit" disabled={pending} aria-label={`Rename ${name}`}>
        Rename
      </button>
      {state.error && <span role="alert"> {state.error}</span>}
      {state.message && <span role="status"> {state.message}</span>}
    </form>
  );
}
