import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const email = "e2e-import@example.test";
// Fictional: a preamble line, semicolons, unsigned amounts with a D/C column, decimal commas.
const statement = path.join(
  import.meta.dirname,
  "../../../packages/core/test/fixtures/csv/example-bank-debit-credit.csv",
);

// SPEC-money success criterion 6: every page works at 360px.
test.use({ viewport: { width: 360, height: 740 } });

test("maps an unknown format once, imports it, and matches it on the next upload", async ({
  page,
}) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Import Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.21" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();

  // The mapping step: the preamble line is skipped, and the headers come from the file.
  await expect(page.getByRole("heading", { name: "Map the columns" })).toBeVisible();
  await expect(page.getByLabel("Lines above the header")).toHaveValue("1");
  await expect(page.getByRole("table")).toContainText("Counterparty account");
  await expect(page.getByRole("table")).toContainText("GROCERY MART");
  await expectNoSideways(page);

  await page.getByLabel("Profile name").fill("Example Bank");
  await page.getByLabel("Decimal separator").selectOption(",");
  await page.getByLabel("Date format").selectOption("YYYY-MM-DD");
  for (const [field, header] of [
    ["Booking date", "Date"],
    ["Amount", "Amount"],
    ["Debit/credit indicator", "D/C"],
    ["Currency", "Currency"],
    ["Original amount", "Orig. amount"],
    ["Original currency", "Orig. currency"],
    ["Counterparty", "Counterparty"],
    ["Counterparty IBAN", "Counterparty account"],
    ["Description", "Purpose"],
    ["Your account's IBAN", "Own account"],
  ] as const) {
    await page.getByLabel(field, { exact: true }).selectOption(header);
  }
  await page.getByLabel("Debit values").fill("D");
  await page.getByRole("button", { name: "Save profile and preview" }).click();

  // The file names an account the user doesn't have yet.
  await expect(page.getByText("IBAN DE89370400440532013000 (EUR)")).toBeVisible();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();

  await expect(page.getByText("Account: Example Bank current")).toBeVisible();
  await expectSummary(page, { "Rows in the file": 8, New: 8, "Already imported, skipped": 0 });
  await expect(
    page.getByRole("list", { name: /Debit\/credit values/ }).getByRole("listitem"),
  ).toHaveText(["D: 6 rows, read as money out", "C: 2 rows, read as money in"]);
  await expectNoSideways(page);
  await page.getByRole("button", { name: "Import 8 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );

  await page.getByRole("link", { name: "View transactions" }).click();
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  await expect(list.getByRole("listitem").first()).toContainText("2026-03-07 SAVINGS: To savings");
  await expect(list.getByRole("listitem").first()).toContainText("-€250.00");

  // The same file again: found by its columns, and every row is already there.
  await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Read with the profile Example Bank.")).toBeVisible();
  await expectSummary(page, { New: 0, "Already imported, skipped": 8 });
  await expect(page.getByRole("status")).toHaveText("Nothing new to import.");

  // Editing the profile by hand keeps its mapping.
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Edit the import profile" })).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue("Purpose");
  await page.getByLabel("Profile name").fill("Example Bank (D/C)");
  await page.getByRole("button", { name: "Save profile and preview" }).click();
  await expect(page.getByText("Read with the profile Example Bank (D/C).")).toBeVisible();
  await expectSummary(page, { New: 0, "Already imported, skipped": 8 });
});

async function expectSummary(page: Page, figures: Record<string, number>) {
  for (const [term, value] of Object.entries(figures)) {
    const dt = page.locator("dt").filter({ hasText: new RegExp(`^${term}$`) });
    await expect(dt.locator("xpath=following-sibling::dd[1]")).toHaveText(String(value));
  }
}

async function expectNoSideways(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}
