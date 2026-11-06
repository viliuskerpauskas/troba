import type { MappingModelClient } from "@troba/core";
import { openAiConfig, type OpenAiConfig } from "./env";

// The model client behind AI-suggested import mappings (ADR-0015): plain HTTPS to OpenAI's
// Responses API with structured output, not the SDK. The request carries only what core's
// proposeMapping built, the scrubbed sample; the key and the model name come from the server's
// environment.
//
// Neither the request nor the response is logged, and errors carry a status at most: a body can
// echo the sample.

// A fixed address: never a URL taken from input.
const endpoint = "https://api.openai.com/v1/responses";

// A bound of its own, beside the one core puts on the call.
const requestTimeoutMs = 30_000;

export function createOpenAiMappingClient(
  config: OpenAiConfig,
  fetchImpl: typeof fetch = fetch,
): MappingModelClient {
  return {
    async suggestMapping({ instructions, sample, schema, signal }) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          // Asks OpenAI not to keep the request.
          store: false,
          instructions,
          input: JSON.stringify(sample),
          text: {
            format: { type: "json_schema", name: "import_mapping", strict: true, schema },
          },
        }),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
      });
      if (!response.ok) throw new Error(`OpenAI answered HTTP ${response.status}.`);
      return structuredAnswer(await response.json().catch(() => undefined));
    },
  };
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

// The client for this server's configuration, or null with no key: then nothing is ever sent.
export function mappingModelClient(): MappingModelClient | null {
  const config = openAiConfig();
  return config && createOpenAiMappingClient(config);
}
