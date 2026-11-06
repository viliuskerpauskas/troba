import { readFileSync } from "node:fs";
import path from "node:path";
import {
  importPresets,
  importProfileListLimit,
  listImportProfiles,
  type MappingModelClient,
  type MappingModelRequest,
} from "@troba/core";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportState } from "./actions";

// The wizard's first step with a fake model behind it (SPEC-money M3, ADR-0015): what the user is
// shown for each way the AI suggestion can go. The server's session, database and model client are
// the only things replaced; the actions, core and Postgres are real.

const session = vi.hoisted(() => ({ userId: "" }));
const server = vi.hoisted(() => ({
  db: undefined as unknown,
  client: null as MappingModelClient | null,
}));

vi.mock("@/server/money", () => ({
  requireMoneyUser: async () => ({ userId: session.userId, role: "user" }),
}));
vi.mock("@/server/db", () => ({ db: () => server.db }));
vi.mock("@/server/openai-mapping", () => ({ mappingModelClient: () => server.client }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let actions: typeof import("./actions");
let userCount = 0;

const unknownFile = readFileSync(
  path.join(
    import.meta.dirname,
    "../../../../../../../packages/core/test/fixtures/csv/example-bank-signed.csv",
  ),
);
const presetFile = readFileSync(
  path.join(
    import.meta.dirname,
    "../../../../../../../packages/core/src/money/import",
    "presets",
    `${importPresets[0].id}.fixture.csv`,
  ),
);

// What a model that reads the unknown file correctly answers.
const goodAnswer = {
  decimalSeparator: ".",
  dateFormat: "DD/MM/YYYY",
  columns: {
    bookingDate: "Posted",
    transactionDate: "Transaction Date",
    amount: "Amount",
    debitCredit: null,
    currency: "Currency",
    originalAmount: null,
    originalCurrency: null,
    counterparty: "Payee",
    counterpartyIban: "Payee Account",
    description: "Details",
    transactionId: "Transaction ID",
    transactionType: "Type",
    ownIban: "Account",
  },
  debitValues: null,
};

type Answer = unknown | Error;

// Records what it was asked and answers as told.
function fakeModel(answer: Answer) {
  const requests: MappingModelRequest[] = [];
  const client: MappingModelClient = {
    async suggestMapping(request) {
      requests.push(request);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { client, requests };
}

function upload(
  bytes: Uint8Array,
  extra: Record<string, string> = {},
  file: { name?: string; type?: string } = {},
) {
  const data = new FormData();
  data.set(
    "file",
    new File([new Uint8Array(bytes)], file.name ?? "statement.csv", {
      type: file.type ?? "text/csv",
    }),
  );
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

// The mapping form as the browser submits it: the fields it shows, then the file again.
function submitted(state: Extract<ImportState, { step: "mapping" }>, bytes: Uint8Array) {
  return upload(bytes, {
    ...state.values,
    ...(state.suggestion ? { suggestion: state.suggestion } : {}),
  });
}

function mapping(state: ImportState) {
  if (state.step !== "mapping") throw new Error(`expected the mapping step, got ${state.step}`);
  return state;
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
    .values({ name: "Example User", email: `wizard${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  session.userId = user!.id;
  server.client = null;
});

describe("startImportAction, for a file in an unknown format", () => {
  it("opens the mapping form filled in from the model's proposal, and saves nothing", async () => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    const state = mapping(await actions.startImportAction(upload(unknownFile)));

    expect(state.suggestion).toBe("ai");
    expect(state.error).toBeUndefined();
    expect(state.profileId).toBeNull();
    expect(state.values).toMatchObject({
      name: "statement",
      skipLines: "0",
      decimalSeparator: ".",
      dateFormat: "DD/MM/YYYY",
      "column.bookingDate": "Posted",
      "column.amount": "Amount",
      "column.counterparty": "Payee",
      "column.ownIban": "Account",
      "column.debitCredit": "",
      debitValues: "",
    });
    expect(state.table?.headers).toContain("Payee Account");
    expect(model.requests).toHaveLength(1);
    expect(await listImportProfiles(db, session.userId)).toEqual([]);
  });

  it("sends the model a masked sample, never the file's names or merchants", async () => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    await actions.startImportAction(upload(unknownFile));

    const sent = JSON.stringify(model.requests[0]!.sample);
    expect(sent).toContain("Payee Account");
    for (const secret of ["GROCERY MART", "ACME LTD", "STREAMING CO", "DE89", "GB82"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("lets the user edit the suggestion, save it, and match the file on a later upload", async () => {
    server.client = fakeModel(goodAnswer).client;
    const suggested = mapping(await actions.startImportAction(upload(unknownFile)));

    const edited = submitted(suggested, unknownFile);
    edited.set("name", "Example Bank (mine)");
    const saved = await actions.saveProfileAction(edited);

    expect(saved).toMatchObject({ step: "preview", profile: { name: "Example Bank (mine)" } });
    expect(await listImportProfiles(db, session.userId)).toEqual([
      expect.objectContaining({ name: "Example Bank (mine)" }),
    ]);

    // The saved profile is found first, so the model isn't asked again.
    const again = fakeModel(new Error("not called"));
    server.client = again.client;
    expect(await actions.startImportAction(upload(unknownFile))).toMatchObject({
      step: "preview",
      profile: { name: "Example Bank (mine)" },
    });
    expect(again.requests).toEqual([]);
  });

  it("keeps the suggestion note while the user reads the file again", async () => {
    server.client = fakeModel(goodAnswer).client;
    const suggested = mapping(await actions.startImportAction(upload(unknownFile)));

    const reread = mapping(await actions.rereadMappingAction(submitted(suggested, unknownFile)));

    expect(reread.suggestion).toBe("ai");
    expect(reread.values).toMatchObject({ "column.amount": "Amount", dateFormat: "DD/MM/YYYY" });
  });

  it("shows the plain form, with a note, when the model fails", async () => {
    const model = fakeModel(new Error("HTTP 500"));
    server.client = model.client;

    const state = mapping(await actions.startImportAction(upload(unknownFile)));

    expect(model.requests).toHaveLength(1);
    expect(state.suggestion).toBe("unavailable");
    expect(state.values).toMatchObject({ "column.amount": "", "column.bookingDate": "" });
    expect(state.table?.headers).toContain("Payee Account");
  });

  it("shows the plain form, with a note, when the proposal doesn't fit the file", async () => {
    server.client = fakeModel({
      ...goodAnswer,
      columns: { ...goodAnswer.columns, amount: "Sum" },
    }).client;

    const state = mapping(await actions.startImportAction(upload(unknownFile)));

    expect(state.suggestion).toBe("unavailable");
    expect(state.values).toMatchObject({ "column.amount": "" });
  });

  it("shows the plain form, with no note and no call, when no model is configured", async () => {
    const state = mapping(await actions.startImportAction(upload(unknownFile)));

    expect(state.suggestion).toBeUndefined();
    expect(state.values).toMatchObject({ "column.amount": "" });
  });
});

describe("startImportAction, for everything else", () => {
  it("asks the model nothing about a preset's file", async () => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    const state = await actions.startImportAction(upload(presetFile));

    expect(state.step).toBe("preview");
    expect(model.requests).toEqual([]);
  });

  it("asks the model nothing about a preset's file when the profile limit is reached", async () => {
    await db.insert(schema.moneyImportProfiles).values(
      Array.from({ length: importProfileListLimit }, (_, i) => ({
        userId: session.userId,
        ...importPresets[0].profile,
        name: `Profile ${i}`,
        headerFingerprint: "x",
      })),
    );
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    const state = mapping(await actions.startImportAction(upload(presetFile)));

    expect(state.suggestion).toBeUndefined();
    expect(model.requests).toEqual([]);
  });

  it("asks the model nothing when the user picked a profile", async () => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    const state = await actions.startImportAction(
      upload(unknownFile, { profileId: "00000000-0000-4000-8000-000000000000" }),
    );

    expect(state.step).toBe("upload");
    expect(model.requests).toEqual([]);
  });

  it.each([
    [
      "not a CSV",
      upload(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]), {}, { type: "application/pdf" }),
    ],
    ["empty", upload(new Uint8Array(), {})],
  ])("refuses a file that is %s before any sample is built", async (_, data) => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;

    const state = await actions.startImportAction(data);

    expect(state.step).toBe("upload");
    expect(model.requests).toEqual([]);
  });

  it("refuses a file over the size limit before any sample is built", async () => {
    const model = fakeModel(goodAnswer);
    server.client = model.client;
    const { maxImportFileBytes } = await import("@troba/core");

    const state = await actions.startImportAction(
      upload(new Uint8Array(maxImportFileBytes + 1).fill(0x61)),
    );

    expect(state).toMatchObject({ step: "upload", error: expect.stringContaining("MB") });
    expect(model.requests).toEqual([]);
  });
});
