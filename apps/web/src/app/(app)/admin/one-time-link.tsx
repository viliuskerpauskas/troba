import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// A one-time link (an invite or a password reset) shown once for the admin to copy. The input
// takes the full width so it fits a phone screen, the link scrolling inside it, and focusing it
// selects the whole link. A label naming a long email wraps anywhere for the same reason.
export function OneTimeLink({
  id,
  label,
  link,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  link: string;
  hint: string;
  autoFocus?: boolean;
}) {
  const hintId = `${id}-hint`;

  return (
    <Field>
      <FieldLabel htmlFor={id} className="[overflow-wrap:anywhere]">
        {label}
      </FieldLabel>
      <Input
        id={id}
        readOnly
        value={link}
        aria-describedby={hintId}
        autoFocus={autoFocus}
        onFocus={(event) => event.currentTarget.select()}
      />
      <FieldDescription id={hintId}>{hint}</FieldDescription>
    </Field>
  );
}
