/** Exhaustiveness check for switch statements over union types. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
