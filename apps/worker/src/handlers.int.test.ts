import {
  createOpenAiCategorizationClient,
  getCategorySuggestionRun,
  startCategorySuggestions,
  startJobQueue,
  type CategorizationModelClient,
  type JobQueue,
} from "@troba/core";
import {
  createMoneyUser,
  insertImportedRows,
  recordingModel,
  testAiCategorizeDailyLimit,
} from "@troba/core/test-ai-categories";
import { createDb, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handlers } from "./handlers";

// ADR-0016, ADR-0020: the merchant text sent and the model's answer are a user's data, so no part
// of the exchange is logged, on any path. The worker's suggest-categories handler runs here with
// the real OpenAI client and transport behind a fake fetch, and every way the process prints is
// watched: the console and stdout and stderr, which a logger writes to.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let queue: JobQueue;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
  queue = await startJobQueue(database.url);
});
afterAll(async () => {
  await queue?.stop({ graceful: false });
  await db?.$client.end();
  await database?.drop();
});

// Runs the call with every way of printing replaced, and returns what was written meanwhile.
async function watchingOutput(run: () => Promise<unknown>): Promise<unknown[][]> {
  const spies = [
    ...(["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    ),
    vi.spyOn(process.stdout, "write").mockImplementation(() => true),
    vi.spyOn(process.stderr, "write").mockImplementation(() => true),
  ];
  try {
    await run();
    return spies.flatMap((spy) => [...spy.mock.calls]);
  } finally {
    // After the calls are read: restoring a spy clears them.
    for (const spy of spies) spy.mockRestore();
  }
}

// A user with one GROCERY MART row and a run queued for it; runs the handler with `client` and
// returns what was printed and how the run ended.
async function runHandler(client: CategorizationModelClient) {
  const user = await createMoneyUser(db);
  await insertImportedRows(db, user, [{ counterparty: "GROCERY MART" }]);
  const started = await startCategorySuggestions(db, user.userId, { queue });
  if (!started.ok) throw new Error("expected a run");
  const written = await watchingOutput(() =>
    handlers["suggest-categories"](
      { userId: user.userId, runId: started.runId },
      {
        db,
        statementClient: null,
        pdfImportDailyLimit: 1,
        categorizationClient: client,
        categorizeDailyLimit: testAiCategorizeDailyLimit,
      },
    ),
  );
  const run = await getCategorySuggestionRun(db, user.userId, started.runId);
  return { written, run };
}

describe("what the worker's model exchange leaves in the logs", () => {
  // The request's own text, echoed back the way an error page or a proxy might.
  const echo = (init: RequestInit | undefined) => String(init?.body);

  function answering(text: string) {
    return Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    });
  }

  it.each<[string, typeof fetch, { failed: boolean }]>([
    [
      "the call fails with a body that quotes the request",
      async (_url, init) => Response.json({ error: { message: echo(init) } }, { status: 500 }),
      { failed: true },
    ],
    [
      "the network fails with an error that quotes the request",
      async (_url, init) => {
        throw new TypeError(`fetch failed: ${echo(init)}`);
      },
      { failed: true },
    ],
    [
      "the answer is garbage in the merchant's words",
      async () => answering(JSON.stringify({ answers: "GROCERY MART is Food" })),
      { failed: true },
    ],
    [
      "the answer names merchants and categories it wasn't given",
      async () =>
        answering(JSON.stringify({ answers: [{ merchant: "GROCERY MART", category: "Food" }] })),
      { failed: false },
    ],
    ["the answer is not JSON", async () => answering("GROCERY MART: Food"), { failed: true }],
  ])("writes nothing when %s", async (_name, fetchImpl, outcome) => {
    const client = createOpenAiCategorizationClient(
      { apiKey: "sk-test-not-a-real-key", model: "test-model" },
      vi.fn(fetchImpl),
    );

    const { written, run } = await runHandler(client);

    expect(written).toEqual([]);
    // The run went the way the case says, so the silence is about that path.
    expect(run).toMatchObject({ finished: true, result: { ...outcome, rowsSuggested: 0 } });
  });

  it("writes nothing when the model client itself throws with the merchant's text", async () => {
    const { written, run } = await runHandler(
      recordingModel(new Error("could not place GROCERY MART")).client,
    );

    expect(written).toEqual([]);
    expect(run).toMatchObject({ finished: true, result: { failed: true } });
  });
});
