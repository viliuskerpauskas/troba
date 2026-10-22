import { randomBytes } from "node:crypto";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { expect, test } from "./test";

const email = "e2e-receipts@example.test";

// A 1×1 PNG: real image bytes, so the browser can show it.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("attaches a receipt to a transaction, views it and removes it", async ({ page }) => {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Receipts Tester" } });

  // Its own address, so the other spec files' sign-ins don't count towards its limit
  // (198.51.100.0/24 is TEST-NET-2, RFC 5737).
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.24" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");

  await page.goto("/money/transactions/new");
  await page.getByLabel("Date").fill("2026-10-03");
  await page.getByLabel("Amount").fill("12.50");
  await page.getByLabel("Counterparty (optional)").fill("GROCERY MART");
  await page.getByRole("button", { name: "Add transaction" }).click();
  const list = page.getByRole("list", { name: "Transactions, newest first" });
  await expect(list.getByRole("listitem")).not.toContainText("Receipt");
  await list.getByRole("link", { name: /GROCERY MART/ }).click();
  await expect(page.getByText("No receipts attached.")).toBeVisible();

  // A text file named as a photo is refused by its content.
  const receipt = page.getByLabel("Add a receipt");
  await receipt.setInputFiles({
    name: "receipt.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not a photo"),
  });
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Attach a JPEG, PNG, WebP or HEIC photo, or a PDF.",
  );

  await receipt.setInputFiles({ name: "GROCERY MART.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Attach" }).click();
  const receipts = page.getByRole("list", { name: "Attached receipts" });
  await expect(receipts.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  const opened = page.waitForEvent("popup");
  await receipts.getByRole("link", { name: "GROCERY MART.png" }).click();
  const view = await opened;
  const image = view.locator("img");
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const served = await view.request.get(view.url());
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  await view.close();

  const download = page.waitForEvent("download");
  await receipts.getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("GROCERY MART.png");

  await page.getByRole("link", { name: "Back to transactions" }).click();
  await expect(list.getByRole("listitem")).toContainText("· Receipt");

  await list.getByRole("link", { name: /GROCERY MART/ }).click();
  await page.getByRole("button", { name: "Remove GROCERY MART.png" }).click();
  await expect(page.getByText("No receipts attached.")).toBeVisible();
});
