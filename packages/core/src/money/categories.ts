import { schema, type Db } from "@troba/db";
import { and, asc, eq } from "drizzle-orm";

// Categories (SPEC-money M4). A flat list per user.

const { moneyCategories, moneyTransactions } = schema;

export type Category = { id: string; name: string; excludedFromSpending: boolean };

// The columns that make a Category.
const categoryColumns = {
  id: moneyCategories.id,
  name: moneyCategories.name,
  excludedFromSpending: moneyCategories.excludedFromSpending,
};

// The user's categories by name, for pickers. Bounded by what a user creates by hand.
export async function listCategories(db: Db, userId: string): Promise<Category[]> {
  return db
    .select(categoryColumns)
    .from(moneyCategories)
    .where(eq(moneyCategories.userId, userId))
    .orderBy(asc(moneyCategories.name), asc(moneyCategories.id));
}

// Only the default Transfers category is excluded from spending; new ones count.
export async function createCategory(
  db: Db,
  userId: string,
  input: { name: string },
): Promise<Category> {
  const [category] = await db
    .insert(moneyCategories)
    .values({ userId, name: input.name.trim() })
    .returning(categoryColumns);
  return category!;
}

// Returns whether the user has a category with that id.
export async function renameCategory(
  db: Db,
  userId: string,
  input: { categoryId: string; name: string },
): Promise<boolean> {
  const renamed = await db
    .update(moneyCategories)
    .set({ name: input.name.trim() })
    .where(and(eq(moneyCategories.id, input.categoryId), eq(moneyCategories.userId, userId)))
    .returning({ id: moneyCategories.id });
  return renamed.length > 0;
}

// Returns whether one of the user's categories was deleted. Its transactions become uncategorized
// with no category source, so rules may categorize them again. The foreign key would null only
// the category, so they're cleared first, while they still point at it.
export async function deleteCategory(
  db: Db,
  userId: string,
  input: { categoryId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .update(moneyTransactions)
      .set({ categoryId: null, categorySource: null })
      .where(
        and(
          eq(moneyTransactions.userId, userId),
          eq(moneyTransactions.categoryId, input.categoryId),
        ),
      );
    const deleted = await tx
      .delete(moneyCategories)
      .where(and(eq(moneyCategories.id, input.categoryId), eq(moneyCategories.userId, userId)))
      .returning({ id: moneyCategories.id });
    return deleted.length > 0;
  });
}
