import { aiCategorizationEnabledFor } from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The settings page's AI switch (ADR-0016): it changes the signed-in user's setting and nobody
// else's. The session and database are the only things replaced.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/server/session", () => ({
  requireUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let actions: typeof import("./ai-categorization-actions");
let userCount = 0;

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `ai-switch${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  server.db = db;
  actions = await import("./ai-categorization-actions");
});

afterAll(async () => {
  await db.$client.end();
  await database.drop();
});

describe("updateAiCategorization", () => {
  it("turns the signed-in user's setting off and on, and leaves another user's alone", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    session.userId = mine;

    const off = await actions.updateAiCategorization({}, form({}));
    expect(off.message).toBe("AI suggestions are off. Nothing is sent.");
    expect(await aiCategorizationEnabledFor(db, mine)).toBe(false);
    expect(await aiCategorizationEnabledFor(db, theirs)).toBe(true);

    const on = await actions.updateAiCategorization({}, form({ enabled: "on" }));
    expect(on.message).toBe("AI suggestions are on.");
    expect(await aiCategorizationEnabledFor(db, mine)).toBe(true);
  });

  it("takes whose setting it is from the session, not from the form", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    session.userId = mine;

    await actions.updateAiCategorization({}, form({ userId: theirs }));

    expect(await aiCategorizationEnabledFor(db, mine)).toBe(false);
    expect(await aiCategorizationEnabledFor(db, theirs)).toBe(true);
  });

  it("reads anything but a checked box as off", async () => {
    const mine = await createUser();
    session.userId = mine;

    await actions.updateAiCategorization({}, form({ enabled: "true" }));

    expect(await aiCategorizationEnabledFor(db, mine)).toBe(false);
  });
});
