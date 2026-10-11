/** Exhaustiveness check for switch statements over union types. */
export function assertNever(value: never): never {
  // Money is bigint, which JSON.stringify can't serialize on its own.
  const shown = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  throw new Error(`Unexpected value: ${shown}`);
}
