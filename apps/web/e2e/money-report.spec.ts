import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

const email = "e2e-report@example.test";

test.afterAll(async () => {
  await db().$client.end();
});

test.use({ viewport: { width: 360, height: 740 } });

// SPEC-money M7: the month's totals per currency, the category table, and a row's transactions.
test("shows a month's spending by category and the transactions behind a row", async ({ page }) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Report Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.19" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first visit to Money seeds the Cash account and the default categories.
  await expect(page).toHaveURL("/money");

  await db().$client.query(
    `with u as (select id from users where email = $1),
     cash as (select a.id, a.user_id from money_accounts a join u on a.user_id = u.id),
     travel as (
       insert into money_accounts (user_id, name, type, currency)
       select id, 'Travel', 'cash', 'USD' from u returning id, user_id
     ),
     category as (select c.id, c.name from money_categories c join u on c.user_id = u.id)
     insert into money_transactions
       (user_id, account_id, booked_on, amount_cents, currency, counterparty, category_id, source)
     select cash.user_id, cash.id, v.booked_on::date, v.amount, 'EUR', v.counterparty,
       (select id from category where name = v.category), 'manual'
     from cash, (values
       ('2026-10-01', -1250, 'GROCERY MART', 'Food'),
       ('2026-10-31', -750, 'CORNER CAFE', 'Food'),
       ('2026-11-01', -9999, 'GROCERY MART', 'Food'),
       ('2026-10-05', -500, 'CITY TRANSIT', null),
       ('2026-10-06', -40000, 'OWN SAVINGS', 'Transfers'),
       ('2026-10-15', 250000, 'EXAMPLE EMPLOYER', 'Income')
     ) as v(booked_on, amount, counterparty, category)
     union all
     select user_id, id, date '2026-10-12', -4599, 'USD', 'BOOK NOOK', null, 'manual' from travel`,
    [email],
  );

  await page.getByRole("link", { name: "Monthly spending" }).click();
  await page.getByLabel("Month").fill("2026-10");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL("/money/report?month=2026-10");

  const eur = page.getByRole("region", { name: "In EUR" });
  await expect(eur.getByRole("definition")).toHaveText(["€25.00", "€2,500.00"]);
  await expect(eur.getByRole("img", { name: "Spending by category in EUR" })).toBeVisible();
  const rows = eur.getByRole("table").getByRole("row");
  await expect(rows).toHaveText([
    /Category.*Amount.*%.*Count/,
    /Food\s*€20\.00\s*80\.00%\s*2/,
    /Uncategorized\s*€5\.00\s*20\.00%\s*1/,
  ]);
  const usd = page.getByRole("region", { name: "In USD" });
  await expect(usd.getByRole("definition")).toHaveText(["$45.99", "$0.00"]);
  await expectNoSideways(page);

  await eur.getByRole("link", { name: "Amount" }).click();
  await expect(page.getByRole("region", { name: "In EUR" }).getByRole("row").nth(1)).toContainText(
    "Uncategorized",
  );

  await page.getByRole("region", { name: "In EUR" }).getByRole("link", { name: "Food" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food in 2026-10");
  const list = page.getByRole("list", { name: "Food transactions, newest first" });
  await expect(list.getByRole("listitem")).toHaveText([
    /2026-10-31 CORNER CAFE.*-€7\.50/,
    /2026-10-01 GROCERY MART.*-€12\.50/,
  ]);
});

async function expectNoSideways(page: import("@playwright/test").Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}
