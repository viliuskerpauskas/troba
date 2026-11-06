import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mappingAnswerJsonSchema,
  mappingInstructions,
  type MappingModelRequest,
} from "@troba/core";
import { createOpenAiMappingClient, mappingModelClient } from "./openai-mapping";

const config = { apiKey: "sk-test-not-a-real-key", model: "test-model" };

const request: MappingModelRequest = {
  instructions: mappingInstructions,
  sample: {
    headers: ["Date", "Amount"],
    rows: [["15.01.2024", "12,50"]],
    codedValues: [],
  },
  schema: mappingAnswerJsonSchema,
  signal: new AbortController().signal,
};

const answer = { decimalSeparator: ",", dateFormat: "DD.MM.YYYY" };

function respond(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, init));
}

function message(...content: unknown[]) {
  return { status: "completed", output: [{ type: "message", content }] };
}

describe("createOpenAiMappingClient", () => {
  it("posts the sample with a strict JSON schema, asking not to store it", async () => {
    const fetchMock = respond(message({ type: "output_text", text: JSON.stringify(answer) }));

    await createOpenAiMappingClient(config, fetchMock).suggestMapping(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      instructions: mappingInstructions,
      text: {
        format: { type: "json_schema", strict: true, schema: mappingAnswerJsonSchema },
      },
    });
    expect(JSON.parse(body.input)).toEqual(request.sample);
  });

  it("returns the structured answer", async () => {
    const fetchMock = respond(message({ type: "output_text", text: JSON.stringify(answer) }));

    await expect(
      createOpenAiMappingClient(config, fetchMock).suggestMapping(request),
    ).resolves.toEqual(answer);
  });

  it("passes on the caller's abort and bounds the call itself", async () => {
    const controller = new AbortController();
    const fetchMock = respond(message({ type: "output_text", text: "{}" }));

    await createOpenAiMappingClient(config, fetchMock).suggestMapping({
      ...request,
      signal: controller.signal,
    });
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);
    controller.abort();

    expect(signal.aborted).toBe(true);
  });

  it.each([
    ["an HTTP error", respond({ error: { message: "Weekly shopping" } }, { status: 429 })],
    ["a refusal", respond(message({ type: "refusal", refusal: "no" }))],
    ["no text", respond({ status: "completed", output: [] })],
    [
      "an incomplete answer",
      respond({ ...message({ type: "output_text", text: "{}" }), status: "incomplete" }),
    ],
    ["text that is not JSON", respond(message({ type: "output_text", text: "Maple Street" }))],
    ["a body that is not JSON", vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>"))],
  ])("rejects on %s, with an error that quotes nothing", async (_name, fetchMock) => {
    const error = await createOpenAiMappingClient(config, fetchMock)
      .suggestMapping(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/Weekly|Maple|html|sk-test/);
  });

  it("rejects when the network fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      createOpenAiMappingClient(config, fetchMock).suggestMapping(request),
    ).rejects.toThrow();
  });
});

describe("mappingModelClient", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null while no key is set, so nothing can be sent", () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(mappingModelClient()).toBeNull();
  });

  it("is a client once a key is set", () => {
    vi.stubEnv("OPENAI_API_KEY", config.apiKey);

    expect(mappingModelClient()).not.toBeNull();
  });
});
