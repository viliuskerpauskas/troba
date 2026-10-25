import { getTransaction, listCategories, listRules, ruleDraftFrom } from "@troba/core";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { deleteRuleAction, moveRuleAction } from "./actions";
import { fieldLabels } from "./fields";
import { ApplyRules, NewRuleForm } from "./rule-forms";

export const metadata: Metadata = { title: "Rules · troba" };

// "Create rule from this" links here with the transaction's id, not its text, so the
// counterparty stays out of URLs and logs.
const fromSchema = z.uuid();

export default async function RulesPage({ searchParams }: PageProps<"/money/rules">) {
  const { userId } = await requireMoneyUser();
  const from = fromSchema.safeParse((await searchParams).from);
  const [rules, categories, transaction] = await Promise.all([
    listRules(db(), userId),
    listCategories(db(), userId),
    from.success ? getTransaction(db(), userId, from.data) : null,
  ]);

  return (
    <Page>
      <h1>Rules</h1>
      <p className="text-muted-foreground">
        Rules categorize imported transactions, and uncategorized ones when you apply them. The
        first rule that matches wins. A category you set by hand is never changed.
      </p>

      <section aria-labelledby="your-rules" className="flex flex-col gap-3">
        <h2 id="your-rules">Your rules</h2>
        {rules.length === 0 ? (
          <p className="text-muted-foreground">No rules yet. Add one below.</p>
        ) : (
          <ol
            aria-label="Rules, first match wins"
            className="flex list-inside list-decimal flex-col divide-y rounded-xl ring-1 ring-foreground/10"
          >
            {rules.map((rule, index) => {
              const name = `${fieldLabels[rule.field]} contains “${rule.pattern}”`;
              return (
                <li key={rule.id} className="px-4 py-3">
                  <span className="[overflow-wrap:anywhere]">
                    {name} → {rule.categoryName}{" "}
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={moveRuleAction} className="flex gap-2">
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        name="direction"
                        value="up"
                        disabled={index === 0}
                        aria-label={`Move up: ${name}`}
                      >
                        Up
                      </Button>
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        name="direction"
                        value="down"
                        disabled={index === rules.length - 1}
                        aria-label={`Move down: ${name}`}
                      >
                        Down
                      </Button>
                    </form>
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        aria-label={`Delete: ${name}`}
                      >
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <ApplyRules />
      </section>

      <section aria-labelledby="new-rule" className="flex flex-col gap-3">
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
        <NewRuleForm
          categories={categories}
          initial={transaction ? ruleDraftFrom(transaction) : {}}
        />
      </section>
    </Page>
  );
}
