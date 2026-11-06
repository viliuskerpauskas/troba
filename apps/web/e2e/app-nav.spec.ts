import { randomBytes } from "node:crypto";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, expectNoAxeViolations, test } from "./test";

const email = "e2e-app-nav@example.test";

test.beforeEach(async ({ page }) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Nav Tester" } });
  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.41" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
});

test("the header's breadcrumbs lead back up from the page", async ({ page }) => {
  await page.goto("/money/transactions/new");
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("listitem").filter({ hasText: /\w/ })).toHaveText([
    "Money",
    "Transactions",
    "Add transaction",
  ]);
  await expect(trail.getByText("Add transaction")).toHaveAttribute("aria-current", "page");

  await trail.getByRole("link", { name: "Transactions" }).click();
  await expect(page).toHaveURL("/money/transactions");
});

test("the sidebar collapses to icons that name themselves, and stays collapsed", async ({
  page,
}) => {
  const sidebar = page.locator("#app-sidebar");
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");

  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(52);

  // The links keep their names, and hovering one shows it to the right of the icon.
  const settings = sidebar.getByRole("link", { name: "Settings" });
  await settings.hover();
  const tip = page.getByText("Settings", { exact: true }).last();
  await expect(tip).toBeVisible();
  const [link, popup] = [(await settings.boundingBox())!, (await tip.boundingBox())!];
  expect(popup.x).toBeGreaterThan(link.x + link.width);
  await expectNoAxeViolations(page);

  // The server renders it collapsed after a reload, from the cookie.
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(224);
});
