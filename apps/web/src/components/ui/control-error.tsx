"use client";

import { useId, useState, type ChangeEvent, type SyntheticEvent } from "react";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type ControlProps<T extends Control> = {
  onInvalid?: (event: SyntheticEvent<T>) => void;
  onChange?: (event: ChangeEvent<T>) => void;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  "aria-describedby"?: string;
};

// Shows a control's native validation message (required, type, min, pattern…) as text under it,
// in place of the browser's bubble. The message updates as the value changes and goes once the
// value is valid. Spread `controlProps` over the control's own props and render `error` after it.
export function useControlError<T extends Control>(props: ControlProps<T>) {
  const [message, setMessage] = useState("");
  const errorId = useId();

  const describedBy =
    [props["aria-describedby"], message && errorId].filter(Boolean).join(" ") || undefined;

  const controlProps = {
    "aria-invalid": props["aria-invalid"] ?? (message ? true : undefined),
    "aria-describedby": describedBy,
    onInvalid(event: SyntheticEvent<T>) {
      props.onInvalid?.(event);
      // Cancelling the event is what stops the bubble; the browser then focuses nothing either,
      // so move focus to the form's first invalid control ourselves.
      event.preventDefault();
      const control = event.currentTarget;
      setMessage(control.validationMessage);
      const first = Array.from(control.form?.elements ?? []).find(
        (element): element is Control =>
          "willValidate" in element &&
          (element as Control).willValidate &&
          !(element as Control).validity.valid,
      );
      if (first === control) control.focus();
    },
    onChange(event: ChangeEvent<T>) {
      props.onChange?.(event);
      if (message) setMessage(event.currentTarget.validationMessage);
    },
  };

  const error = message ? (
    // order-last and w-full put it on its own line under the control, in a Field column and in an
    // inline flex-wrap form alike.
    <p
      id={errorId}
      data-slot="control-error"
      className="order-last w-full text-sm font-normal text-destructive"
    >
      {message}
    </p>
  ) : null;

  return { controlProps, error };
}
