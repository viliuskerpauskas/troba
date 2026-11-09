import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ensureMoneyDefaults,
  importPresets,
  listAccounts,
  setAiCategorization,
  type CategorizationModelClient,
  type CategorizationRequest,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportState } from "./actions";

// An import with the model behind it (SPEC-money M5, ADR-0016): the same rows are saved whatever
// the model does, and the result says how the suggestions went. The server's session, database
// and model client are the only things replaced; the actions, core and Postgres are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  client: null as CategorizationModelClient | null,
}));

vi.mock("@/server/money", () => ({
  requireMoneyUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/openai-categorization", () => ({
  categorizationModelClient: () => server.client,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let actions: typeof import("./actions");
let userCount = 0;
let cashId = "";

// A preset's fixture, which names no account: the user picks one. The preset is looked up by
// position, so no bank is named outside the presets folder.
const statement = readFileSync(
  path.join(
    import.meta.dirname,
    "../../../../../../../packages/core/src/money/import/presets",
    `${importPresets[1].id}.fixture.csv`,
  ),
);

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(statement)], "statement.csv", { type: "text/csv" }));
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

async function importStatement(): Promise<Extract<ImportState, { step: "done" }>> {
  const preview = await actions.startImportAction(form());
  if (preview.step !== "preview") throw new Error(`expected the preview step, got ${preview.step}`);
  const done = await actions.commitImportAction(
    form({ profileId: preview.profile.id, accountId: cashId }),
  );
  if (done.step !== "done") throw new Error(`expected the done step, got ${done.step}`);
  return done;
}

async function savedRows() {
  const rows = await db.select().from(schema.moneyTransactions);
  return rows.filter((row) => row.userId === session.userId);
}

// Answers GROCERY MART with Food and everything else "none"; records what it was sent.
function fakeModel() {
  const requests: CategorizationRequest[] = [];
  const client: CategorizationModelClient = {
    async suggestCategories(request) {
      requests.push(request);
      const food = request.payload.categories.find((category) => category.name === "Food")!;
      return {
        answers: request.payload.merchants.map((merchant) => ({
          merchant: merchant.id,
          category: merchant.counterparty === "GROCERY MART" ? food.id : "none",
        })),
      };
    },
  };
  return { client, requests };
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  server.db = db;
  actions = await import("./actions");
});

afterAll(async () => {
  await db.$client.end();
  await database.drop();
});

beforeEach(async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `after-commit${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  session.userId = user!.id;
  await ensureMoneyDefaults(db, session.userId);
  cashId = (await listAccounts(db, session.userId))[0]!.id;
  server.client = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("commitImportAction, with the model behind it", () => {
  it("ends with suggestions on the unmatched rows, which stay uncategorized", async () => {
    const model = fakeModel();
    server.client = model.client;

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "suggested", rows: 2 });
    const rows = await savedRows();
    const groceries = rows.filter((row) => row.counterparty === "GROCERY MART");
    expect(groceries).toHaveLength(2);
    for (const row of groceries) {
      expect(row).toMatchObject({ categoryId: null, suggestedCategoryId: expect.any(String) });
    }
    // A row the model had no answer for is asked about and has no suggestion.
    expect(rows.filter((row) => row.suggestedCategoryId !== null)).toHaveLength(2);
  });

  it("hands the model merchant text only", async () => {
    const model = fakeModel();
    server.client = model.client;

    await importStatement();

    const sent = JSON.stringify(model.requests);
    expect(sent).toContain("GROCERY MART");
    for (const absent of ["38.45", "2026-09", "COMPLETED"]) {
      expect(sent).not.toContain(absent);
    }
  });

  it("saves the same rows when the model fails, and says it is unavailable", async () => {
    const withModel = fakeModel();
    server.client = withModel.client;
    const reference = await importStatement();
    const referenceRows = (await savedRows()).length;

    server.client = {
      suggestCategories: async () => {
        throw new Error("HTTP 503");
      },
    };
    const [other] = await db
      .insert(schema.users)
      .values({ name: "Example User", email: `after-commit${++userCount}@example.test` })
      .returning({ id: schema.users.id });
    session.userId = other!.id;
    await ensureMoneyDefaults(db, session.userId);
    cashId = (await listAccounts(db, session.userId))[0]!.id;

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "unavailable" });
    expect({ ...done, suggestions: undefined }).toEqual({ ...reference, suggestions: undefined });
    expect(await savedRows()).toHaveLength(referenceRows);
    expect((await savedRows()).every((row) => row.suggestedCategoryId === null)).toBe(true);
  });

  it("saves the rows and says the limit is reached when the daily cap is spent", async () => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", "1");
    server.client = fakeModel().client;

    const done = await importStatement();

    expect(done.suggestions).toMatchObject({ status: "capped" });
    expect(done.rowsNew).toBeGreaterThan(0);
    expect(await savedRows()).toHaveLength(done.rowsNew);
  });

  it("says nothing, and sends nothing, for a user who opted out", async () => {
    await setAiCategorization(db, session.userId, false);
    const model = fakeModel();
    server.client = model.client;

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "off" });
    expect(model.requests).toHaveLength(0);
    expect(done.rowsNew).toBeGreaterThan(0);
  });

  it("says nothing with no key on the server", async () => {
    server.client = null;

    const done = await importStatement();

    expect(done.suggestions).toEqual({ status: "off" });
    expect(done.rowsNew).toBeGreaterThan(0);
  });

  it("sends nothing new when the same file is imported again", async () => {
    const model = fakeModel();
    server.client = model.client;
    await importStatement();
    const asked = model.requests.length;

    const again = await importStatement();

    expect(again.rowsNew).toBe(0);
    expect(again.suggestions).toEqual({ status: "nothing" });
    expect(model.requests).toHaveLength(asked);
  });
});
