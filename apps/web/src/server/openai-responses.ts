import type { OpenAiConfig } from "./env";

// The one call both OpenAI-backed model clients make (ADR-0015, ADR-0016): plain HTTPS to the
// Responses API with structured output, not the SDK. What is sent is whatever the caller built;
// the key and the model name come from the server's environment.
//
// Neither the request nor the response is logged, and errors carry a status at most: a body, or a
// network error that echoes the request, can hold a user's text.

// A fixed address: never a URL taken from input.
const endpoint = "https://api.openai.com/v1/responses";

// A bound of its own, beside the one the caller puts on the call.
const requestTimeoutMs = 30_000;

export type StructuredRequest = {
  instructions: string;
  // The user message, already serialized.
  input: string;
  // The name of the schema, as OpenAI wants one.
  name: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
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
        input: request.input,
        text: {
          format: { type: "json_schema", name: request.name, strict: true, schema: request.schema },
        },
      }),
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(requestTimeoutMs)]),
    });
  } catch {
    // Not rethrown: the network error's message can carry the address or the request.
    throw new Error("The request to OpenAI failed.");
  }
  if (!response.ok) throw new Error(`OpenAI answered HTTP ${response.status}.`);
  return structuredAnswer(await response.json().catch(() => undefined));
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
