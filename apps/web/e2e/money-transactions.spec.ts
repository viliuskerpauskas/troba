import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

const email = "e2e-transactions@example.test";

test.afterAll(async () => {
  await db().$client.end();
});

// SPEC-money M2: the form works on a 360px-wide phone screen.
test.use({ viewport: { width: 360, height: 740 } });

test("adds, edits and deletes a manual transaction on a phone-sized screen", async ({ page }) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Transactions Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.17" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("No transactions yet.")).toBeVisible();
  await page.getByRole("link", { name: "Add transaction" }).click();

  await page.getByLabel("Date").fill("2026-10-03");
  await page.getByLabel("Amount").fill("12.345");
  await page.getByLabel("Counterparty (optional)").fill("GROCERY MART");
  await page.getByLabel("Category").selectOption("Food");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("at most two decimals");
  await expect(page.getByLabel("Counterparty (optional)")).toHaveValue("GROCERY MART");
  await expect(page.getByLabel("Category").locator("option:checked")).toHaveText("Food");
  await expectNoSideways(page);

  await page.getByLabel("Amount").fill("12,50");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL("/money/transactions");
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toContainText("2026-10-03 GROCERY MART");
  await expect(list.getByRole("listitem")).toContainText("Food · -€12.50");
  await expectNoSideways(page);

  await list.getByRole("link", { name: /GROCERY MART/ }).click();
  await expect(page.getByLabel("Amount")).toHaveValue("12.50");
  await page.getByLabel("Income").check();
  await page.getByLabel("Amount").fill("1,234.56");
  await page.getByLabel("Category").selectOption("Uncategorized");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("listitem")).toContainText("Uncategorized · +€1,234.56");

  await list.getByRole("link", { name: /GROCERY MART/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Delete this transaction? This can't be undone.",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL("/money/transactions");
  await expect(page.getByText("No transactions yet.")).toBeVisible();
});

test("filters, searches and pages through the list", async ({ page }) => {
  const filterEmail = "e2e-transaction-filters@example.test";
  await db().$client.query("delete from users where email = $1", [filterEmail]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email: filterEmail, password, name: "Filters Tester" } });

  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.18" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(filterEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The money home creates the Cash account and default categories.
  await expect(page).toHaveURL("/money");

  // 101 uncategorized September expenses and one October GROCERY MART expense in Food.
  await db().$client.query(
    `insert into money_transactions (user_id, account_id, booked_on, amount_cents, currency,
       description, source)
     select u.id, a.id, date '2026-09-01' + (n % 30), -100, 'EUR', 'Expense ' || n, 'manual'
     from users u join money_accounts a on a.user_id = u.id, generate_series(1, 101) n
     where u.email = $1`,
    [filterEmail],
  );
  await db().$client.query(
    `insert into money_transactions (user_id, account_id, booked_on, amount_cents, currency,
       counterparty, category_id, category_source, source)
     select u.id, a.id, date '2026-10-03', -1250, 'EUR', 'GROCERY MART', c.id, 'manual', 'manual'
     from users u join money_accounts a on a.user_id = u.id
       join money_categories c on c.user_id = u.id and c.name = 'Food'
     where u.email = $1`,
    [filterEmail],
  );

  await page.goto("/money/transactions");
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).toHaveCount(100);
  await expect(list.getByRole("listitem").first()).toContainText("GROCERY MART");
  await expect(page.getByRole("link", { name: "Newer" })).toHaveCount(0);
  await page.getByRole("link", { name: "Older" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Older" })).toHaveCount(0);
  await page.getByRole("link", { name: "Newer" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(100);

  await page.getByLabel("Search").fill("grocery");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/q=grocery/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toContainText("Food · -€12.50");
  await expect(page.getByLabel("Search")).toHaveValue("grocery");

  await page.getByLabel("Search").fill("");
  await page.getByLabel("Category").selectOption("Uncategorized");
  await page.getByLabel("Month").fill("2026-10");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("No transactions match these filters.")).toBeVisible();

  await page.getByLabel("Month").fill("2026-09");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(100);
  await page.getByRole("link", { name: "Older" }).click();
  await expect(page).toHaveURL(/category=uncategorized.*page=2/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expectNoSideways(page);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/money/transactions");
  await expect(list.getByRole("listitem")).toHaveCount(100);
});

async function expectNoSideways(page: import("@playwright/test").Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}
