"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
      <FieldGroup>
        {withDetails && (
          <>
            <Field>
              <FieldLabel htmlFor="tx-account">Account</FieldLabel>
              <NativeSelect
                // React resets a form after its action, and a select back to the value it mounted
                // with: remounting it keeps what the refused form had.
                key={values.accountId}
                id="tx-account"
                name="accountId"
                defaultValue={values.accountId}
                required
              >
                {props.accounts.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="tx-date">Date</FieldLabel>
              <Input
                id="tx-date"
                name="bookedOn"
                type="date"
                defaultValue={values.bookedOn}
                required
                className="w-auto"
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Direction</FieldLegend>
              <div className="flex gap-6">
                {(["expense", "income"] as const).map((direction) => (
                  <label key={direction} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="direction"
                      value={direction}
                      defaultChecked={(values.direction ?? "expense") === direction}
                      className="size-4 accent-primary"
                    />
                    {direction === "expense" ? "Expense" : "Income"}
                  </label>
                ))}
              </div>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="tx-amount">Amount</FieldLabel>
              <Input
                id="tx-amount"
                name="amount"
                defaultValue={values.amount}
                inputMode="decimal"
                autoComplete="off"
                maxLength={32}
                required
                aria-describedby="tx-amount-hint"
                className="w-40"
              />
              <FieldDescription id="tx-amount-hint">
                Without a sign, such as 12.50.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="tx-counterparty">Counterparty (optional)</FieldLabel>
              <Input
                id="tx-counterparty"
                name="counterparty"
                defaultValue={values.counterparty}
                maxLength={200}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tx-description">Description (optional)</FieldLabel>
              <Input
                id="tx-description"
                name="description"
                defaultValue={values.description}
                maxLength={500}
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="tx-category">Category</FieldLabel>
          <NativeSelect
            key={values.categoryId}
            id="tx-category"
            name="categoryId"
            defaultValue={values.categoryId ?? ""}
          >
            <NativeSelectOption value="">Uncategorized</NativeSelectOption>
            {props.categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="tx-note">Note (optional)</FieldLabel>
          <Textarea id="tx-note" name="note" defaultValue={values.note} maxLength={1000} rows={2} />
        </Field>
        {state.error && <FormError>{state.error}</FormError>}
        <Button type="submit" disabled={pending} className="self-start">
          {props.mode === "new" ? "Add transaction" : "Save"}
        </Button>
      </FieldGroup>
    </form>
  );
}

// Deleting asks first: a second button confirms.
export function DeleteTransaction({ transactionId }: { transactionId: string }) {
  // Each swap unmounts the button pressed, so focus moves to its counterpart: Cancel, the safe
  // default, and back to Delete after cancelling.
  const [step, setStep] = useState<"idle" | "confirming" | "cancelled">("idle");

  if (step !== "confirming") {
    return (
      <Button
        type="button"
        variant="outline"
        autoFocus={step === "cancelled"}
        onClick={() => setStep("confirming")}
        className="self-start"
      >
        Delete
      </Button>
    );
  }
  return (
    <form action={deleteTransactionAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="transactionId" value={transactionId} />
      <p role="alert" className="basis-full">
        Delete this transaction? This can&apos;t be undone.
      </p>
      <Button type="submit" variant="destructive">
        Yes, delete
      </Button>
      <Button type="button" variant="outline" autoFocus onClick={() => setStep("cancelled")}>
        Cancel
      </Button>
    </form>
  );
}
