import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { importPresets } from "@troba/core";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, expectPageFitsPhone, test } from "./test";

// SPEC-money M5, ADR-0016: after an import the model suggests a category for the rows no rule
// matched, the row stays uncategorized until the user accepts, and a direct transfer is never
// asked about. The model is e2e/fake-openai.ts, which also refuses a request that carries the
// user's name, an IBAN, a long number, an amount, a date or a transfer's text.

const email = "e2e-ai-categories@example.test";
// Fictional. The fixture's card payment to this merchant is the one row the fake model places.
const ownName = "Jordan Quinn";

// A preset's fictional fixture (the first preset names its account and has direct transfers with a
// counterparty IBAN), looked up by position so no bank is named outside the presets folder. One
// card merchant carries the user's own name, which must be masked before anything is sent.
const statement = {
  name: "statement.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    readFileSync(
      path.join(
        import.meta.dirname,
        "../../../packages/core/src/money/import/presets",
        `${importPresets[0].id}.fixture.csv`,
      ),
      "utf8",
    ).replace('"CORNER CAFE ""NORTH"""', '"CORNER CAFE JORDAN QUINN"'),
  ),
};

test("suggests a category after an import, changes nothing until it is accepted, and skips transfers", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Import a bank statement" }).click();

  // The upload step says what would be sent, and the file input points at it.
  const disclosure = page.locator("#import-categorize-disclosure");
  await expect(disclosure).toContainText(
    "After the import is saved, the counterparty and description of the new transactions that no rule matched are sent to OpenAI",
  );
  await expect(page.getByLabel("CSV file from your bank")).toHaveAccessibleDescription(
    /sent to OpenAI/,
  );
  await page.getByLabel("CSV file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await expect(page.getByText("Read with the profile")).toBeVisible();
  await page.getByRole("button", { name: "Import 8 transactions" }).click();

  // The result says the model placed one row, and that nothing changes until the user accepts.
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );
  const note =
    "AI suggested a category for 1 transaction. It stays uncategorized until you accept it on the transactions list.";
  await expect(page.locator("p:not(.sr-only)", { hasText: note })).toBeVisible();
  await expect(page.locator('p[aria-live="polite"]')).toContainText(note);

  // Before accepting, the month's spending has no Food row: the suggestion changes no total.
  const spent = await uncategorizedCents(page);
  await expect(foodRow(page)).toHaveCount(0);

  await page.goto("/money/transactions");
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(8);
  const grocery = rows.filter({ hasText: "GROCERY MART" });
  await expect(grocery).toContainText("Uncategorized");
  await expect(grocery).toContainText("suggested: Food");

  // A direct transfer (it has a counterparty IBAN) and the row with the user's name get nothing.
  for (const text of ["EXAMPLE LANDLORD", "Savings round-up", "JORDAN QUINN"]) {
    const row = rows.filter({ hasText: text });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("suggested:");
    await expect(row.getByRole("button", { name: /^Accept/ })).toHaveCount(0);
  }
  await expect(list.getByText("suggested:")).toHaveCount(1);

  // The strip counts what is waiting, and the page fits a phone with the strip and the chip.
  const strip = page.getByRole("region", { name: "Suggestions waiting" });
  await expect(strip).toContainText("1 transaction from 1 merchant has a suggested category");
  await expect(
    strip.getByRole("button", { name: "Accept all 1 pending suggestion" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expectPageFitsPhone(page);
  const accept = grocery.getByRole("button", { name: /^Accept/ });
  const box = (await accept.boundingBox())!;
  expect(box.x + box.width, "Accept is on a 375 px screen").toBeLessThanOrEqual(375);
  expect(box.height, "Accept is touch-sized").toBeGreaterThanOrEqual(44);

  // Accepting is the user's own choice: the row now has the category, the chip and strip are gone.
  await accept.click();
  // The list's one shared notice, not the status lines of the buttons above it.
  await expect(page.locator(`[role="status"][tabindex="-1"]`)).toHaveText(
    "Categorized 1 transaction as Food.",
  );
  await expect(grocery).not.toContainText("Uncategorized");
  await expect(grocery).toContainText("Food");
  await expect(list.getByText("suggested:")).toHaveCount(0);
  await expect(strip).toHaveCount(0);

  // The month's totals moved by the row's amount, from Uncategorized to Food.
  await openReport(page);
  await expect(foodRow(page)).toHaveCount(1);
  await expect(foodRow(page)).toContainText("€38.45");
  expect(await uncategorizedCents(page)).toBe(spent - 3845);
});

test("dismisses a suggestion, asks again, accepts all after a confirmation, and a remount replays nothing", async ({
  page,
}) => {
  await signIn(page, {
    email: "e2e-ai-categories-review@example.test",
    name: "Taylor Example",
    ip: "198.51.100.32",
  });
  // Two rows of the one merchant the fake model knows, so one decision covers both.
  const twoOfOne = {
    ...statement,
    buffer: Buffer.from(
      statement.buffer
        .toString("utf8")
        .replace('"EXAMPLE STREAMING"', '"GROCERY MART"')
        .replace('"CORNER CAFE JORDAN QUINN"', '"CORNER CAFE NORTH"'),
    ),
  };
  await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("CSV file from your bank").setInputFiles(twoOfOne);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await page.getByRole("button", { name: "Import 8 transactions" }).click();
  await expect(page.locator('p[aria-live="polite"]')).toContainText(
    "AI suggested categories for 2 transactions.",
  );

  await page.goto("/money/transactions");
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  const chips = list.getByText("suggested:");
  const notice = page.locator('[role="status"][tabindex="-1"]');
  const strip = page.getByRole("region", { name: "Suggestions waiting" });
  await expect(chips).toHaveCount(2);

  // Dismiss drops the suggestion on both rows of the merchant and the strip with it.
  await list
    .getByRole("button", { name: /^Dismiss the suggestion/ })
    .first()
    .click();
  await expect(notice).toHaveText("Dismissed the suggestion on 2 transactions.");
  await expect(chips).toHaveCount(0);
  await expect(strip).toHaveCount(0);

  // Ask again offers the dismissed merchant to the model once more; the suggestion returns.
  await page.getByRole("button", { name: "Ask again" }).click();
  await expect(chips).toHaveCount(2);
  await expect(strip).toContainText("2 transactions from 1 merchant have a suggested category");

  // Accept all asks first, naming the count; Escape cancels, hands the focus back, changes nothing.
  const opener = strip.getByRole("button", { name: "Accept all 2 pending suggestions" });
  await opener.click();
  const question = strip.getByText("Give 2 transactions from 1 merchant their suggested category?");
  await expect(question).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(chips).toHaveCount(2);

  await opener.click();
  await strip.getByRole("button", { name: "Yes, accept all 2" }).click();
  await expect(notice).toHaveText("Categorized 2 transactions from 1 merchant.");
  await expect(chips).toHaveCount(0);
  await expect(strip).toHaveCount(0);

  // Navigating away and back by links remounts the list: the old sentence is not replayed and the
  // keyboard focus is not pulled to a row.
  await page.getByRole("link", { name: "Money" }).first().click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(list).toBeVisible();
  await expect(notice).toHaveText("");
  await page.waitForTimeout(400);
  await expect(list.locator(":focus")).toHaveCount(0);
});

// The month the fixture's rows are in, as the report shows it.
async function openReport(page: Page) {
  await page.goto("/money/report?month=2026-09");
  await expect(categoryTable(page)).toBeVisible();
}

function categoryTable(page: Page) {
  return page.getByRole("table", { name: "Spending by category in EUR" });
}

function foodRow(page: Page) {
  return categoryTable(page).getByRole("row").filter({ hasText: /^Food/ });
}

// The Uncategorized row's amount in the September report, in cents. The report is opened here, so
// the wizard's page is left behind.
async function uncategorizedCents(page: Page): Promise<number> {
  await openReport(page);
  const row = categoryTable(page)
    .getByRole("row")
    .filter({ hasText: /^Uncategorized/ });
  const cell = (await row.getByRole("cell").first().innerText()).replace(/[^\d.]/g, "");
  return Math.round(Number(cell) * 100);
}

async function signIn(
  page: Page,
  user: { email: string; name: string; ip: string } = { email, name: ownName, ip: "198.51.100.31" },
) {
  await db().$client.query("delete from users where email = $1", [user.email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email: user.email, password, name: user.name } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": user.ip });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
}
