import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, expectNoAxeViolations, test } from "./test";

// The money module's v1 as a whole (SPEC-money success criteria 4 and 6): the import flow with
// rules feeding the monthly view, and every money page on a phone, labelled and keyboard-operable.

const fixtures = path.join(import.meta.dirname, "../../../packages/core/test/fixtures/csv");
// Fictional: a preamble line, semicolons, unsigned amounts with a D/C column, decimal commas.
const statement = path.join(fixtures, "example-bank-debit-credit.csv");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("imports a statement, rules categorize it, and the month's totals add up", async ({
  page,
}) => {
  await signIn(page, "e2e-money-v1@example.test", "198.51.100.30");

  // Two rules, entered with the keyboard alone.
  await page.getByRole("link", { name: "Rules" }).click();
  const create = page.getByRole("region", { name: "New rule" });
  const rules = page.getByRole("list", { name: "Rules, first match wins" });
  for (const [field, pattern, category] of [
    ["Counterparty", "grocery mart", "Food"],
    ["Description", "To savings", "Transfers"],
  ] as const) {
    await create.getByLabel("When").focus();
    await page.keyboard.type(field);
    await page.keyboard.press("Tab");
    await page.keyboard.type(pattern);
    await page.keyboard.press("Tab");
    await page.keyboard.type(category);
    await page.keyboard.press("Tab");
    await expect(create.getByRole("button", { name: "Add rule" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(create.getByRole("status")).toContainText("Rule added.");
  }
  await expect(rules.getByRole("listitem")).toHaveText([
    /Counterparty contains “grocery mart” → Food/,
    /Description contains “To savings” → Transfers/,
  ]);

  // Upload → map → preview → confirm.
  await page.goto("/money");
  await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Map the columns" })).toBeVisible();
  await mapDebitCreditStatement(page);
  await page.getByRole("button", { name: "Save profile and preview" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();

  await expect(page.getByText("Account: Example Bank current")).toBeVisible();
  await expectSummary(page, { "Rows in the file": 8, New: 8, "Already imported, skipped": 0 });
  await page.getByRole("button", { name: "Import 8 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );

  // The rules categorized the new rows as they came in; the rest stay uncategorized.
  await page.getByRole("link", { name: "View transactions" }).click();
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  // A list item's text has no space where its line breaks.
  await expect(list.getByRole("listitem")).toHaveText([
    /^2026-03-07 SAVINGS: To savingsTransfers · -€250\.00/,
    /^2026-03-06 GROCERY MART: RefundFood · \+€42\.15/,
    /^2026-03-05 PARKING CO: ParkingUncategorized · -€5\.00/,
    /^2026-03-05 PARKING CO: ParkingUncategorized · -€5\.00/,
    /^2026-03-04 EXAMPLE BANK: Account feeUncategorized · -€0\.99/,
    /^2026-03-03 BOOK SHOP INC: Card purchase abroadUncategorized · -€18\.40/,
    /^2026-03-02 ACME LTD: Salary MarchUncategorized · \+€1,500\.00/,
    /^2026-03-01 GROCERY MART: Card purchaseFood · -€42\.15/,
  ]);

  // The month's debits without Transfers: 42.15 + 18.40 + 0.99 + 5.00 + 5.00 = 71.54. Money in
  // is the salary and the refund.
  await page.goto("/money");
  await page.getByRole("link", { name: "Monthly spending" }).click();
  await page.getByLabel("Month").fill("2026-03");
  await page.getByRole("button", { name: "Show" }).click();
  // One currency, so one section, headed "Totals".
  const eur = page.getByRole("region", { name: "Totals" });
  await expect(eur.getByRole("definition")).toHaveText(["€71.54", "€1,542.15"]);
  await expect(eur.getByRole("table").getByRole("row")).toHaveText([
    /Category.*Amount.*%.*Count/,
    /Food\s*€42\.15\s*58\.92%\s*1/,
    /Uncategorized\s*€29\.39\s*41\.08%\s*4/,
  ]);
});

// SPEC-money success criterion 6 at 360px: no page scrolls sideways, axe finds no WCAG 2.1 A or AA
// violation, and Tab reaches every control.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("every money page fits, is labelled, and can be used with the keyboard", async ({
    page,
  }) => {
    await signIn(page, "e2e-money-phone@example.test", "198.51.100.31");
    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
    await checkPage(page, "Money");

    await page.goto("/money/transactions/new");
    await expect(page.getByRole("button", { name: "Add transaction" })).toBeVisible();
    await checkPage(page, "Add transaction");
    await page.getByLabel("Date").fill("2026-10-03");
    await page.getByLabel("Amount").fill("12.50");
    await page.getByLabel("Counterparty (optional)").fill("GROCERY MART");
    await page.getByLabel("Description (optional)").fill("Card purchase");
    await page.getByRole("button", { name: "Add transaction" }).click();
    const list = page.getByRole("list", { name: "Transactions, newest first" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await checkPage(page, "Transactions");

    await page.getByLabel("Month").fill("2026-10");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    await checkPage(page, "Filtered transactions");

    await list.getByRole("link", { name: /GROCERY MART/ }).click();
    await page
      .getByLabel("Add a receipt")
      .setInputFiles({ name: "GROCERY MART.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Attach" }).click();
    await expect(
      page.getByRole("list", { name: "Attached receipts" }).getByRole("listitem"),
    ).toHaveCount(1);
    await checkPage(page, "Edit transaction");
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: "Yes, delete" })).toBeVisible();
    await checkPage(page, "Edit transaction: confirming delete");

    // Each page with what it lists: an archived account, a category being deleted, two rules.
    await page.goto("/money/accounts");
    const create = page.getByRole("region", { name: "New account" });
    await create.getByLabel("Name").fill("Savings jar");
    await create.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("button", { name: "Archive Savings jar" }).click();
    await expect(page.getByRole("region", { name: "Archived" })).toContainText("Savings jar");
    await checkPage(page, "Accounts");

    await page.goto("/money/categories");
    await page.getByRole("button", { name: "Delete Other" }).click();
    await expect(page.getByRole("button", { name: "Yes, delete" })).toBeVisible();
    await checkPage(page, "Categories: confirming delete");

    await page.goto("/money/rules");
    const newRule = page.getByRole("region", { name: "New rule" });
    for (const [pattern, category] of [
      ["GROCERY MART", "Food"],
      ["PARKING", "Transport"],
    ] as const) {
      await newRule.getByLabel("contains (any case)").fill(pattern);
      await newRule.getByLabel("Category").selectOption(category);
      await newRule.getByRole("button", { name: "Add rule" }).click();
      await expect(newRule.getByRole("status")).toContainText("Rule added.");
    }
    await expect(
      page.getByRole("list", { name: "Rules, first match wins" }).getByRole("listitem"),
    ).toHaveCount(2);
    await checkPage(page, "Rules");

    await page.goto("/money/import");
    await expect(page.getByLabel("CSV file from your bank")).toBeVisible();
    await checkPage(page, "Import: upload");
    await page.getByLabel("CSV file from your bank").setInputFiles(statement);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Map the columns" })).toBeVisible();
    await checkPage(page, "Import: map");
    await mapDebitCreditStatement(page);
    await page.getByRole("button", { name: "Save profile and preview" }).click();
    await expect(page.getByLabel("Account name")).toBeVisible();
    await checkPage(page, "Import: new account");
    await page.getByLabel("Account name").fill("Example Bank current");
    await page.getByRole("button", { name: "Create the account and preview" }).click();
    await expect(page.getByRole("button", { name: "Import 8 transactions" })).toBeVisible();
    await checkPage(page, "Import: preview");
    await page.getByRole("button", { name: "Import 8 transactions" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Imported 8 transactions/);
    await checkPage(page, "Import: done");

    await page.goto("/money/report?month=2026-03");
    await expect(page.getByRole("region", { name: "Totals" })).toBeVisible();
    await checkPage(page, "Monthly spending");
    await page
      .getByRole("region", { name: "Totals" })
      .getByRole("link", { name: "Uncategorized" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Uncategorized");
    await checkPage(page, "A category's transactions");
  });
});

// The button pressed is gone once the next import step or a delete confirmation renders: focus
// moves on with it instead of falling back to the top of the page.
test("keeps keyboard focus where the page changed", async ({ page }) => {
  await signIn(page, "e2e-money-focus@example.test", "198.51.100.32");

  await page.goto("/money/import");
  await page.getByLabel("CSV file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Map the columns" })).toBeVisible();
  await expectFocusInMain(page);
  await mapDebitCreditStatement(page);
  await page.getByRole("button", { name: "Save profile and preview" }).press("Enter");
  await expect(page.getByLabel("Account name")).toBeVisible();
  await expectFocusInMain(page);
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).press("Enter");
  await expect(page.getByRole("button", { name: "Import 8 transactions" })).toBeVisible();
  await expectFocusInMain(page);
  await page.getByRole("button", { name: "Import 8 transactions" }).press("Enter");
  await expect(page.getByRole("status")).toHaveText(/^Imported 8 transactions/);
  await expectFocusInMain(page);
  await page.getByRole("button", { name: "Import another file" }).press("Enter");
  await expect(page.getByLabel("CSV file from your bank")).toBeVisible();
  await expectFocusInMain(page);

  // Cancel is the safe default, and cancelling goes back to Delete.
  await page.goto("/money/categories");
  await page.getByRole("button", { name: "Delete Other" }).press("Enter");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Delete Other" })).toBeFocused();

  await page.goto("/money/transactions");
  await page
    .getByRole("list", { name: "Transactions, newest first" })
    .getByRole("link", { name: /GROCERY MART: Card purchase/ })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
});

// A fresh user, signed in from their own address, so the other spec files' sign-ins don't count
// towards its limit (198.51.100.0/24 is TEST-NET-2, RFC 5737).
async function signIn(page: Page, email: string, address: string) {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Money Tester" } });

  await page.setExtraHTTPHeaders({ "x-forwarded-for": address });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
}

// The fixture's columns, as the owner would map them once.
async function mapDebitCreditStatement(page: Page) {
  await page.getByLabel("Profile name").fill("Example Bank");
  await page.getByLabel("Decimal separator").selectOption(",");
  await page.getByLabel("Date format").selectOption("YYYY-MM-DD");
  for (const [field, header] of [
    ["Booking date", "Date"],
    ["Amount", "Amount"],
    ["Debit/credit indicator", "D/C"],
    ["Currency", "Currency"],
    ["Counterparty", "Counterparty"],
    ["Counterparty IBAN", "Counterparty account"],
    ["Description", "Purpose"],
    ["Your account's IBAN", "Own account"],
  ] as const) {
    await page.getByLabel(field, { exact: true }).selectOption(header);
  }
  await page.getByLabel("Debit values").fill("D");
}

async function expectSummary(page: Page, figures: Record<string, number>) {
  for (const [term, value] of Object.entries(figures)) {
    const dt = page.locator("dt").filter({ hasText: new RegExp(`^${term}$`) });
    await expect(dt.locator("xpath=following-sibling::dd[1]")).toHaveText(String(value));
  }
}

async function expectFocusInMain(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest("main")))
    .toBe(true);
}

