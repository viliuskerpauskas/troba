"use client";

import { useActionState, useState } from "react";
import {
  createTransactionAction,
  deleteTransactionAction,
  updateTransactionAction,
  type TransactionFormState,
  type TransactionValues,
} from "./actions";

type Option = { id: string; name: string };

type Props = {
  accounts: (Option & { currency: string })[];
  categories: Option[];
  // What the form starts with: today's date for a new one, the transaction's values when editing.
  initial: TransactionValues;
} & (
  | { mode: "new" }
  // An imported transaction shows only its category and note.
  | { mode: "edit"; transactionId: string; imported: boolean }
);

export function TransactionForm(props: Props) {
  const [state, action, pending] = useActionState<TransactionFormState, FormData>(
    props.mode === "new" ? createTransactionAction : updateTransactionAction,
    {},
  );
  const values = { ...props.initial, ...state.values };
  const withDetails = props.mode === "new" || !props.imported;

  return (
    <form action={action}>
      {props.mode === "edit" && (
        <input type="hidden" name="transactionId" value={props.transactionId} />
      )}
      {withDetails && (
        <>
          <p>
            <label htmlFor="tx-account">Account</label>
            <br />
            <select
              // React resets a form after its action, and a select back to the value it mounted
              // with: remounting it keeps what the refused form had.
              key={values.accountId}
              id="tx-account"
              name="accountId"
              defaultValue={values.accountId}
              required
            >
              {props.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="tx-date">Date</label>
            <br />
            <input
              id="tx-date"
              name="bookedOn"
              type="date"
              defaultValue={values.bookedOn}
              required
            />
          </p>
          <fieldset>
            <legend>Direction</legend>
            {(["expense", "income"] as const).map((direction) => (
              <label key={direction}>
                <input
                  type="radio"
                  name="direction"
                  value={direction}
                  defaultChecked={(values.direction ?? "expense") === direction}
                />{" "}
                {direction === "expense" ? "Expense" : "Income"}{" "}
              </label>
            ))}
          </fieldset>
          <p>
            <label htmlFor="tx-amount">Amount</label>
            <br />
            <input
              id="tx-amount"
              name="amount"
              defaultValue={values.amount}
              inputMode="decimal"
              autoComplete="off"
              maxLength={32}
              size={12}
              required
              aria-describedby="tx-amount-hint"
            />
            <br />
            <small id="tx-amount-hint">Without a sign, such as 12.50.</small>
          </p>
          <p>
            <label htmlFor="tx-counterparty">Counterparty (optional)</label>
            <br />
            <input
              id="tx-counterparty"
              name="counterparty"
              defaultValue={values.counterparty}
              maxLength={200}
              size={24}
            />
          </p>
          <p>
            <label htmlFor="tx-description">Description (optional)</label>
            <br />
            <input
              id="tx-description"
              name="description"
              defaultValue={values.description}
              maxLength={500}
              size={24}
            />
          </p>
        </>
      )}
      <p>
        <label htmlFor="tx-category">Category</label>
        <br />
        <select
          key={values.categoryId}
          id="tx-category"
          name="categoryId"
          defaultValue={values.categoryId ?? ""}
        >
          <option value="">Uncategorized</option>
          {props.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="tx-note">Note (optional)</label>
        <br />
        <textarea id="tx-note" name="note" defaultValue={values.note} maxLength={1000} rows={2} />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {props.mode === "new" ? "Add transaction" : "Save"}
      </button>
    </form>
  );
}

// Deleting asks first: a second button confirms.
export function DeleteTransaction({ transactionId }: { transactionId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }
  return (
    <form action={deleteTransactionAction}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <p role="alert">Delete this transaction? This can&apos;t be undone.</p>
      <button type="submit">Yes, delete</button>{" "}
      <button type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </form>
  );
}
