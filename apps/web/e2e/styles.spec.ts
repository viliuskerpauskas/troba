import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const email = "e2e-styles@example.test";

// Console messages and violation events for anything the page's CSP blocked.
function recordCspViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  return {
    violations,
    // Reports what the document saw since it loaded; call it once the page has settled.
    async seen() {
      return page.evaluate(() => (window as { cspViolations?: string[] }).cspViolations ?? []);
    },
  };
}

// The stylesheet comes from the build, under the production CSP, and its rules apply: Tailwind's
// reset and the shadcn theme give the primary button a filled background, not the browser's.
test("the stylesheet loads and applies under the production CSP", async ({ page }) => {
  const csp = recordCspViolations(page);
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { cspViolations?: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) =>
      seen.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });

  const response = await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");

  const policy = response!.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  expect(policy).not.toContain("unsafe-eval");
  await expect(page.locator('link[rel="stylesheet"]').first()).toBeAttached();

  const button = page.getByRole("button", { name: "Sign in" });
  const background = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  // Unstyled, a button is the browser's light grey (buttonface) or transparent after a reset.
  expect(background).not.toMatch(/^rgba?\(0, 0, 0, 0\)$|^rgb\(239, 239, 239\)$/);
  expect(await button.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe(
    "0px",
  );

  expect(csp.violations).toEqual([]);
  expect(await csp.seen()).toEqual([]);
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("sign-in, transactions and the report don't scroll sideways", async ({ page }) => {
    await expectNoSideways(page, "/sign-in");

    await db().$client.query("delete from users where email = $1", [email]);
    const password = randomBytes(18).toString("base64");
    await auth().api.createUser({ body: { email, password, name: "Styles Tester" } });
    // Its own address, so the other spec files' sign-ins don't count towards its limit
    // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.40" });
    await page.goto("/sign-in");
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

    await expectNoSideways(page, "/money/transactions");
    await expectNoSideways(page, "/money/report?month=2026-10");
  });
});

async function expectNoSideways(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${path} has no sideways scrolling`).toBeLessThanOrEqual(375);
}
