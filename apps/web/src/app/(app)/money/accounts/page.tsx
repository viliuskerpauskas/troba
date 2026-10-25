import { listAccounts, type Account } from "@troba/core";
import type { Metadata } from "next";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { CreateAccountForm, RenameAccountForm } from "./account-forms";
import { archiveAccountAction, restoreAccountAction } from "./actions";

export const metadata: Metadata = { title: "Accounts · troba" };

const typeLabels: Record<Account["type"], string> = { bank: "Bank", cash: "Cash", other: "Other" };

// Grouped in fours, the way banks print them.
function formatIban(iban: string) {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

export default async function AccountsPage() {
  const { userId } = await requireMoneyUser();
  const accounts = await listAccounts(db(), userId, { includeArchived: true });
  const active = accounts.filter((account) => !account.archivedAt);
  const archived = accounts.filter((account) => account.archivedAt);

  return (
    <Page>
      <h1>Accounts</h1>

      <section aria-labelledby="active-accounts" className="flex flex-col gap-3">
        <h2 id="active-accounts">Your accounts</h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground">No accounts. Create one below.</p>
        ) : (
          // A list, not a table: five columns don't fit a phone.
          <ul className="flex flex-col gap-3">
            {active.map((account) => (
              <li key={account.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-3">
                    <RenameAccountForm accountId={account.id} name={account.name} />
                    <p className="text-muted-foreground">
                      {typeLabels[account.type]}, {account.currency}
                      {account.iban && <>, IBAN {formatIban(account.iban)}</>}
                    </p>
                    <form action={archiveAccountAction}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        aria-label={`Archive ${account.name}`}
                      >
                        Archive
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section aria-labelledby="archived-accounts" className="flex flex-col gap-3">
          <h2 id="archived-accounts">Archived</h2>
          <p className="text-muted-foreground">
            Hidden when you pick an account. Their transactions still count in reports.
          </p>
          <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
            {archived.map((account) => (
              <li key={account.id} className="px-4 py-2">
                <form
                  action={restoreAccountAction}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {account.name} ({typeLabels[account.type]}, {account.currency}){" "}
                  </span>
                  <input type="hidden" name="accountId" value={account.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    aria-label={`Restore ${account.name}`}
                  >
                    Restore
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="new-account" className="flex flex-col gap-3">
        <h2 id="new-account">New account</h2>
        <CreateAccountForm />
      </section>
    </Page>
  );
}
