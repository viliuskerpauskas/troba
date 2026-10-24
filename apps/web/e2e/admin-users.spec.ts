import { randomBytes } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { adminEmail } from "./global-setup";
import { expect, expectLinkFitsPhone, expectPageFitsPhone, field, test } from "./test";

const invalidHeading = "This reset link doesn't work";

// Each test gets its own user, so disabling or resetting one can't affect other tests.
async function createUser(email: string) {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Managed User" } });
  return { email, password };
}

// The sign-in limit counts attempts still in progress, and the other spec files share
// loopback's limit of 5 while running alongside, so every device here gets its own address
// (TEST-NET-1, RFC 5737). The tests in a file run one at a time in one worker.
let deviceCount = 0;

// A separate browser context is a separate device with its own cookies.
async function signIn(browser: Browser, email: string, password: string) {
  const page = await (await browser.newContext()).newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${100 + ++deviceCount}` });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

async function signedIn(browser: Browser, email: string, password: string) {
  const page = await signIn(browser, email, password);
  await expect(page).toHaveURL("/money");
  return page;
}

async function adminPage(browser: Browser) {
  const page = await signedIn(browser, adminEmail, process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL("/admin/users");
  return page;
}

function userItem(page: Page, email: string) {
  return page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: email });
}

async function expectSignedOut(page: Page) {
  await page.goto("/settings");
  await expect(page).toHaveURL("/sign-in");
}

test("an admin disables a user, who is signed out and can't sign in until enabled", async ({
  browser,
}) => {
  const user = await createUser("e2e-disabled@example.test");
  const usersLaptop = await signedIn(browser, user.email, user.password);
  const admin = await adminPage(browser);
  const row = userItem(admin, user.email);

  await row.getByRole("button", { name: "Disable" }).click();

  await expect(field(row, "Status")).toHaveText("disabled");
  await expectSignedOut(usersLaptop);
  const refused = await signIn(browser, user.email, user.password);
  await expect(refused.getByText("Email or password is incorrect.")).toBeVisible();

  await row.getByRole("button", { name: "Enable" }).click();

  await expect(field(row, "Status")).toHaveText("active");
  await signedIn(browser, user.email, user.password);
});

test("an admin creates a reset link, and the user sets a new password with it once", async ({
  browser,
}) => {
  const user = await createUser("e2e-reset@example.test");
  const usersPhone = await signedIn(browser, user.email, user.password);
  const admin = await adminPage(browser);

  const createLink = userItem(admin, user.email).getByRole("button", { name: "Create reset link" });
  await createLink.click();
  const link = admin.getByLabel(`Reset link for ${user.email}`);
  await expect(link).toHaveValue(/\/reset\/[A-Za-z0-9_-]{43}$/);
  // It shows below the list, out of the item's sight, so focus moves to it, and again for a
  // new link.
  await expect(link).toBeFocused();
  const firstLink = await link.inputValue();
  await createLink.click();
  await expect(link).not.toHaveValue(firstLink);
  await expect(link).toBeFocused();
  const path = new URL(await link.inputValue()).pathname;
  await expectLinkFitsPhone(link);

  const usersLaptop = await (await browser.newContext()).newPage();
  await usersLaptop.goto(path);
  const newPassword = randomBytes(18).toString("base64");
  await usersLaptop.getByLabel("New password", { exact: true }).fill(newPassword);
  await usersLaptop.getByLabel("Confirm new password").fill(newPassword);
  await usersLaptop.getByRole("button", { name: "Set password" }).click();
  await expect(usersLaptop.getByRole("status")).toContainText("Your password is set");

  await expectSignedOut(usersPhone);
  await signedIn(browser, user.email, newPassword);
  await usersLaptop.goto(path);
  await expect(usersLaptop.getByRole("heading", { level: 1, name: invalidHeading })).toBeVisible();
});

test("a reset link created before the page's scripts run still shows", async ({ browser }) => {
  const user = await createUser("e2e-reset-no-js@example.test");
  const admin = await adminPage(browser);
  // No JavaScript: the form posts and the server renders the result, as it does for a form
  // sent before hydration.
  const noScripts = await (
    await browser.newContext({
      javaScriptEnabled: false,
      storageState: await admin.context().storageState(),
    })
  ).newPage();
  await noScripts.goto("/admin/users");

  await userItem(noScripts, user.email).getByRole("button", { name: "Create reset link" }).click();

  await expect(noScripts.getByLabel(`Reset link for ${user.email}`)).toHaveValue(
    /\/reset\/[A-Za-z0-9_-]{43}$/,
  );
});

test("a signed-in non-admin gets 403 on the admin pages", async ({ browser }) => {
  const user = await createUser("e2e-not-admin@example.test");
  const page = await signedIn(browser, user.email, user.password);

  for (const path of ["/admin", "/admin/users"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
  }
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
});

test("the users page fits a phone with long emails, and every action can be used", async ({
  browser,
}) => {
  const emails = [1, 2, 3].map(
    (n) => `manageduserwithaverylongemailaddressnumber${n}a2b3c4d@example.test`,
  );
  for (const email of emails) await createUser(email);
  const admin = await adminPage(browser);
  await admin.setViewportSize({ width: 375, height: 812 });
  await admin.reload();

  await expect(userItem(admin, emails[2]!)).toBeVisible();
  await expectPageFitsPhone(admin);

  const item = userItem(admin, emails[0]!);
  await item.getByRole("button", { name: "Disable" }).click();
  await expect(field(item, "Status")).toHaveText("disabled");
  await item.getByRole("button", { name: "Create reset link" }).click();
  await expect(admin.getByLabel(`Reset link for ${emails[0]}`)).toBeFocused();
  await expectPageFitsPhone(admin);
});
