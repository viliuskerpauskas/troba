import { schema } from "@troba/db";
import { sql, type SQL } from "drizzle-orm";

// What makes two transactions the same merchant (SPEC-money M5, ADR-0016): the counterparty,
// ignoring case and surrounding spaces, or the description when there is no counterparty. Null for
// a row with neither, which has no merchant.
//
// The one definition, in SQL, so every place that groups rows by merchant groups them alike: the
// engine that asks the model once per merchant, accepting and dismissing a suggestion (which act
// on every row of the merchant), the pending counts, and any list grouped by merchant. Case folding
// is Postgres's lower(), so no copy in TypeScript can drift from it.
export function merchantKey(): SQL<string | null> {
  const { counterparty, description } = schema.moneyTransactions;
  return sql<
    string | null
  >`lower(coalesce(nullif(btrim(${counterparty}), ''), nullif(btrim(${description}), '')))`;
}
