// The one call every OpenAI-backed model client makes (ADR-0015, ADR-0016, ADR-0018): plain HTTPS
// to the Responses API with structured output, not the SDK. What is sent is whatever the caller
// built; the key and the model name come from the server's environment. Shared by the web app and
// the worker.
//
// Neither the request nor the response is logged, and errors carry a status at most: a body, or a
// network error that echoes the request, can hold a user's text.

export type OpenAiConfig = { apiKey: string; model: string };

// The model when OPENAI_MODEL is unset: the owner's choice. It must support structured JSON output
// and PDF file input. apps/web/src/server/env.ts has the same default and stays free of core.
export const defaultOpenAiModel = "gpt-6-luna";

// The configuration from OPENAI_API_KEY and OPENAI_MODEL, or null with no key (or an empty one, as
// .env.example has): then nothing is ever sent.
export function openAiConfigFrom(env: Record<string, string | undefined>): OpenAiConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.OPENAI_MODEL?.trim() || defaultOpenAiModel };
}

// A fixed address: never a URL taken from input.
const endpoint = "https://api.openai.com/v1/responses";

// A bound of its own, beside the one the caller puts on the call.
const defaultRequestTimeoutMs = 30_000;

// A file the model reads, sent inline with the request (never uploaded to be kept).
export type InputFile = { filename: string; mime: "application/pdf"; bytes: Uint8Array };

export type StructuredRequest = {
  instructions: string;
  // The user message: text, already serialized, or a file.
  input: string | { file: InputFile };
  // The name of the schema, as OpenAI wants one.
  name: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  // Longer for a file the model has to read page by page.
  timeoutMs?: number;
};

// Resolves to the JSON the model wrote; rejects on anything else.
export async function structuredResponse(
  config: OpenAiConfig,
  fetchImpl: typeof fetch,
  request: StructuredRequest,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        // Asks OpenAI not to keep the request.
        store: false,
        instructions: request.instructions,
        input: typeof request.input === "string" ? request.input : fileInput(request.input.file),
        text: {
          format: { type: "json_schema", name: request.name, strict: true, schema: request.schema },
        },
      }),
      redirect: "error",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(request.timeoutMs ?? defaultRequestTimeoutMs),
      ]),
    });
  } catch {
    // Not rethrown: the network error's message can carry the address or the request.
    throw new Error("The request to OpenAI failed.");
  }
  if (!response.ok) throw new Error(`OpenAI answered HTTP ${response.status}.`);
  const body: unknown = await response.json().catch(() => undefined);
  return structuredAnswer(body as ResponsesBody | undefined);
}

function fileInput(file: InputFile) {
  const data = Buffer.from(file.bytes).toString("base64");
  return [
    {
      role: "user",
      content: [
        {
          type: "input_file",
          filename: file.filename,
          file_data: `data:${file.mime};base64,${data}`,
        },
      ],
    },
  ];
}

type ResponsesBody = {
  status?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
};

// The JSON the model wrote, from the first output_text part. A refusal, an answer cut short or
// text that isn't JSON is an error.
function structuredAnswer(body: ResponsesBody | undefined): unknown {
  if (body?.status === "incomplete") throw new Error("OpenAI's answer was incomplete.");
  const parts =
    body?.output?.flatMap((item) => (item.type === "message" ? item.content : [])) ?? [];
  if (parts.some((part) => part?.type === "refusal")) throw new Error("OpenAI refused.");
  const text = parts.find((part) => part?.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI's answer had no text.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI's answer was not JSON.");
  }
}
