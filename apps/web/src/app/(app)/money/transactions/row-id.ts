// The list's DOM id for a transaction's row, which the suggestion notice moves the keyboard focus
// to after an accept or a dismiss. Plain module: the server page and the client controls share it.
export function rowElementId(transactionId: string): string {
  return `transaction-${transactionId}`;
}
