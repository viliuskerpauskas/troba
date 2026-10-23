import { type Locator, test as base, expect } from "@playwright/test";
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
