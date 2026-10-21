import { test as base } from "@playwright/test";
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
