import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

const email = "e2e-categories@example.test";

test.afterAll(async () => {
  await db().$client.end();
});

test("adds, renames and deletes categories; deleting one uncategorizes its transactions", async ({
  page,
}) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Categories Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.18" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  await page.getByRole("link", { name: "Categories" }).click();
  const yours = page.getByRole("region", { name: "Your categories" });
  await expect(yours.getByRole("listitem")).toHaveCount(10);
  await expect(
    yours.getByRole("listitem").filter({ hasText: "Not counted as spending" }),
  ).toHaveCount(1);
  await expect(
    yours.getByRole("listitem").filter({ hasText: "Not counted as spending" }).getByRole("textbox"),
  ).toHaveValue("Transfers");

  const create = page.getByRole("region", { name: "New category" });
  await create.getByLabel("Name").fill("Pets");
  await create.getByRole("button", { name: "Add category" }).click();
  await expect(create.getByRole("status")).toHaveText("Added Pets.");
  await expect(yours.getByRole("listitem")).toHaveCount(11);

  await yours.getByLabel("Name of Food").fill("Groceries");
  await yours.getByRole("button", { name: "Rename Food" }).click();
  await expect(yours.getByLabel("Name of Groceries")).toHaveValue("Groceries");

  await page.goto("/money/transactions/new");
  await page.getByLabel("Date").fill("2026-10-03");
  await page.getByLabel("Amount").fill("12,50");
  await page.getByLabel("Counterparty (optional)").fill("PET SHOP");
  await page.getByLabel("Category").selectOption("Pets");
  await page.getByRole("button", { name: "Add transaction" }).click();
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).toContainText("Pets · -€12.50");

  await page.goto("/money/categories");
  await yours.getByRole("button", { name: "Delete Pets" }).click();
  await expect(yours.getByRole("alert")).toHaveText(
    "Delete Pets? Its transactions become uncategorized.",
  );
  await yours.getByRole("button", { name: "Cancel" }).click();
  await expect(yours.getByRole("listitem")).toHaveCount(11);

  await yours.getByRole("button", { name: "Delete Pets" }).click();
  await yours.getByRole("button", { name: "Yes, delete" }).click();
  await expect(yours.getByRole("listitem")).toHaveCount(10);
  await expect(yours.getByLabel("Name of Pets")).toHaveCount(0);

  await page.goto("/money/transactions");
  await expect(list.getByRole("listitem")).toContainText("Uncategorized · -€12.50");
});
