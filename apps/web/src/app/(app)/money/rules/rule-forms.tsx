"use client";

import type { Category } from "@troba/core";
import { useActionState } from "react";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rule-field">When</FieldLabel>
          <NativeSelect
            // React resets a form after its action, and a select back to the value it mounted
            // with: remounting it keeps what the refused form had.
            key={`field-${values.field}`}
            id="rule-field"
            name="field"
            defaultValue={values.field ?? "counterparty"}
          >
            {Object.entries(fieldLabels).map(([field, label]) => (
              <NativeSelectOption key={field} value={field}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="rule-pattern">contains (any case)</FieldLabel>
          <Input
            key={`pattern-${values.pattern}`}
            id="rule-pattern"
            name="pattern"
            defaultValue={values.pattern}
            maxLength={200}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rule-category">Category</FieldLabel>
          <NativeSelect
            key={`category-${values.categoryId}`}
            id="rule-category"
            name="categoryId"
            defaultValue={values.categoryId ?? ""}
            required
          >
            <NativeSelectOption value="" disabled>
              Pick a category
            </NativeSelectOption>
            {categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {state.error && <FormError>{state.error}</FormError>}
        {state.message && <FormStatus>{state.message}</FormStatus>}
        <Button type="submit" disabled={pending} className="self-start">
          Add rule
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ApplyRules() {
  const [state, action, pending] = useActionState<ApplyRulesState, FormData>(applyRulesAction, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Apply rules to uncategorized
      </Button>
      {state.message && <FormStatus>{state.message}</FormStatus>}
    </form>
  );
}
