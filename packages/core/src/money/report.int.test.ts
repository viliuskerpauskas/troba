import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { ensureMoneyDefaults } from "./defaults";
import { monthlyReport } from "./report";
import { listTransactions } from "./transactions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

// A user with the money defaults: a Cash account (EUR) and the default categories.
async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `report${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  const userId = user!.id;
  await ensureMoneyDefaults(db, userId);
  const [cash] = await listAccounts(db, userId);
  const categories = await listCategories(db, userId);
  const category = (name: string) => categories.find((c) => c.name === name)!.id;
  return { userId, cashId: cash!.id, category };
}

type Row = {
  accountId: string;
  bookedOn: string;
  amountCents: bigint;
  currency?: string;
  categoryId?: string | null;
};

// Straight into the table: the report reads whatever is there, however it got there.
async function insert(userId: string, rows: Row[]) {
  await db.insert(schema.moneyTransactions).values(
    rows.map((row) => ({
      userId,
      currency: "EUR",
      source: "manual" as const,
      ...row,
    })),
  );
}

describe("monthly report", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("totals the month's spending and income to the cent", async () => {
    const { userId, cashId, category } = await createUser();
    await insert(userId, [
      {
        accountId: cashId,
        bookedOn: "2026-10-01",
        amountCents: -1250n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-31",
        amountCents: -999n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-15",
        amountCents: 250001n,
        categoryId: category("Income"),
      },
    ]);

    const report = await monthlyReport(db, userId, "2026-10");

    expect(report).toMatchObject([{ currency: "EUR", spentCents: 2249n, incomeCents: 250001n }]);
  });

  it("breaks spending down by category, uncategorized as its own row, largest first", async () => {
    const { userId, cashId, category } = await createUser();
    await insert(userId, [
      {
        accountId: cashId,
        bookedOn: "2026-10-01",
        amountCents: -1250n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-02",
        amountCents: -750n,
        categoryId: category("Food"),
      },
      // A refund is income: the category's spending is what went out.
      {
        accountId: cashId,
        bookedOn: "2026-10-03",
        amountCents: 200n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-04",
        amountCents: -999n,
        categoryId: category("Transport"),
      },
      { accountId: cashId, bookedOn: "2026-10-05", amountCents: -1000n },
      {
        accountId: cashId,
        bookedOn: "2026-10-06",
        amountCents: 5000n,
        categoryId: category("Income"),
      },
    ]);

    const [eur] = await monthlyReport(db, userId, "2026-10");

    expect(eur).toEqual({
      currency: "EUR",
      spentCents: 3999n,
      incomeCents: 5200n,
      // Shares in basis points (hundredths of a percent), rounded half up.
      categories: [
        {
          categoryId: category("Food"),
          categoryName: "Food",
          spentCents: 2000n,
          transactionCount: 2,
          shareBasisPoints: 5001,
        },
        {
          categoryId: null,
          categoryName: null,
          spentCents: 1000n,
          transactionCount: 1,
          shareBasisPoints: 2501,
        },
        {
          categoryId: category("Transport"),
          categoryName: "Transport",
          spentCents: 999n,
          transactionCount: 1,
          shareBasisPoints: 2498,
        },
      ],
    });
  });

  it("lists the month's transactions behind a category row, and behind uncategorized", async () => {
    const { userId, cashId, category } = await createUser();
    await insert(userId, [
      { accountId: cashId, bookedOn: "2026-09-30", amountCents: -1n, categoryId: category("Food") },
      {
        accountId: cashId,
        bookedOn: "2026-10-01",
        amountCents: -1250n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-31",
        amountCents: -750n,
        categoryId: category("Food"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-15",
        amountCents: -300n,
        categoryId: category("Bills"),
      },
      { accountId: cashId, bookedOn: "2026-10-16", amountCents: -40n },
      { accountId: cashId, bookedOn: "2026-11-01", amountCents: -2n },
    ]);
    const [eur] = await monthlyReport(db, userId, "2026-10");
    const row = (id: string | null) => eur!.categories.find((c) => c.categoryId === id)!;

    const food = await listTransactions(db, userId, {
      month: "2026-10",
      category: category("Food"),
    });
    const uncategorized = await listTransactions(db, userId, {
      month: "2026-10",
      category: "uncategorized",
    });

    expect(food.map((t) => [t.bookedOn, t.amountCents])).toEqual([
      ["2026-10-31", -750n],
      ["2026-10-01", -1250n],
    ]);
    expect(-food.reduce((sum, t) => sum + t.amountCents, 0n)).toBe(
      row(category("Food")).spentCents,
    );
    expect(uncategorized.map((t) => t.amountCents)).toEqual([-40n]);
    expect(row(null).spentCents).toBe(40n);
  });

  it("counts only the month's days, across a year end", async () => {
    const { userId, cashId } = await createUser();
    await insert(userId, [
      { accountId: cashId, bookedOn: "2026-11-30", amountCents: -1n },
      { accountId: cashId, bookedOn: "2026-12-01", amountCents: -10n },
      { accountId: cashId, bookedOn: "2026-12-31", amountCents: -100n },
      { accountId: cashId, bookedOn: "2027-01-01", amountCents: -1000n },
    ]);

    expect(await monthlyReport(db, userId, "2026-12")).toMatchObject([{ spentCents: 110n }]);
    expect(await monthlyReport(db, userId, "2027-01")).toMatchObject([{ spentCents: 1000n }]);
    expect(await monthlyReport(db, userId, "2026-10")).toEqual([]);
  });

  it("leaves out transfers between the user's own accounts", async () => {
    const { userId, cashId, category } = await createUser();
    await insert(userId, [
      {
        accountId: cashId,
        bookedOn: "2026-10-02",
        amountCents: -40000n,
        categoryId: category("Transfers"),
      },
      {
        accountId: cashId,
        bookedOn: "2026-10-02",
        amountCents: 40000n,
        categoryId: category("Transfers"),
      },
      { accountId: cashId, bookedOn: "2026-10-03", amountCents: -500n },
      { accountId: cashId, bookedOn: "2026-10-03", amountCents: 200n },
    ]);

    expect(await monthlyReport(db, userId, "2026-10")).toMatchObject([
      { spentCents: 500n, incomeCents: 200n },
    ]);
  });

  it("reports only the user's own transactions", async () => {
    const owner = await createUser();
    const other = await createUser();
    await insert(owner.userId, [
      {
        accountId: owner.cashId,
        bookedOn: "2026-10-02",
        amountCents: -100n,
        categoryId: owner.category("Food"),
      },
    ]);
    await insert(other.userId, [
      {
        accountId: other.cashId,
        bookedOn: "2026-10-02",
        amountCents: -900n,
        categoryId: other.category("Food"),
      },
    ]);

    expect(await monthlyReport(db, owner.userId, "2026-10")).toMatchObject([
      { spentCents: 100n, categories: [{ categoryId: owner.category("Food"), spentCents: 100n }] },
    ]);
  });

  it("totals each account currency on its own, the default currency first", async () => {
    const { userId, cashId } = await createUser();
    const created = await createAccount(db, userId, {
      name: "Travel",
      type: "cash",
      currency: "USD",
    });
    if (!created.ok) throw new Error(created.reason);
    const usdId = created.account.id;
    const audCreated = await createAccount(db, userId, {
      name: "Away",
      type: "cash",
      currency: "AUD",
    });
    if (!audCreated.ok) throw new Error(audCreated.reason);
    await insert(userId, [
      { accountId: usdId, bookedOn: "2026-10-02", amountCents: -500n, currency: "USD" },
      { accountId: cashId, bookedOn: "2026-10-03", amountCents: -700n },
      { accountId: usdId, bookedOn: "2026-10-04", amountCents: 300n, currency: "USD" },
      {
        accountId: audCreated.account.id,
        bookedOn: "2026-10-05",
        amountCents: -1n,
        currency: "AUD",
      },
    ]);

    expect(await monthlyReport(db, userId, "2026-10")).toMatchObject([
      { currency: "EUR", spentCents: 700n, incomeCents: 0n },
      { currency: "AUD", spentCents: 1n, incomeCents: 0n },
      { currency: "USD", spentCents: 500n, incomeCents: 300n },
    ]);
  });
});
