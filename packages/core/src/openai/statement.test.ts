import { describe, expect, it, vi } from "vitest";
import {
  statementAnswerJsonSchema,
  statementInstructions,
  type StatementModelRequest,
} from "../money/import/pdf-import";
import { openAiConfigFrom } from "./responses";
import { createOpenAiStatementClient } from "./statement";

const config = { apiKey: "sk-test-not-a-real-key", model: "test-model" };
const pdf = new TextEncoder().encode("%PDF-1.7 GROCERY MART -42.15");

function request(signal = new AbortController().signal): StatementModelRequest {
  return { instructions: statementInstructions, pdf, schema: statementAnswerJsonSchema, signal };
}

const answer = { accountIbans: [], currency: "EUR", transactions: [] };

function respond(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, init));
}

function message(...content: unknown[]) {
  return { status: "completed", output: [{ type: "message", content }] };
}

describe("createOpenAiStatementClient", () => {
  it("posts the PDF as a file input with a strict JSON schema, asking not to store it", async () => {
    const fetchMock = respond(message({ type: "output_text", text: JSON.stringify(answer) }));

    expect(await createOpenAiStatementClient(config, fetchMock).readStatement(request())).toEqual(
      answer,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      instructions: statementInstructions,
      text: { format: { type: "json_schema", strict: true, schema: statementAnswerJsonSchema } },
    });
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "statement.pdf",
            file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
          },
        ],
      },
    ]);
  });

  it("rejects with the HTTP status only, never the body", async () => {
    const fetchMock = respond({ error: { message: "GROCERY MART -42.15" } }, { status: 400 });

    const error = await createOpenAiStatementClient(config, fetchMock)
      .readStatement(request())
      .catch((caught: unknown) => caught);
    expect(error).toEqual(new Error("OpenAI answered HTTP 400."));
  });

  it("rejects without the network error's message", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connect failed for GROCERY MART -42.15"));

    await expect(
      createOpenAiStatementClient(config, fetchMock).readStatement(request()),
    ).rejects.toThrow(/^The request to OpenAI failed\.$/);
  });

  it("is aborted with the reader's signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(message()));
    controller.abort();

    await createOpenAiStatementClient(config, fetchMock)
      .readStatement(request(controller.signal))
      .catch(() => undefined);
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
});

describe("openAiConfigFrom", () => {
  it("is null without a key, and defaults the model", () => {
    expect(openAiConfigFrom({})).toBeNull();
    expect(openAiConfigFrom({ OPENAI_API_KEY: "  " })).toBeNull();
    expect(openAiConfigFrom({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "" })).toEqual({
      apiKey: "sk-x",
      model: "gpt-6-luna",
    });
    expect(openAiConfigFrom({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "other" })).toMatchObject({
      model: "other",
    });
  });
});
