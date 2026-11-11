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
    "After the import is saved, the counterparty and description of the new transactions that no rule matched are sent to an AI service",
  );
  await expect(page.getByLabel("Statement file from your bank")).toHaveAccessibleDescription(
    /sent to an AI service/,
  );
  await page.getByLabel("Statement file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await expect(page.getByText("Read with the profile")).toBeVisible();
  await page.getByRole("button", { name: "Import 8 transactions" }).click();

  // The import doesn't wait for the model (ADR-0020): the result says suggestions are being
  // prepared by the worker, and that nothing changes until the user accepts.
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );
  const note =
    "AI is preparing category suggestions. They appear on the transactions list when ready, and each transaction stays uncategorized until you accept its suggestion.";
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
  await page.getByLabel("Statement file from your bank").setInputFiles(twoOfOne);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await page.getByRole("button", { name: "Import 8 transactions" }).click();
  await expect(page.locator('p[aria-live="polite"]')).toContainText(
    "AI is preparing category suggestions.",
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

// What the import result and the list say when no suggestion could be made: the daily limit is
// spent, the model is unavailable, or the user turned the feature off. In none of them does a
// row get a suggestion.

const listSuggestionsStatus = (page: Page) =>
  page.locator("form", { has: page.getByRole("button", { name: "Suggest categories" }) });

test("says the daily limit is reached on the list, after an import, and suggests nothing", async ({
  page,
}) => {
  const user = {
    email: "e2e-ai-categories-capped@example.test",
    name: "Casey Example",
    ip: "198.51.100.33",
  };
  await signIn(page, user);
  // The day's allowance is spent before anything is imported, whatever the server's limit is.
  await db().$client.query(
    "insert into money_ai_categorize_uses (user_id, merchants) select id, 100000 from users where email = $1",
    [user.email],
  );

  await importStatement(page, statement);
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );
  // The cap is the worker's: the import only queued the run.
  await expect(page.locator('p[aria-live="polite"]')).toHaveText(
    "AI is preparing category suggestions. They appear on the transactions list when ready, and each transaction stays uncategorized until you accept its suggestion.",
  );

  // The list follows the import's run; the button is usable again once it has ended.
  await page.goto("/money/transactions");
  await page.getByRole("button", { name: "Suggest categories" }).click();
  await expect(listSuggestionsStatus(page).getByRole("status")).toHaveText(
    "The daily limit on AI suggestions is reached, so these transactions stay uncategorized for now. Try again later.",
  );
  await expect(page.getByText("suggested:")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Suggestions waiting" })).toHaveCount(0);
});

test("says suggestions aren't available when the model fails, and the import is saved anyway", async ({
  page,
}) => {
  await signIn(page, {
    email: "e2e-ai-categories-unavailable@example.test",
    name: "Riley Example",
    ip: "198.51.100.34",
  });
  // e2e/fake-openai.ts fails every categorization request that carries this merchant.
  const outage = {
    ...statement,
    buffer: Buffer.from(
      statement.buffer.toString("utf8").replace('"EXAMPLE STREAMING"', '"EXAMPLE OUTAGE"'),
    ),
  };

  await importStatement(page, outage);
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );
  // The model fails in the worker, after the import has answered.
  await expect(page.locator('p[aria-live="polite"]')).toHaveText(
    "AI is preparing category suggestions. They appear on the transactions list when ready, and each transaction stays uncategorized until you accept its suggestion.",
  );

  await page.goto("/money/transactions");
  await expect(
    page.getByRole("list", { name: "Transactions, newest first" }).getByRole("listitem"),
  ).toHaveCount(8);
  await page.getByRole("button", { name: "Suggest categories" }).click();
  await expect(listSuggestionsStatus(page).getByRole("status")).toHaveText(
    "Suggestions aren't available right now. Nothing was changed, so try again later.",
  );
  await expect(page.getByText("suggested:")).toHaveCount(0);
});

test("says nothing about AI suggestions, and offers none, to a user who turned them off", async ({
  page,
}) => {
  await signIn(page, {
    email: "e2e-ai-categories-off@example.test",
    name: "Morgan Example",
    ip: "198.51.100.35",
  });
  await page.goto("/settings");
  const settings = page.getByRole("region", { name: "AI suggestions" });
  await settings.getByLabel("Suggest categories with AI").uncheck();
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(settings.getByRole("status")).toHaveText("AI suggestions are off. Nothing is sent.");

  await page.goto("/money");
  await page.getByRole("link", { name: "Import a bank statement" }).click();
  // The upload step, once it is there, doesn't say anything would be sent.
  await expect(page.getByLabel("Statement file from your bank")).toBeVisible();
  await expect(page.locator("#import-categorize-disclosure")).toHaveCount(0);
  await importStatement(page, statement, { fromUploadStep: true });
  await expect(page.getByRole("status")).toHaveText(
    "Imported 8 transactions into Example Bank current.",
  );
  // No note at all: not even that nothing was suggested. GROCERY MART is the merchant the fake
  // model places, so a suggestion on it would mean its text was sent.
  await expect(page.locator('p[aria-live="polite"]')).toHaveText("");
  await expect(page.getByText(/\bAI\b/)).toHaveCount(0);

  await page.goto("/money/transactions");
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  await expect(list.getByRole("listitem").filter({ hasText: "GROCERY MART" })).toContainText(
    "Uncategorized",
  );
  await expect(page.getByText("suggested:")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suggest categories" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask again" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Suggestions waiting" })).toHaveCount(0);
});

// Uploads the file with a new account and imports its 8 rows, from the money page or, with
// fromUploadStep, from the import page already open.
async function importStatement(
  page: Page,
  file: typeof statement,
  { fromUploadStep = false } = {},
) {
  if (!fromUploadStep) await page.getByRole("link", { name: "Import a bank statement" }).click();
  await page.getByLabel("Statement file from your bank").setInputFiles(file);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Account name").fill("Example Bank current");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await page.getByRole("button", { name: "Import 8 transactions" }).click();
}

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
