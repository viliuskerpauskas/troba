import { schema, type Db } from "@troba/db";
import { eq } from "drizzle-orm";

// A user's money defaults (SPEC-money M1, M4): one Cash account in EUR and the default
// categories. Seeded lazily on the first visit to money, so identity never calls into money.

const { moneyAccounts, moneyCategories, moneySettings } = schema;

export const defaultCategoryNames = [
  "Food",
  "Transport",
  "Bills",
  "Housing",
  "Health",
  "Shopping",
  "Entertainment",
  "Income",
  "Transfers",
  "Other",
] as const;

// Idempotent and safe to call on every money page. The money_settings row is the marker: the
// first caller inserts it and seeds in the same transaction; a concurrent caller's insert waits
// on that row's unique key, then finds it committed and does nothing.
export async function ensureMoneyDefaults(db: Db, userId: string): Promise<void> {
  const [seeded] = await db
    .select({ userId: moneySettings.userId })
    .from(moneySettings)
    .where(eq(moneySettings.userId, userId));
  if (seeded) return;

  await db.transaction(async (tx) => {
    const marked = await tx
      .insert(moneySettings)
      .values({ userId, defaultsSeededAt: new Date() })
      .onConflictDoNothing()
      .returning({ userId: moneySettings.userId });
    if (marked.length === 0) return;

    await tx.insert(moneyAccounts).values({ userId, name: "Cash", type: "cash", currency: "EUR" });
    await tx.insert(moneyCategories).values(
      defaultCategoryNames.map((name) => ({
        userId,
        name,
        // Moving money between your own accounts isn't spending.
        excludedFromSpending: name === "Transfers",
      })),
    );
  });
}
