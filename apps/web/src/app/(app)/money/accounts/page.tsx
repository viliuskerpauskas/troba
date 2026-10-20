import { listAccounts, type Account } from "@troba/core";
import type { Metadata } from "next";
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
    <main>
      <h1>Accounts</h1>

      <section aria-labelledby="active-accounts">
        <h2 id="active-accounts">Your accounts</h2>
        {active.length === 0 ? (
          <p>No accounts. Create one below.</p>
        ) : (
          // A list, not a table: five columns don't fit a phone.
          <ul>
            {active.map((account) => (
              <li key={account.id}>
                <RenameAccountForm accountId={account.id} name={account.name} />
                <p>
                  {typeLabels[account.type]}, {account.currency}
                  {account.iban && <>, IBAN {formatIban(account.iban)}</>}
                </p>
                <form action={archiveAccountAction}>
                  <input type="hidden" name="accountId" value={account.id} />
                  <button type="submit" aria-label={`Archive ${account.name}`}>
                    Archive
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section aria-labelledby="archived-accounts">
          <h2 id="archived-accounts">Archived</h2>
          <p>Hidden when you pick an account. Their transactions still count in reports.</p>
          <ul>
            {archived.map((account) => (
              <li key={account.id}>
                <form action={restoreAccountAction}>
                  {account.name} ({typeLabels[account.type]}, {account.currency}){" "}
                  <input type="hidden" name="accountId" value={account.id} />
                  <button type="submit" aria-label={`Restore ${account.name}`}>
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="new-account">
        <h2 id="new-account">New account</h2>
        <CreateAccountForm />
      </section>
    </main>
  );
}
