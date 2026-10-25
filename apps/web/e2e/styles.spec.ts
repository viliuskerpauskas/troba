import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, expectPageFitsPhone, test } from "./test";

const email = "e2e-styles@example.test";

// Everything the page's CSP blocks from here on: the console's reports and the document's
// securitypolicyviolation events, which every page the tab loads records again.
async function recordCspViolations(page: Page) {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) messages.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { cspViolations?: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) =>
      seen.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  return {
    // The console's reports so far, and the current document's events; call it once the page
    // has settled.
    async violations() {
      const events = await page.evaluate(
        () => (window as { cspViolations?: string[] }).cspViolations,
      );
      expect(events, "the violation listener is installed").toBeDefined();
      return [...messages, ...events!];
    },
  };
}

// The stylesheet comes from the build, under the production CSP, and its rules apply: Tailwind's
// reset and the shadcn theme give the primary button a filled background, not the browser's.
test("the stylesheet loads and applies under the production CSP", async ({ page }) => {
  const csp = await recordCspViolations(page);

  const response = await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");

  const policy = response!.headers()["content-security-policy"] ?? "";
  expect(policy).not.toContain("unsafe-eval");
  await expect(page.locator('link[rel="stylesheet"]').first()).toBeAttached();

  const button = page.getByRole("button", { name: "Sign in" });
  const background = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  // Unstyled, a button is the browser's light grey (buttonface) or transparent after a reset.
  expect(background).not.toMatch(/^rgba\(0, 0, 0, 0\)$|^rgb\(239, 239, 239\)$/);
  expect(await button.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe(
    "0px",
  );

  expect(await csp.violations()).toEqual([]);
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("sign-in, transactions and the report fit, with nothing blocked", async ({ page }) => {
    const csp = await recordCspViolations(page);
    await visit(page, "/sign-in");

    await db().$client.query("delete from users where email = $1", [email]);
    const password = randomBytes(18).toString("base64");
    await auth().api.createUser({ body: { email, password, name: "Styles Tester" } });
    // Its own address, so the other spec files' sign-ins don't count towards its limit
    // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.40" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // The first visit to Money seeds the Cash account and the default categories.
    await expect(page).toHaveURL("/money");

    // A long counterparty with no spaces, which has to wrap rather than widen the list.
    await db().$client.query(
      `insert into money_transactions
         (user_id, account_id, booked_on, amount_cents, currency, counterparty, source)
       select a.user_id, a.id, date '2026-10-03', -123456, 'EUR', $2, 'manual'
       from money_accounts a join users u on a.user_id = u.id where u.email = $1`,
      [email, "EXAMPLE-MERCHANT-WITH-A-VERY-LONG-NAME-AND-NO-SPACES-AT-ALL"],
    );

    await visit(page, "/money/transactions");
    // Recharts draws the chart here, setting style attributes the CSP has to allow.
    await visit(page, "/money/report?month=2026-10");
    await expect(page.getByRole("img", { name: "Spending by category in EUR" })).toBeVisible();
    expect(await csp.violations()).toEqual([]);
  });
});

// No sideways scrolling, every button on screen, and no axe violation.
async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expectPageFitsPhone(page);
}
