"use client";

import type { Category } from "@troba/core";
import { useActionState } from "react";
import {
  applyRulesAction,
  createRuleAction,
  type ApplyRulesState,
  type RuleFormState,
  type RuleValues,
} from "./actions";
import { fieldLabels } from "./fields";

export function NewRuleForm({
  categories,
  initial,
}: {
  categories: Category[];
  // From "create rule from this" on a transaction.
  initial: RuleValues;
}) {
  const [state, action, pending] = useActionState<RuleFormState, FormData>(createRuleAction, {});
  const values = state.values ?? initial;

  return (
    <form action={action}>
      <p>
        <label htmlFor="rule-field">When</label>
        <br />
        <select
          // React resets a form after its action, and a select back to the value it mounted
          // with: remounting it keeps what the refused form had.
          key={`field-${values.field}`}
          id="rule-field"
          name="field"
          defaultValue={values.field ?? "counterparty"}
        >
          {Object.entries(fieldLabels).map(([field, label]) => (
            <option key={field} value={field}>
              {label}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="rule-pattern">contains (any case)</label>
        <br />
        <input
          key={`pattern-${values.pattern}`}
          id="rule-pattern"
          name="pattern"
          defaultValue={values.pattern}
          maxLength={200}
          required
        />
      </p>
      <p>
        <label htmlFor="rule-category">Category</label>
        <br />
        <select
          key={`category-${values.categoryId}`}
          id="rule-category"
          name="categoryId"
          defaultValue={values.categoryId ?? ""}
          required
        >
          <option value="" disabled>
            Pick a category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        Add rule
      </button>
    </form>
  );
}

export function ApplyRules() {
  const [state, action, pending] = useActionState<ApplyRulesState, FormData>(applyRulesAction, {});

  return (
    <form action={action}>
      <button type="submit" disabled={pending}>
        Apply rules to uncategorized
      </button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
