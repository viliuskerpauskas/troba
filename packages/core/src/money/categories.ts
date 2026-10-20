import { schema, type Db } from "@troba/db";
import { asc, eq } from "drizzle-orm";

// Categories (SPEC-money M4). A flat list per user.

const { moneyCategories } = schema;

export type Category = { id: string; name: string; excludedFromSpending: boolean };

// The user's categories by name, for pickers. Bounded by what a user creates by hand.
export async function listCategories(db: Db, userId: string): Promise<Category[]> {
  return db
    .select({
      id: moneyCategories.id,
      name: moneyCategories.name,
      excludedFromSpending: moneyCategories.excludedFromSpending,
    })
    .from(moneyCategories)
    .where(eq(moneyCategories.userId, userId))
    .orderBy(asc(moneyCategories.name), asc(moneyCategories.id));
}
