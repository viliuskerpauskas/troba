import { describe, expect, it, vi } from "vitest";
import {
  categorizationAnswerJsonSchema,
  categorizationInstructions,
  type CategorizationRequest,
} from "../money/ai-categories";
import { createOpenAiCategorizationClient } from "./categorization";

const config = { apiKey: "sk-test-not-a-real-key", model: "test-model" };

const request: CategorizationRequest = {
  instructions: categorizationInstructions,
  payload: {
    categories: [{ id: "cat-1", name: "Groceries" }],
    merchants: [{ id: "m1", counterparty: "GROCERY MART", description: "Card payment" }],
  },
  schema: categorizationAnswerJsonSchema,
  signal: new AbortController().signal,
};

const answer = { answers: [{ merchant: "m1", category: "cat-1" }] };

function respond(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, init));
}

function message(...content: unknown[]) {
  return { status: "completed", output: [{ type: "message", content }] };
}

describe("createOpenAiCategorizationClient", () => {
  it("posts the payload with a strict JSON schema, asking not to store it", async () => {
    const fetchMock = respond(message({ type: "output_text", text: JSON.stringify(answer) }));

    await createOpenAiCategorizationClient(config, fetchMock).suggestCategories(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      instructions: categorizationInstructions,
      text: {
        format: { type: "json_schema", strict: true, schema: categorizationAnswerJsonSchema },
      },
    });
    expect(JSON.parse(body.input)).toEqual(request.payload);
  });

  it("returns the structured answer", async () => {
    const fetchMock = respond(message({ type: "output_text", text: JSON.stringify(answer) }));

    await expect(
      createOpenAiCategorizationClient(config, fetchMock).suggestCategories(request),
    ).resolves.toEqual(answer);
  });

  it("passes on the caller's abort and bounds the call itself", async () => {
    const controller = new AbortController();
    const fetchMock = respond(message({ type: "output_text", text: "{}" }));

    await createOpenAiCategorizationClient(config, fetchMock).suggestCategories({
      ...request,
      signal: controller.signal,
    });
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);
    controller.abort();

    expect(signal.aborted).toBe(true);
  });

  // Each failure has one fixed sentence, at most with the HTTP status: nothing of the response
  // body, the network error, the request or the key can reach the error, whatever words they hold.
  it.each([
    [
      "an HTTP error",
      respond({ error: { message: "Weekly shopping" } }, { status: 429 }),
      "OpenAI answered HTTP 429.",
    ],
    ["a refusal", respond(message({ type: "refusal", refusal: "no" })), "OpenAI refused."],
    ["no text", respond({ status: "completed", output: [] }), "OpenAI's answer had no text."],
    [
      "an incomplete answer",
      respond({ ...message({ type: "output_text", text: "{}" }), status: "incomplete" }),
      "OpenAI's answer was incomplete.",
    ],
    [
      "text that is not JSON",
      respond(message({ type: "output_text", text: "Maple Street" })),
      "OpenAI's answer was not JSON.",
    ],
    [
      "a body that is not JSON",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>")),
      "OpenAI's answer had no text.",
    ],
    [
      "a network failure",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed for GROCERY MART")),
      "The request to OpenAI failed.",
    ],
  ])("rejects on %s with only its fixed message", async (_name, fetchMock, expected) => {
    const error = await createOpenAiCategorizationClient(config, fetchMock)
      .suggestCategories(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expected);
    // A cause would carry the original error, and its text, to whatever prints this one.
    expect((error as Error).cause).toBeUndefined();
  });
});
