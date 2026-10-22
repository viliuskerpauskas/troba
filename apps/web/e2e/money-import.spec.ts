import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import { getImportProfile, listImportProfiles, saveImportProfile } from "@troba/core";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const fixtures = path.join(import.meta.dirname, "../../../packages/core/test/fixtures/csv");
// Fictional: a preamble line, semicolons, unsigned amounts with a D/C column, decimal commas.
const statement = path.join(fixtures, "example-bank-debit-credit.csv");

// The signed format with 60 transactions, more than the preview lists one by one. Mostly the same
// card purchase under new IDs, plus an income with a thousands separator and a filled account
// column, which the profile in that test leaves unmapped.
const sixtyRows = {
  name: "statement.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    [
      "Transaction ID,Posted,Transaction Date,Amount,Currency,Payee,Payee Account,Details,Type,Account",
      ...Array.from(
        { length: 58 },
        (_, i) => `T${2000 + i},02/03/2026,01/03/2026,-42.15,EUR,GROCERY MART,,Card purchase,CARD,`,
      ),
      'T2058,03/03/2026,03/03/2026,"1,500.00",EUR,ACME LTD,GB82 WEST 1234 5698 7654 32,Salary March,TRANSFER,DE89 3704 0044 0532 0130 00',
      "T2059,04/03/2026,,-1.50,EUR,EXAMPLE BANK,,Monthly fee,FEE,",
    ].join("\n"),
  ),
};

// SPEC-money success criterion 6: every page works at 360px.
test.use({ viewport: { width: 360, height: 740 } });

test("maps an unknown format once, imports it, and matches it on the next upload", async ({
  page,
}) => {
  await signIn(page, "e2e-import@example.test", "198.51.100.21");

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

test("corrects how the file is read, picks the account, and lists rows it can't read", async ({
  page,
}) => {
  await signIn(page, "e2e-import-signed@example.test", "198.51.100.23");
  await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(sixtyRows);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Lines above the header")).toHaveValue("0");

  // A wrong number of lines to skip reads the first transaction as the header.
  await page.getByLabel("Lines above the header").fill("1");
  await page.getByRole("button", { name: "Read the file again" }).click();
  const headers = page.getByRole("table").getByRole("columnheader");
  await expect(headers.first()).toHaveText("T2000");

  // A refused save keeps what the user set.
  await page.getByLabel("Profile name").fill("Example Bank (signed)");
  await page.getByLabel("Booking date").selectOption("02/03/2026");
  await page.getByLabel("Amount", { exact: true }).selectOption("-42.15");
  await page.getByLabel("Debit values").fill("D");
  await page.getByRole("button", { name: "Save profile and preview" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "A debit/credit column needs its debit values, such as D, and debit values need the column.",
  );
  await expect(page.getByLabel("Lines above the header")).toHaveValue("1");
  await expect(page.getByLabel("Booking date")).toHaveValue("02/03/2026");

  await page.getByLabel("Lines above the header").fill("0");
  await page.getByRole("button", { name: "Read the file again" }).click();
  await expect(headers.first()).toHaveText("Transaction ID");
  await page.getByLabel("Debit values").fill("");
  for (const [field, header] of [
    ["Booking date", "Posted"],
    ["Amount", "Amount"],
    ["Counterparty", "Payee"],
    ["Transaction ID", "Transaction ID"],
  ] as const) {
    await page.getByLabel(field, { exact: true }).selectOption(header);
  }
  // The wrong date format: every row fails.
  await page.getByLabel("Date format").selectOption("YYYY-MM-DD");
  await page.getByRole("button", { name: "Save profile and preview" }).click();

  // The profile maps no own IBAN, so the user picks the account.
  await expect(page.getByText("This file doesn't say which account it's for.")).toBeVisible();
  await page.getByLabel("Account", { exact: true }).selectOption("Cash (EUR)");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Account: Cash")).toBeVisible();
  await expectSummary(page, { "Rows in the file": 60, New: 0, "Can't be read": 60 });
  // The first 50 with their reasons, then a count.
  const failed = page.getByRole("list", { name: /can't be read/ }).getByRole("listitem");
  await expect(failed).toHaveCount(50);
  await expect(failed.first()).toHaveText("Row 1: the date isn't in the profile's date format");
  await expect(page.getByText("And 10 more.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Date format").selectOption("DD/MM/YYYY");
  await page.getByRole("button", { name: "Save profile and preview" }).click();
  await page.getByLabel("Account", { exact: true }).selectOption("Cash (EUR)");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expectSummary(page, { New: 60, "Can't be read": 0 });
  await page.getByRole("button", { name: "Import 60 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 60 transactions into Cash.");

  // A second profile for the same format, saved later: finding by columns now gives that one.
  const {
    rows: [user],
  } = await db().$client.query<{ id: string }>("select id from users where email = $1", [
    "e2e-import-signed@example.test",
  ]);
  const copy = await getImportProfile(
    db(),
    user!.id,
    (await listImportProfiles(db(), user!.id))[0]!.id,
  );
  const saved = await saveImportProfile(db(), user!.id, {
    profile: { ...copy!, name: "Example Bank (copy)" },
    bytes: sixtyRows.buffer,
  });
  expect(saved).toMatchObject({ ok: true });
  await page.getByRole("button", { name: "Import another file" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(sixtyRows);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Read with the profile Example Bank (copy).")).toBeVisible();

  // Picked by hand rather than found by its columns.
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(sixtyRows);
  await page.getByLabel("Import profile").selectOption("Example Bank (signed)");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Read with the profile Example Bank (signed).")).toBeVisible();
  await page.getByLabel("Account", { exact: true }).selectOption("Cash (EUR)");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expectSummary(page, { New: 0, "Already imported, skipped": 60 });

  // The income kept its sign and its thousands.
  await page.goto("/money/transactions");
  const newest = page
    .getByRole("list", { name: "Transactions, newest first" })
    .getByRole("listitem");
  await expect(newest.first()).toContainText("2026-03-04 EXAMPLE BANK");
  await expect(newest.nth(1)).toContainText("2026-03-03 ACME LTD");
  await expect(newest.nth(1)).toContainText("+€1,500.00");
});

// A fresh user, signed in from their own address, so the other spec files' sign-ins don't count
// towards its limit (198.51.100.0/24 is TEST-NET-2, RFC 5737).
async function signIn(page: Page, email: string, address: string) {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Import Tester" } });

  await page.setExtraHTTPHeaders({ "x-forwarded-for": address });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
}

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
