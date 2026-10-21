import { randomBytes } from "node:crypto";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const email = "e2e-transactions@example.test";

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

async function expectNoSideways(page: import("@playwright/test").Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}
