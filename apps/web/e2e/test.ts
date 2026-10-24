import AxeBuilder from "@axe-core/playwright";
import { type Locator, type Page, test as base, expect } from "@playwright/test";
import { db } from "../src/server/db";

export { expect } from "@playwright/test";

// Specs import test from here. Playwright runs several spec files in one worker, one after
// another, and they share the server modules' one pool (auth() holds it too), so it is ended
// once, when the worker stops, not after each file.
export const test = base.extend<object, { endPool: void }>({
  endPool: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures a function uses from its first parameter.
    async ({}, use) => {
      await use();
      await db().$client.end();
    },
    { scope: "worker", auto: true },
  ],
});

// A one-time link is too long for a phone screen: its input fits the viewport, the link scrolls
// inside it, and focusing it selects the whole link for copying. The page stays at phone size.
export async function expectLinkFitsPhone(link: Locator) {
  const page = link.page();
  await page.setViewportSize({ width: 375, height: 812 });
  const box = (await link.boundingBox())!;
  expect(box.x + box.width, "link input fits a 375 px screen").toBeLessThanOrEqual(375);
  // Blurred first, so the focus below is a new one even when the link already had it.
  await link.blur();
  await link.focus();
  const [start, end, length] = await link.evaluate((input: HTMLInputElement) => [
    input.selectionStart,
    input.selectionEnd,
    input.value.length,
  ]);
  expect([start, end], "focus selects the link").toEqual([0, length]);
}

// A page at phone width: nothing scrolls sideways, every button is on screen, and axe finds no
// WCAG 2.1 A or AA violation.
export async function expectPageFitsPhone(page: Page) {
  const viewport = page.viewportSize()!.width;
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "no sideways scrolling").toBeLessThanOrEqual(viewport);
  for (const button of await page.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.x + box.width, `${await button.innerText()} is on screen`).toBeLessThanOrEqual(
      viewport,
    );
  }

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((node) => node.target.join(" ")) })),
    "axe violations",
  ).toEqual([]);
}

// The value of a field in a description list: the dd that follows the dt named term.
export function field(scope: Locator, term: string) {
  return scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");
}
