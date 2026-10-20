"use client";

import { useActionState, useState } from "react";
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
    <form action={action}>
      <p>
        <label htmlFor="category-name">Name</label>
        <br />
        <input id="category-name" name="name" maxLength={100} required />
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        Add category
      </button>
    </form>
  );
}

export function RenameCategoryForm({ categoryId, name }: { categoryId: string; name: string }) {
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(
    renameCategoryAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="categoryId" value={categoryId} />
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

export function DeleteCategory({ categoryId, name }: { categoryId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete ${name}`}>
        Delete
      </button>
    );
  }
  return (
    <form action={deleteCategoryAction}>
      <input type="hidden" name="categoryId" value={categoryId} />
      <p role="alert">Delete {name}? Its transactions become uncategorized.</p>
      <button type="submit">Yes, delete</button>{" "}
      <button type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </form>
  );
}
