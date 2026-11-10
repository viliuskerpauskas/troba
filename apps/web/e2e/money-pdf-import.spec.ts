import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, expectPageFitsPhone, test } from "./test";

// SPEC-money M3, ADR-0018: a PDF statement is sent to the model only after the user confirms, read
// by the worker in the background, then previewed and saved like any import. The model is
// e2e/fake-openai.ts, which the worker runs with too: it reads the fictional PDF below.

const email = "e2e-pdf-import@example.test";

// Fictional, and not a real PDF beyond its header: the fake model recognizes it by the marker line.
const statement = {
  name: "statement.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\n% EXAMPLE BANK STATEMENT FOR E2E\n%%EOF\n", "latin1"),
};

// SPEC-money success criterion 6: every page works at 360px.
test.use({ viewport: { width: 360, height: 740 } });

test("confirms the send, waits for the reading, then previews and saves a PDF statement", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/money/import");
  await page.getByLabel("Statement file from your bank").setInputFiles(statement);
  await page.getByRole("button", { name: "Continue" }).click();

  // Nothing is sent before the user confirms.
  await expect(page.getByRole("heading", { name: "Send this statement to AI?" })).toBeVisible();
  await expect(page.getByText(/the whole statement is sent to it/)).toBeVisible();
  await expectPageFitsPhone(page);
  await page.getByRole("button", { name: "Send to AI and read it" }).click();

  // The reading state, still there after leaving the page and coming back.
  await expect(page.getByRole("heading", { name: "Reading your statement" })).toBeVisible();
  await page.goto("/money");
  await page.goto("/money/import");

  // Read: the statement's IBAN is one the user has no account for yet.
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Read by AI from statement.pdf")).toBeVisible();
  await page.getByLabel("Account name").fill("Example Bank");
  await page.getByRole("button", { name: "Create the account and preview" }).click();
  await expect(page.getByRole("button", { name: "Import 2 transactions" })).toBeVisible();
  await expectPageFitsPhone(page);
  await page.getByRole("button", { name: "Import 2 transactions" }).click();

  await expect(page.getByText("Imported 2 transactions into Example Bank.")).toBeVisible();
  // Saved: the page starts afresh.
  await page.goto("/money/import");
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

async function signIn(page: Page) {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "PDF Tester" } });

  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.52" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
}
