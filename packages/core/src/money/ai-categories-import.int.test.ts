import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMoneyUser,
  insertImportedRows,
  readTransaction,
  recordingModel,
  testAiCategorizeDailyLimit,
  type MoneyUser,
} from "./ai-categories-fixture";
import { setAiCategorization } from "./ai-categorization-setting";
import type { CategorizationModelClient } from "./ai-categories";
import { suggestAfterImport } from "./ai-categories-import";
import { createRule } from "./rules";

// What an import leaves behind for the model (SPEC-money M5, ADR-0016): after the import is
// saved, its unmatched rows get suggestions, and whatever the model does, the rows are as saved.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;

function createUser() {
  return createMoneyUser(db);
}

// An import with the given merchants as its rows, as commitImport leaves them.
async function insertImport(user: MoneyUser, counterparties: string[]) {
  const [created] = await db
    .insert(schema.moneyImports)
    .values({
      userId: user.userId,
      accountId: user.cashId,
      filename: "statement.csv",
      rowsParsed: counterparties.length,
      rowsNew: counterparties.length,
      rowsDuplicate: 0,
      rowsFailed: 0,
    })
    .returning({ id: schema.moneyImports.id });
  const importId = created!.id;
  const rowIds = await insertImportedRows(
    db,
    user,
    counterparties.map((counterparty) => ({ counterparty, importId })),
  );
  return { importId, rowIds };
}

function readRow(userId: string, id: string) {
  return readTransaction(db, userId, id);
}

// Answers every merchant with the category named GROCERY MART -> Food, the rest "none". Records
// what it was sent.
function fakeModel(foodId: string) {
  return recordingModel((request) => ({
    answers: request.payload.merchants.map((merchant) => ({
      merchant: merchant.id,
      category: merchant.counterparty === "GROCERY MART" ? foodId : "none",
    })),
  }));
}

function failingModel(): CategorizationModelClient {
  return recordingModel(new Error("HTTP 503")).client;
}

