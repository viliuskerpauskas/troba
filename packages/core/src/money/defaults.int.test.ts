import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveAccount, listAccounts, renameAccount } from "./accounts";
import { ensureMoneyDefaults } from "./defaults";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `money${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function categoriesOf(userId: string) {
  const rows = await db.query.moneyCategories.findMany({
    where: (categories, { eq }) => eq(categories.userId, userId),
  });
  return rows
    .map(({ name, excludedFromSpending }) => ({ name, excludedFromSpending }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const defaultCategories = [
  "Bills",
  "Entertainment",
  "Food",
  "Health",
  "Housing",
  "Income",
  "Other",
  "Shopping",
  "Transfers",
  "Transport",
];

describe("ensureMoneyDefaults", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("gives a new user a Cash account in EUR and the default categories", async () => {
    const userId = await createUser();

    await ensureMoneyDefaults(db, userId);

    expect(await listAccounts(db, userId)).toMatchObject([
      { name: "Cash", type: "cash", currency: "EUR", iban: null, archivedAt: null },
    ]);
    expect(await categoriesOf(userId)).toEqual(
      defaultCategories.map((name) => ({ name, excludedFromSpending: name === "Transfers" })),
    );
  });

  it("seeds once, however many first visits arrive at the same time", async () => {
    const userId = await createUser();

    await Promise.all(Array.from({ length: 8 }, () => ensureMoneyDefaults(db, userId)));
    await ensureMoneyDefaults(db, userId);

    expect(await listAccounts(db, userId)).toHaveLength(1);
    expect(await categoriesOf(userId)).toHaveLength(defaultCategories.length);
  });

  it("doesn't bring Cash back after the user renamed or archived it", async () => {
    const renamer = await createUser();
    await ensureMoneyDefaults(db, renamer);
    const [cash] = await listAccounts(db, renamer);
    await renameAccount(db, renamer, { accountId: cash!.id, name: "Wallet" });

    const archiver = await createUser();
    await ensureMoneyDefaults(db, archiver);
    const [archived] = await listAccounts(db, archiver);
    await archiveAccount(db, archiver, { accountId: archived!.id });

    await ensureMoneyDefaults(db, renamer);
    await ensureMoneyDefaults(db, archiver);

    expect((await listAccounts(db, renamer)).map((account) => account.name)).toEqual(["Wallet"]);
    expect(await listAccounts(db, archiver, { includeArchived: true })).toHaveLength(1);
  });

  it("seeds each user their own defaults", async () => {
    const first = await createUser();
    const second = await createUser();

    await ensureMoneyDefaults(db, first);
    await ensureMoneyDefaults(db, second);

    const [firstCash] = await listAccounts(db, first);
    const [secondCash] = await listAccounts(db, second);
    expect(firstCash!.id).not.toBe(secondCash!.id);
    expect(await categoriesOf(second)).toHaveLength(defaultCategories.length);
  });
});