async function checkPage(page: Page, name: string) {
  await test.step(name, async () => {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, "no sideways scrolling").toBeLessThanOrEqual(page.viewportSize()!.width);

    await expectNoAxeViolations(page);

    await expectTabReachesEveryControl(page);
  });
}

// Tabs through the page from the top and checks every visible, enabled control got focus. A radio
// group is one stop (the arrow keys move within it), so its radios share one mark.
async function expectTabReachesEveryControl(page: Page) {
  const controls = await page.evaluate(() => {
    const selector = "a[href], button, input:not([type=hidden]), select, textarea, summary";
    const found = new Map<string, string>();
    document.querySelectorAll<HTMLElement>("[data-tab-check]").forEach((element) => {
      delete element.dataset.tabCheck;
    });
    document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      const disabled = (element as HTMLButtonElement).disabled;
      if (disabled || !element.checkVisibility()) return;
      const radio = element instanceof HTMLInputElement && element.type === "radio";
      const mark = radio ? `radio ${element.name}` : String(index);
      element.dataset.tabCheck = mark;
      if (!found.has(mark)) found.set(mark, `${mark}: ${element.outerHTML.slice(0, 80)}`);
    });
    return [...found.values()];
  });

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = new Set<string>();
  // A few more presses than controls, for the stops the selector doesn't list, such as the import
  // file preview's scrollable region.
  for (let i = 0; i < controls.length + 5; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.tabCheck);
    if (id !== undefined) reached.add(id);
  }
  expect(
    controls.filter((control) => !reached.has(control.slice(0, control.indexOf(":")))),
    "controls Tab doesn't reach",
  ).toEqual([]);
}