describe("suggestions after an import", () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });
  afterAll(async () => {
    await db?.$client.end();
    await database?.drop();
  });

  it("suggests for the import's unmatched rows and leaves them uncategorized", async () => {
    const user = await createUser();
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART", "GROCERY MART", "ODD"]);
    const model = fakeModel(user.category("Food"));

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    expect(result).toEqual({ status: "suggested", rows: 2 });
    expect(await readRow(user.userId, rowIds[0]!)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: user.category("Food"),
    });
    expect(await readRow(user.userId, rowIds[2]!)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: null,
    });
  });

  it("reports that the model had nothing when it answered none for every merchant", async () => {
    const user = await createUser();
    const { importId } = await insertImport(user, ["ODD"]);

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: fakeModel(user.category("Food")).client,
      importId,
    });

    expect(result).toEqual({ status: "none" });
  });

  it("only asks about the import's own rows", async () => {
    const user = await createUser();
    const other = await insertImport(user, ["OTHER IMPORT SHOP"]);
    const mine = await insertImport(user, ["GROCERY MART"]);
    const model = fakeModel(user.category("Food"));

    await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId: mine.importId,
    });

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.payload.merchants.map((m) => m.counterparty)).toEqual([
      "GROCERY MART",
    ]);
    expect(await readRow(user.userId, other.rowIds[0]!)).toMatchObject({
      suggestionAskedAt: null,
    });
  });

  it("sends nothing and says nothing when every row is matched by a rule", async () => {
    const user = await createUser();
    await createRule(db, user.userId, {
      field: "counterparty",
      pattern: "grocery",
      categoryId: user.category("Food"),
    });
    const { importId } = await insertImport(user, ["GROCERY MART"]);
    const model = fakeModel(user.category("Food"));

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    expect(result).toEqual({ status: "nothing" });
    expect(model.requests).toHaveLength(0);
  });

  it("sends nothing new when the import is read again", async () => {
    const user = await createUser();
    const { importId } = await insertImport(user, ["GROCERY MART"]);
    const model = fakeModel(user.category("Food"));
    await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    const again = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    expect(again).toEqual({ status: "nothing" });
    expect(model.requests).toHaveLength(1);
  });

  it("leaves the rows as saved and says unavailable when the model fails", async () => {
    const user = await createUser();
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART"]);

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: failingModel(),
      importId,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(await readRow(user.userId, rowIds[0]!)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: null,
      suggestionAskedAt: null,
    });
  });

  it("says unavailable when a request times out", async () => {
    const user = await createUser();
    const { importId } = await insertImport(user, ["GROCERY MART"]);
    const hanging: CategorizationModelClient = { suggestCategories: () => new Promise(() => {}) };

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: hanging,
      importId,
      timeoutMs: 20,
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("returns pending once the wait is over, and the answer still lands afterwards", async () => {
    const user = await createUser();
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART"]);
    let answer!: (value: unknown) => void;
    const slow: CategorizationModelClient = {
      suggestCategories: (request) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              answers: request.payload.merchants.map((merchant) => ({
                merchant: merchant.id,
                category: user.category("Food"),
              })),
            });
        }),
    };

    const started = Date.now();
    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: slow,
      importId,
      maxWaitMs: 30,
    });

    expect(result).toEqual({ status: "pending" });
    expect(Date.now() - started).toBeLessThan(2000);
    answer(undefined);
    await expect
      .poll(async () => (await readRow(user.userId, rowIds[0]!)).suggestedCategoryId)
      .toBe(user.category("Food"));
  });

  it("says the limit is reached when the daily cap stops the run", async () => {
    const user = await createUser();
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART", "ODD"]);
    const model = fakeModel(user.category("Food"));

    const result = await suggestAfterImport(db, user.userId, {
      client: model.client,
      importId,
      dailyLimit: 1,
    });

    expect(result).toMatchObject({ status: "capped" });
    // One merchant fits the day's allowance and is asked; the other is left unasked.
    expect(model.requests[0]!.payload.merchants).toHaveLength(1);
    const unasked = await Promise.all(rowIds.map((id) => readRow(user.userId, id)));
    expect(unasked.filter((row) => row.suggestionAskedAt === null)).toHaveLength(1);
  });

  it("says the limit is reached when the allowance was already spent", async () => {
    const user = await createUser();
    const first = await insertImport(user, ["GROCERY MART"]);
    const model = fakeModel(user.category("Food"));
    await suggestAfterImport(db, user.userId, {
      client: model.client,
      importId: first.importId,
      dailyLimit: 1,
    });
    const next = await insertImport(user, ["TRAM CO"]);
    model.requests.length = 0;

    const result = await suggestAfterImport(db, user.userId, {
      client: model.client,
      importId: next.importId,
      dailyLimit: 1,
    });

    expect(result).toEqual({ status: "capped", rows: 0 });
    expect(model.requests).toHaveLength(0);
  });

  it("is off, and sends nothing, for a user who opted out", async () => {
    const user = await createUser();
    await setAiCategorization(db, user.userId, false);
    const { importId, rowIds } = await insertImport(user, ["GROCERY MART"]);
    const model = fakeModel(user.category("Food"));

    const result = await suggestAfterImport(db, user.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    expect(result).toEqual({ status: "off" });
    expect(model.requests).toHaveLength(0);
    expect(await readRow(user.userId, rowIds[0]!)).toMatchObject({ suggestionAskedAt: null });
  });

  it("is off with no client, which is a server with no key", async () => {
    const user = await createUser();
    const { importId } = await insertImport(user, ["GROCERY MART"]);

    expect(
      await suggestAfterImport(db, user.userId, {
        dailyLimit: testAiCategorizeDailyLimit,
        client: null,
        importId,
      }),
    ).toEqual({
      status: "off",
    });
  });

  it("never reads another user's import", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { importId, rowIds } = await insertImport(owner, ["GROCERY MART"]);
    const model = fakeModel(stranger.category("Food"));

    const result = await suggestAfterImport(db, stranger.userId, {
      dailyLimit: testAiCategorizeDailyLimit,
      client: model.client,
      importId,
    });

    expect(result).toEqual({ status: "nothing" });
    expect(model.requests).toHaveLength(0);
    expect(await readRow(owner.userId, rowIds[0]!)).toMatchObject({ suggestionAskedAt: null });
  });
});
