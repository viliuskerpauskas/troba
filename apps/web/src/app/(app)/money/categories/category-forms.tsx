"use client";

import { useActionState, useState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  type CategoryFormState,
} from "./actions";

export function CreateCategoryForm() {
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(
    createCategoryAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="category-name">Name</FieldLabel>
        <Input id="category-name" name="name" maxLength={100} required />
      </Field>
      {state.error && <FormError>{state.error}</FormError>}
      {state.message && <FormStatus>{state.message}</FormStatus>}
      <Button type="submit" disabled={pending} className="self-start">
        Add category
      </Button>
    </form>
  );
}

export function RenameCategoryForm({ categoryId, name }: { categoryId: string; name: string }) {
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(
    renameCategoryAction,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="categoryId" value={categoryId} />
      <Input
        name="name"
        defaultValue={name}
        aria-label={`Name of ${name}`}
        maxLength={100}
        required
        className="w-auto flex-1"
      />
      <Button type="submit" variant="outline" disabled={pending} aria-label={`Rename ${name}`}>
        Rename
      </Button>
      {state.error && <FormError className="basis-full">{state.error}</FormError>}
      {state.message && <FormStatus className="basis-full">{state.message}</FormStatus>}
    </form>
  );
}

export function DeleteCategory({ categoryId, name }: { categoryId: string; name: string }) {
  // Each swap unmounts the button pressed, so focus moves to its counterpart: Cancel, the safe
  // default, and back to Delete after cancelling.
  const [step, setStep] = useState<"idle" | "confirming" | "cancelled">("idle");

  if (step !== "confirming") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        autoFocus={step === "cancelled"}
        onClick={() => setStep("confirming")}
        aria-label={`Delete ${name}`}
        className="self-start"
      >
        Delete
      </Button>
    );
  }
  return (
    <form action={deleteCategoryAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="categoryId" value={categoryId} />
      <p role="alert" className="basis-full">
        Delete {name}? Its transactions become uncategorized.
      </p>
      <Button type="submit" variant="destructive" size="sm">
        Yes, delete
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        autoFocus
        onClick={() => setStep("cancelled")}
      >
        Cancel
      </Button>
    </form>
  );
}
