import { randomBytes } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { adminEmail } from "./global-setup";
import { expect, expectLinkFitsPhone, test } from "./test";

const invalidHeading = "This invite link doesn't work";

async function signInAsAdmin(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
}

async function createInvite(page: Page, email = "") {
  await page.goto("/admin/invites");
  await page.getByLabel("Email (optional)").fill(email);
  await page.getByRole("button", { name: "Create invite" }).click();
  const link = page.getByLabel("Invite link");
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  return new URL(await link.inputValue()).pathname;
}

// The friend uses their own browser: a fresh context shares no cookies with the admin's.
async function friendPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

function uniqueEmail(name: string) {
  return `${name}-${randomBytes(4).toString("hex")}@example.test`;
}

test("an admin invites a friend, who signs up and lands in an empty app", async ({
  page,
  browser,
}) => {
  await signInAsAdmin(page);
  const path = await createInvite(page);
  await expectLinkFitsPhone(page.getByLabel("Invite link"));
  const friend = await friendPage(browser);
  const email = uniqueEmail("friend");

  await friend.goto(path);
  await friend.getByLabel("Name").fill("Friend");
  await friend.getByLabel("Email").fill(email);
  await friend.getByLabel("Password").fill("a long enough password");
  await friend.getByRole("button", { name: "Create account" }).click();

  await expect(friend).toHaveURL("/money");
  await expect(friend.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
  await expect(friend.getByRole("link", { name: "Accounts" })).toBeVisible();
  await expect(friend.getByRole("link", { name: "Invites" })).toHaveCount(0);

  // The invite is used up.
  await friend.goto(path);
  await expect(friend.getByRole("heading", { level: 1, name: invalidHeading })).toBeVisible();
});

test("a bound invite pre-fills and locks the email, and shows as used", async ({
  page,
  browser,
}) => {
  await signInAsAdmin(page);
  const email = uniqueEmail("bound");
  const path = await createInvite(page, email);
  const friend = await friendPage(browser);

  await friend.goto(path);

  const emailField = friend.getByLabel("Email");
  await expect(emailField).toHaveValue(email);
  await expect(emailField).not.toBeEditable();
  await friend.getByLabel("Name").fill("Bound Friend");
  await friend.getByLabel("Password").fill("a long enough password");
  await friend.getByRole("button", { name: "Create account" }).click();
  await expect(friend).toHaveURL("/money");

  await page.reload();
  const row = page.getByRole("row", { name: new RegExp(email) });
  await expect(row.getByRole("cell", { name: "used", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
});

test("a revoked invite shows the same page as an unknown one", async ({ page, browser }) => {
  await signInAsAdmin(page);
  const email = uniqueEmail("revoked");
  const path = await createInvite(page, email);

  const row = page.getByRole("row", { name: new RegExp(email) });
  await row.getByRole("button", { name: "Revoke" }).click();
  // Exact, or the email cell ("revoked-…@example.test") matches before the revoke lands.
  await expect(row.getByRole("cell", { name: "revoked", exact: true })).toBeVisible();

  const friend = await friendPage(browser);
  await friend.goto(path);
  const revokedPage = await friend.getByRole("main").innerText();
  await friend.goto("/invite/not-a-real-token");
  expect(await friend.getByRole("main").innerText()).toBe(revokedPage);
  await expect(friend.getByRole("heading", { level: 1, name: invalidHeading })).toBeVisible();
});

test("a signed-in non-admin can't open the invites page", async ({ page, browser }) => {
  await signInAsAdmin(page);
  const path = await createInvite(page);
  const friend = await friendPage(browser);
  await friend.goto(path);
  await friend.getByLabel("Name").fill("Curious");
  await friend.getByLabel("Email").fill(uniqueEmail("curious"));
  await friend.getByLabel("Password").fill("a long enough password");
  await friend.getByRole("button", { name: "Create account" }).click();
  await expect(friend).toHaveURL("/money");

  const response = await friend.goto("/admin/invites");

  expect(response?.status()).toBe(403);
});
