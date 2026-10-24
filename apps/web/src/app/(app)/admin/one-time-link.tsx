// A one-time link (an invite or a password reset) shown once for the admin to copy. The input
// takes the full width so it fits a phone screen, the link scrolling inside it, and focusing it
// selects the whole link.
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
    <p>
      <label htmlFor={id}>{label}</label>
      <br />
      <input
        id={id}
        readOnly
        value={link}
        aria-describedby={hintId}
        style={{ width: "100%", boxSizing: "border-box" }}
        autoFocus={autoFocus}
        onFocus={(event) => event.currentTarget.select()}
      />
      <br />
      <small id={hintId}>{hint}</small>
    </p>
  );
}
