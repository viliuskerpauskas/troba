import { getTransaction, listCategories, listRules, type Transaction } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { deleteRuleAction, moveRuleAction, type RuleValues } from "./actions";
import { fieldLabels } from "./fields";
import { ApplyRules, NewRuleForm } from "./rule-forms";

export const metadata: Metadata = { title: "Rules · troba" };

// "Create rule from this" links here with the transaction's id, not its text, so the
// counterparty stays out of URLs and logs.
const fromSchema = z.uuid();

// Pre-filled with the counterparty (SPEC-money M5), or the description when there is none.
function ruleFrom(transaction: Transaction | null): RuleValues {
  if (transaction?.counterparty) {
    return { field: "counterparty", pattern: transaction.counterparty };
  }
  if (transaction?.description) {
    return { field: "description", pattern: transaction.description };
  }
  return {};
}

export default async function RulesPage({ searchParams }: PageProps<"/money/rules">) {
  const { userId } = await requireMoneyUser();
  const from = fromSchema.safeParse((await searchParams).from);
  const [rules, categories, transaction] = await Promise.all([
    listRules(db(), userId),
    listCategories(db(), userId),
    from.success ? getTransaction(db(), userId, from.data) : null,
  ]);

  return (
    <main>
      <h1>Rules</h1>
      <p>
        Rules categorize imported transactions, and uncategorized ones when you apply them. The
        first rule that matches wins. A category you set by hand is never changed.
      </p>

      <section aria-labelledby="your-rules">
        <h2 id="your-rules">Your rules</h2>
        {rules.length === 0 ? (
          <p>No rules yet. Add one below.</p>
        ) : (
          <ol aria-label="Rules, first match wins">
            {rules.map((rule, index) => {
              const name = `${fieldLabels[rule.field]} contains “${rule.pattern}”`;
              return (
                <li key={rule.id}>
                  {name} → {rule.categoryName}{" "}
                  <form action={moveRuleAction} style={{ display: "inline" }}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button
                      type="submit"
                      name="direction"
                      value="up"
                      disabled={index === 0}
                      aria-label={`Move up: ${name}`}
                    >
                      Up
                    </button>{" "}
                    <button
                      type="submit"
                      name="direction"
                      value="down"
                      disabled={index === rules.length - 1}
                      aria-label={`Move down: ${name}`}
                    >
                      Down
                    </button>
                  </form>{" "}
                  <form action={deleteRuleAction} style={{ display: "inline" }}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button type="submit" aria-label={`Delete: ${name}`}>
                      Delete
                    </button>
                  </form>
                </li>
              );
            })}
          </ol>
        )}
        <ApplyRules />
      </section>

      <section aria-labelledby="new-rule">
        <h2 id="new-rule">New rule</h2>
        {transaction && (
          <p>
            From{" "}
            <Link href={`/money/transactions/${transaction.id}`}>
              the transaction on {transaction.bookedOn}
            </Link>
            .
          </p>
        )}
        <NewRuleForm categories={categories} initial={ruleFrom(transaction)} />
      </section>
    </main>
  );
}
