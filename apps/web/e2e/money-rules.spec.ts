import { randomBytes } from "node:crypto";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const email = "e2e-rules@example.test";

test("creates a rule from an uncategorized transaction and applies it, keeping a category set by hand", async ({
  page,
}) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Rules Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.20" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  const list = page.getByRole("list", { name: "Transactions, newest first" });
  for (const [day, counterparty, category] of [
    ["2026-10-03", "GROCERY MART", "Uncategorized"],
    ["2026-10-02", "GROCERY MART EXPRESS", "Shopping"],
  ]) {
    await page.goto("/money/transactions/new");
    await page.getByLabel("Date").fill(day!);
    await page.getByLabel("Amount").fill("12,50");
    await page.getByLabel("Counterparty (optional)").fill(counterparty!);
    await page.getByLabel("Category").selectOption(category!);
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(list).toBeVisible();
  }

  // Only an uncategorized transaction offers a rule.
  await list.getByRole("link", { name: /GROCERY MART EXPRESS/ }).click();
  await expect(page.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create rule from this" })).toHaveCount(0);
  await page.goto("/money/transactions");
  await list.getByRole("link", { name: /GROCERY MART$/ }).click();
  await page.getByRole("link", { name: "Create rule from this" }).click();

  await expect(page).toHaveURL(/\/money\/rules\?from=/);
  const create = page.getByRole("region", { name: "New rule" });
  await expect(create.getByLabel("When")).toHaveValue("counterparty");
  await expect(create.getByLabel("contains (any case)")).toHaveValue("GROCERY MART");
  await create.getByLabel("Category").selectOption("Food");
  await create.getByRole("button", { name: "Add rule" }).click();
  await expect(create.getByRole("status")).toContainText("Rule added.");
  await expect(create.getByLabel("contains (any case)")).toHaveValue("");

  const rules = page.getByRole("list", { name: "Rules, first match wins" });
  await expect(rules.getByRole("listitem")).toHaveText([
    /Counterparty contains “GROCERY MART” → Food/,
  ]);

  await page.getByRole("button", { name: "Apply rules to uncategorized" }).click();
  await expect(page.getByRole("region", { name: "Your rules" }).getByRole("status")).toHaveText(
    "Categorized 1 transaction.",
  );

  await page.goto("/money/transactions");
  // A list item's text has no space where its line breaks.
  await expect(list.getByRole("listitem")).toHaveText([
    /GROCERY MARTFood · -€12.50/,
    /GROCERY MART EXPRESSShopping · -€12.50/,
  ]);

  // Reordering and deleting.
  await page.goto("/money/rules");
  await create.getByLabel("When").selectOption("description");
  await create.getByLabel("contains (any case)").fill("Card purchase");
  await create.getByLabel("Category").selectOption("Shopping");
  await create.getByRole("button", { name: "Add rule" }).click();
  await expect(rules.getByRole("listitem")).toHaveText([
    /Counterparty contains “GROCERY MART” → Food/,
    /Description contains “Card purchase” → Shopping/,
  ]);

  await rules
    .getByRole("button", { name: "Move up: Description contains “Card purchase”" })
    .click();
  await expect(rules.getByRole("listitem")).toHaveText([
    /Description contains “Card purchase” → Shopping/,
    /Counterparty contains “GROCERY MART” → Food/,
  ]);

  await rules.getByRole("button", { name: "Delete: Counterparty contains “GROCERY MART”" }).click();
  await expect(rules.getByRole("listitem")).toHaveText([
    /Description contains “Card purchase” → Shopping/,
  ]);
});
