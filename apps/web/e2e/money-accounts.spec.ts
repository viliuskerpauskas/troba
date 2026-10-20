import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

const email = "e2e-accounts@example.test";

test.afterAll(async () => {
  await db().$client.end();
});

test("a new user gets a Cash account and can create, rename, archive and restore accounts", async ({
  page,
}) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Accounts Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.16" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  await page.getByRole("link", { name: "Accounts" }).click();
  const active = page.getByRole("region", { name: "Your accounts" });
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(active.getByLabel("Name of Cash")).toHaveValue("Cash");

  const create = page.getByRole("region", { name: "New account" });
  await create.getByLabel("Name").fill("Example Bank current");
  await create.getByLabel("IBAN (optional)").fill("DE51 0000 0000 0123 4567 89");
  await create.getByRole("button", { name: "Create account" }).click();
  await expect(create.getByRole("alert")).toHaveText("That IBAN isn't valid. Check it for typos.");

  await create.getByLabel("IBAN (optional)").fill("de50 0000 0000 0123 4567 89");
  await create.getByRole("button", { name: "Create account" }).click();
  await expect(create.getByRole("status")).toHaveText("Created Example Bank current.");
  const bank = active.getByRole("listitem").filter({ hasText: "IBAN DE50 0000 0000 0123 4567 89" });
  await expect(bank).toContainText("Bank, EUR");

  await active.getByLabel("Name of Cash").fill("Wallet");
  await active.getByRole("button", { name: "Rename Cash" }).click();
  await expect(active.getByLabel("Name of Wallet")).toHaveValue("Wallet");

  await active.getByRole("button", { name: "Archive Example Bank current" }).click();
  await expect(active.getByRole("listitem")).toHaveCount(1);
  const archived = page.getByRole("region", { name: "Archived" });
  await expect(archived).toContainText("Example Bank current (Bank, EUR)");

  await archived.getByRole("button", { name: "Restore Example Bank current" }).click();
  await expect(active.getByRole("listitem")).toHaveCount(2);
  await expect(archived).toHaveCount(0);

  // Defaults are seeded once: revisiting doesn't bring Cash back.
  await page.reload();
  await expect(active.getByRole("listitem")).toHaveCount(2);
  await expect(active.getByLabel("Name of Cash")).toHaveCount(0);
});
